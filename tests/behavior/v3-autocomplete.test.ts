/**
 * BAutoComplete 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BAutoComplete from '../../packages/baidu-map-gl-vue/src/components/autocomplete/BAutoComplete.vue'
import { getFakeBMapGl, resetLifecycleState } from '../../packages/test-utils'

const fake = getFakeBMapGl()
function provider() {
  return {
    load: async () => {
      ;(window as any).BMapGL = fake
      return fake
    },
  }
}
function host() {
  const el = document.createElement('div')
  el.style.width = '200px'
  el.style.height = '200px'
  document.body.appendChild(el)
  return el
}

describe('BAutoComplete v3', () => {
  beforeEach(() => resetLifecycleState())

  it('creates autocomplete bound to input and emits searchComplete', async () => {
    fake.stats.reset()
    const el = host()
    let gotResult: unknown = null
    const wrapper = mount(
      defineComponent({
        components: { BMap, BAutoComplete },
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(BAutoComplete, {
              location: '北京市',
              types: ['city'],
              onSearchComplete: (e: unknown) => {
                gotResult = e
              },
            }),
          ]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    // FakeAutocomplete 构造时立即调用 onSearchComplete
    expect(gotResult).not.toBeNull()
    wrapper.unmount()
    await nextTick()
  })

  it('updates location when prop changes', async () => {
    fake.stats.reset()
    const el = host()
    const location = ref('北京市')
    const wrapper = mount(
      defineComponent({
        components: { BMap, BAutoComplete },
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(BAutoComplete, { location: location.value, types: ['city'] }),
          ]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    location.value = '上海市'
    await nextTick()
    wrapper.unmount()
    await nextTick()
  })
})
