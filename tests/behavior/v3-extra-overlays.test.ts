/**
 * M6-02/M4-08: BPanoramaControl / BBezierCurve / BMapMask / BMarker3d 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import BPanoramaControl from '../../packages/vue3-baidu-map-gl/src/components/controls/BPanoramaControl.vue'
import BControl from '../../packages/vue3-baidu-map-gl/src/components/controls/BControl.vue'
import BBezierCurve from '../../packages/vue3-baidu-map-gl/src/components/overlays/BBezierCurve.vue'
import BMapMask from '../../packages/vue3-baidu-map-gl/src/components/overlays/BMapMask.vue'
import BMarker3d from '../../packages/vue3-baidu-map-gl/src/components/overlays/BMarker3d.vue'
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

function mountInMap(children: () => any[], props: Record<string, unknown> = {}) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap },
      setup: () => () => h(BMap, { provider: provider(), ...props }, children),
    }),
    { attachTo: el },
  )
  return wrapper
}

describe('BMap extra overlays/controls v3', () => {
  beforeEach(() => resetLifecycleState())

  it('BPanoramaControl adds a panorama control and toggles visible', async () => {
    fake.stats.reset()
    const wrapper = mountInMap(() => [h(BPanoramaControl, { visible: true })])
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls.size).toBe(0)
  })

  it('BControl creates a custom control with slot DOM', async () => {
    fake.stats.reset()
    const wrapper = mountInMap(() => [
      h(BControl, { anchor: 'BMAP_ANCHOR_TOP_LEFT' }, () => [h('div', { class: 'my-control' }, 'hello')]),
    ])
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    const control = [...map.controls][0] as any
    expect(control.defaultAnchor).toBeTruthy()
    wrapper.unmount()
    await nextTick()
    expect(map.controls.size).toBe(0)
  })

  it('BBezierCurve creates bezier with path/controlPoints and updates', async () => {
    fake.stats.reset()
    const path = ref([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }])
    const cps = ref([[{ lng: 1.5, lat: 1.2 }], [{ lng: 2.5, lat: 2.2 }]])
    const wrapper = mountInMap(() => [
      h(BBezierCurve, { path: path.value, controlPoints: cps.value, strokeColor: '#112233' }),
    ])
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const bezier = [...(map.overlays as Set<any>)][0]
    expect(bezier.points.length).toBe(2)
    expect(bezier.controlPoints.length).toBe(2)
    expect(bezier.options.strokeColor).toBe('#112233')

    path.value = [{ lng: 10, lat: 10 }]
    await nextTick()
    expect(bezier.points.length).toBe(1)
    expect(bezier.points[0].lng).toBe(10)
    wrapper.unmount()
    await nextTick()
  })

  it('BBezierCurve releases listeners on unmount', async () => {
    fake.stats.reset()
    const wrapper = mountInMap(() => [
      h(BBezierCurve, {
        path: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }],
        controlPoints: [[{ lng: 1.5, lat: 1.2 }]],
      }),
    ])
    await flushPromises()
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })

  it('BMapMask creates mask with path and showRegion', async () => {
    fake.stats.reset()
    const wrapper = mountInMap(() => [
      h(BMapMask, { path: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }, { lng: 3, lat: 3 }], showRegion: 'outside' }),
    ])
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const mask = [...(map.overlays as Set<any>)][0]
    expect(mask.points.length).toBe(3)
    expect(mask.options.showRegion).toBe('outside')
    wrapper.unmount()
    await nextTick()
  })

  it('BMarker3d creates marker3d with position/height and updates position', async () => {
    fake.stats.reset()
    const pos = ref({ lng: 116.4, lat: 39.9 })
    const wrapper = mountInMap(() => [
      h(BMarker3d, { position: pos.value, height: 1000, size: 20, fillColor: '#00ff00' }),
    ])
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const m3d = [...(map.overlays as Set<any>)][0]
    expect(m3d.position.lng).toBe(116.4)
    expect(m3d.height).toBe(1000)
    expect(m3d.options.fillColor).toBe('#00ff00')

    pos.value = { lng: 120, lat: 30 }
    await nextTick()
    expect(m3d.position.lng).toBe(120)
    wrapper.unmount()
    await nextTick()
  })
})
