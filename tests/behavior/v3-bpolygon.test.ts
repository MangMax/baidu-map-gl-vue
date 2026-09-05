/**
 * M4-07: BPolygon 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import BPolygon from '../../packages/vue3-baidu-map-gl/src/components/overlays/BPolygon.vue'
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

function mountPolygon(path = ref([{ lng: 116.4, lat: 39.9 }, { lng: 116.5, lat: 39.9 }, { lng: 116.5, lat: 39.95 }])) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BPolygon },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BPolygon, { path: path.value, fillColor: '#00ff00', fillOpacity: 0.3 }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, path }
}

describe('BPolygon v3', () => {
  beforeEach(() => resetLifecycleState())

  it('creates polygon with path points and fill options', async () => {
    fake.stats.reset()
    const { wrapper } = mountPolygon()
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const poly = [...(map.overlays as Set<any>)][0]
    expect(poly.points.length).toBe(3)
    expect(poly.fillColor).toBe('#00ff00')
    expect(poly.fillOpacity).toBe(0.3)
    wrapper.unmount()
    await nextTick()
  })

  it('updates path via root-reference replacement', async () => {
    fake.stats.reset()
    const path = ref([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }])
    const { wrapper } = mountPolygon(path)
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const poly = [...(map.overlays as Set<any>)][0]
    expect(poly.points.length).toBe(2)

    path.value = [{ lng: 10, lat: 10 }]
    await nextTick()
    expect(poly.points.length).toBe(1)
    expect(poly.points[0].lng).toBe(10)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    fake.stats.reset()
    const { wrapper } = mountPolygon()
    await flushPromises()
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
