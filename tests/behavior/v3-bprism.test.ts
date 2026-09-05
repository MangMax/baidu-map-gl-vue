/**
 * M4-08: BPrism 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BPrism from '../../packages/baidu-map-gl-vue/src/components/overlays/BPrism.vue'
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

function mountPrism(altitude = ref(100)) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BPrism },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BPrism, {
              path: [{ lng: 116.4, lat: 39.9 }, { lng: 116.5, lat: 39.9 }],
              altitude: altitude.value,
              topFillColor: '#ff0000',
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, altitude }
}

describe('BPrism v3', () => {
  beforeEach(() => resetLifecycleState())

  it('creates prism with path, altitude and colors', async () => {
    fake.stats.reset()
    const { wrapper } = mountPrism()
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const prism = [...(map.overlays as Set<any>)][0]
    expect(prism.path.length).toBe(2)
    expect(prism.altitude).toBe(100)
    expect(prism.topFillColor).toBe('#ff0000')
    wrapper.unmount()
    await nextTick()
  })

  it('updates altitude via field-level watch', async () => {
    fake.stats.reset()
    const altitude = ref(100)
    const { wrapper } = mountPrism(altitude)
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const prism = [...(map.overlays as Set<any>)][0]
    altitude.value = 200
    await nextTick()
    expect(prism.altitude).toBe(200)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    fake.stats.reset()
    const { wrapper } = mountPrism()
    await flushPromises()
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
