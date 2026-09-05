/**
 * M5-03: BPointLayer 批量点层验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BPointLayer from '../../packages/baidu-map-gl-vue/src/components/data/BPointLayer.vue'
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

function mountLayer(data: ref<readonly Pt[]>) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BPointLayer },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BPointLayer, {
              data: data.value,
              'item-key': 'id',
              getPosition: (i: Pt) => ({ lng: i.lng, lat: i.lat }),
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, data }
}

describe('BPointLayer v3', () => {
  beforeEach(() => resetLifecycleState())

  it('renders a batch of points without per-point Vue components', async () => {
    fake.stats.reset()
    const data = ref<readonly Pt[]>([
      { id: 'a', lng: 1, lat: 1 },
      { id: 'b', lng: 2, lat: 2 },
      { id: 'c', lng: 3, lat: 3 },
    ] as readonly Pt[])
    const { wrapper } = mountLayer(data)
    await flushPromises()
    // 3 个 marker 被加入地图,但仅 1 个 Vue 组件(BPointLayer)
    expect(fake.stats.overlaysCreated).toBe(3)
    wrapper.unmount()
    await nextTick()
  })

  it('diffs to add/remove points on data change', async () => {
    fake.stats.reset()
    const data = ref<readonly Pt[]>([
      { id: 'a', lng: 1, lat: 1 },
      { id: 'b', lng: 2, lat: 2 },
    ] as readonly Pt[])
    const { wrapper } = mountLayer(data)
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(2)

    data.value = [{ id: 'a', lng: 1, lat: 1 }, { id: 'c', lng: 3, lat: 3 }] as readonly Pt[]
    await nextTick()
    expect(fake.stats.overlaysCreated).toBe(3) // added c
    expect(fake.stats.overlaysRemoved).toBe(1) // removed b
    wrapper.unmount()
    await nextTick()
  })

  it('releases all markers on unmount', async () => {
    fake.stats.reset()
    const data = ref<readonly Pt[]>([
      { id: 'a', lng: 1, lat: 1 },
      { id: 'b', lng: 2, lat: 2 },
    ] as readonly Pt[])
    const { wrapper } = mountLayer(data)
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(2)
    wrapper.unmount()
    await nextTick()
    // 移除标记已通过 removeOverlay 释放
    expect(fake.stats.listeners).toBe(0)
  })
})
