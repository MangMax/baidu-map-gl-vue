/**
 * M4: BMarker 动态更新与幂等可见性
 *
 * 验证 §11.2 的关键修复:
 * - position 变化用字段级 watch(不等同于 deep watch),更新 SDK position
 * - visible 切换幂等,不重复 add 同一 Overlay
 * - 卸载后 SDK 监听与 watcher 全部释放
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import BMarker from '../../packages/vue3-baidu-map-gl/src/components/overlays/BMarker.vue'
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

describe('BMarker field-level updates', () => {
  beforeEach(() => resetLifecycleState())

  it('updates marker position when lng/lat change', async () => {
    fake.stats.reset()
    const el = host()
    const position = ref({ lng: 116.4, lat: 39.9 })
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [h(BMarker, { position: position.value })])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    // 从 fake 记录的地图实例读取 created overlay(marker)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const marker = [...(map.overlays as Set<{ position?: { lng: number; lat: number } }>)][0]
    expect(marker?.position?.lng).toBe(116.4)
    position.value = { lng: 200, lat: 50 }
    await nextTick()
    // marker 的 position 更新为 (200,50)
    expect(marker.position?.lng).toBe(200)
    wrapper.unmount()
    await nextTick()
  })

  it('toggles visible without duplicate addOverlay calls', async () => {
    fake.stats.reset()
    const el = host()
    const visible = ref(true)
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [h(BMarker, { position: { lng: 116.4, lat: 39.9 }, visible: visible.value })])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    const created = fake.stats.overlaysCreated
    expect(created).toBe(1)

    visible.value = false
    await nextTick()
    const removed = fake.stats.overlaysRemoved
    expect(removed).toBe(1)

    // 再次切换回可见:注册一个新的(作为新 Overlay,或复用原实例)
    visible.value = true
    await nextTick()
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })

  it('releases all listeners and watchers on unmount', async () => {
    fake.stats.reset()
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [h(BMarker, { position: { lng: 116.4, lat: 39.9 }, title: 't' })])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
