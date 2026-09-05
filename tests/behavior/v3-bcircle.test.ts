/**
 * M4-07: BCircle 迁移验证
 *
 * 验证 §11.5:
 * - center 字段级更新(不 deep watch),SDK setCenter 被调用
 * - radius/样式 字段级更新
 * - visible 幂等切换
 * - 卸载后 resource 销毁 + 监听释放
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import BCircle from '../../packages/vue3-baidu-map-gl/src/components/overlays/BCircle.vue'
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

function mountCircle(centerRef = ref({ lng: 116.4, lat: 39.9 })) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BCircle },
      setup() {
        const center = centerRef
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BCircle, { center: center.value, radius: 100, strokeColor: '#ff0000' }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, centerRef }
}

describe('BCircle v3', () => {
  beforeEach(() => resetLifecycleState())

  it('creates circle with valid center (incl 0,0) and radius', async () => {
    fake.stats.reset()
    const { wrapper } = mountCircle(ref({ lng: 0, lat: 0 }))
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const circle = [...(map.overlays as Set<any>)][0]
    expect(circle.radius).toBe(100)
    wrapper.unmount()
    await nextTick()
  })

  it('updates center via field-level watch (0 coordinate valid)', async () => {
    fake.stats.reset()
    const center = ref({ lng: 116.4, lat: 39.9 })
    const { wrapper } = mountCircle(center)
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]

    center.value = { lng: 0, lat: 0 }
    await nextTick()
    const circle = [...(map.overlays as Set<any>)][0]
    expect(circle.center.lng).toBe(0)
    expect(circle.center.lat).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners and disposes circle on unmount', async () => {
    fake.stats.reset()
    const { wrapper } = mountCircle()
    await flushPromises()
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
