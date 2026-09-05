/**
 * M6-06: useBMapGeocoder 验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import { useBMapGeocoder } from '../../packages/vue3-baidu-map-gl/src/composables/useBMapGeocoder'
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

function mountWithChild(child: (geo: ReturnType<typeof useBMapGeocoder>) => Promise<void> | void) {
  const el = host()
  const collect = ref<any>(null)
  const Child = defineComponent({
    setup() {
      const geo = useBMapGeocoder()
      const run = () => child(geo)
      onMounted(async () => {
        await run()
      })
      return () => h('div', 'geo')
    },
  })
  const wrapper = mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  )
  return { wrapper, collect }
}

describe('useBMapGeocoder', () => {
  beforeEach(() => resetLifecycleState())

  it('geocodes a single address to point', async () => {
    fake.stats.reset()
    const { wrapper, collect } = mountWithChild(async (geo) => {
      const p = await geo.get('北京', '北京市')
      collect.value = p
    })
    await flushPromises()
    await nextTick()
    expect(collect.value?.lng).toBe(116.4)
    wrapper.unmount()
    await nextTick()
  })

  it('getBatch returns per-item results', async () => {
    fake.stats.reset()
    const { wrapper, collect } = mountWithChild(async (geo) => {
      const results = await geo.getBatch(['北京', '上海'], 'x')
      collect.value = results
    })
    await flushPromises()
    await nextTick()
    expect(collect.value).toHaveLength(2)
    expect(collect.value[0].point?.lng).toBe(116.4)
    expect(collect.value[1].point?.lng).toBe(116.4)
    wrapper.unmount()
    await nextTick()
  })
})
