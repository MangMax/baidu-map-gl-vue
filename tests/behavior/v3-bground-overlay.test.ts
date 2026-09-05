/**
 * M4-08: BGroundOverlay 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import BGroundOverlay from '../../packages/vue3-baidu-map-gl/src/components/overlays/BGroundOverlay.vue'
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

function mountOverlay(startPoint = ref({ lng: 116.4, lat: 39.9 })) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BGroundOverlay },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BGroundOverlay, {
              type: 'image',
              url: 'a.png',
              startPoint: startPoint.value,
              endPoint: { lng: 116.5, lat: 40.9 },
              opacity: 0.5,
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, startPoint }
}

describe('BGroundOverlay v3', () => {
  beforeEach(() => resetLifecycleState())

  it('creates ground overlay with bounds and opacity', async () => {
    fake.stats.reset()
    const { wrapper } = mountOverlay()
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const go = [...(map.overlays as Set<any>)][0]
    expect(go.opacity).toBe(0.5)
    expect(go.url).toBe('a.png')
    // bounds center = midpoint
    expect(go.bounds.getCenter().lng).toBeCloseTo(116.45, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('updates bounds via field-level watch on start/end points', async () => {
    fake.stats.reset()
    const startPoint = ref({ lng: 116.4, lat: 39.9 })
    const { wrapper } = mountOverlay(startPoint)
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const go = [...(map.overlays as Set<any>)][0]
    startPoint.value = { lng: 100, lat: 30 }
    await nextTick()
    expect(go.bounds.getCenter().lng).toBeCloseTo(108.25, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    fake.stats.reset()
    const { wrapper } = mountOverlay()
    await flushPromises()
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
