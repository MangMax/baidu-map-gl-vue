/**
 * BMarkerCluster 聚合组件验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BMarkerCluster from '../../packages/baidu-map-gl-vue/src/components/data/BMarkerCluster.vue'
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

interface Pt { id: string; lng: number; lat: number }

function mountCluster(data: ref<readonly Pt[]>) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BMarkerCluster },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BMarkerCluster, {
              data: data.value,
              'item-key': 'id',
              getPosition: (i: Pt) => ({ lng: i.lng, lat: i.lat }),
              minClusterSize: 3,
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, data }
}

const pts: readonly Pt[] = [
  { id: 'a', lng: 116.40, lat: 39.90 },
  { id: 'b', lng: 116.41, lat: 39.91 },
  { id: 'c', lng: 116.42, lat: 39.92 },
  { id: 'd', lng: 121.50, lat: 31.20 },
] as readonly Pt[]

describe('BMarkerCluster v3', () => {
  beforeEach(() => resetLifecycleState())

  it('clusters nearby points and keeps far point separate', async () => {
    fake.stats.reset()
    const data = ref<readonly Pt[]>(pts)
    const { wrapper } = mountCluster(data)
    await flushPromises()
    // 北京 3 点聚为 1 个簇 marker + 上海 1 点单独 = 2 个视觉 marker
    expect(fake.stats.overlaysCreated).toBe(2)
    wrapper.unmount()
    await nextTick()
  })

  it('releases all markers and listeners on unmount', async () => {
    fake.stats.reset()
    const data = ref<readonly Pt[]>(pts)
    const { wrapper } = mountCluster(data)
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(2)
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
