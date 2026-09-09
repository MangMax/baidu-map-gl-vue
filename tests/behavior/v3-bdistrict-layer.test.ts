/**
 * BDistrictLayer 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BDistrictLayer from '../../packages/baidu-map-gl-vue/src/components/layers/BDistrictLayer.vue'
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

function mountLayer(visible = ref(true)) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BDistrictLayer },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(BDistrictLayer, { name: '北京市', visible: visible.value })]),
    }),
    { attachTo: el },
  )
  return { wrapper, visible }
}

describe('BDistrictLayer v3', () => {
  beforeEach(() => resetLifecycleState())

  it('adds a district layer to the map', async () => {
    fake.stats.reset()
    const { wrapper } = mountLayer()
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.overlaysRemoved).toBe(1)
  })

  it('toggles visible add/remove idempotently', async () => {
    fake.stats.reset()
    const { wrapper, visible } = mountLayer()
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    visible.value = false
    await nextTick()
    expect(fake.stats.overlaysRemoved).toBe(1)
    visible.value = true
    await nextTick()
    expect(fake.stats.overlaysCreated).toBe(2)
    wrapper.unmount()
    await nextTick()
  })
})
