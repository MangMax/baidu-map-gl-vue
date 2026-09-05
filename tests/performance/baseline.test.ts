/**
 * M0-07: 性能基线(用 fake BMapGL 驱动真实 v2 组件)
 *
 * 这里的"性能"用可观测成本替代真实 FPS(不依赖外网/AK),
 * 以 SDK 操作计数和耗时作为相对变化信号。v3 重建后对比本基线。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BMap from '../../packages/components/map/index.vue'
import BMarker from '../../packages/components/overlay/marker/index.vue'
import { getFakeBMapGl, resetLifecycleState } from '../../packages/test-utils'

function createHost() {
  const host = document.createElement('div')
  host.style.width = '100px'
  host.style.height = '100px'
  document.body.appendChild(host)
  return host
}

function createMap(host: HTMLElement) {
  return mount(
    {
      components: { BMap },
      template: '<BMap ak="test-ak" />',
    },
    { attachTo: host },
  )
}

describe('baseline', () => {
  beforeEach(() => resetLifecycleState())

  it('100 map mount/unmount cycles', async () => {
    const fake = getFakeBMapGl()
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      const host = createHost()
      const w = createMap(host)
      await vi.waitFor(() => expect(fake.stats.mapsCreated).toBe(i + 1))
      w.unmount()
      await nextTick()
      host.remove()
    }
    const elapsed = performance.now() - start
    expect(fake.stats.maps).toBe(0)
    expect(elapsed).toBeGreaterThan(0)
  }, 30_000)

  it('100 markers create and destroy', async () => {
    const fake = getFakeBMapGl()
    const host = createHost()
    const w = mount(
      {
        components: { BMap, BMarker },
        template: `
          <BMap ak="test-ak">
            <BMarker v-for="i in 100" :key="i" :position="{ lng: i, lat: i }" />
          </BMap>
        `,
      },
      { attachTo: host },
    )
    await vi.waitFor(() => expect(fake.stats.overlaysCreated).toBe(100))
    expect(fake.stats.overlaysRemoved).toBe(0)
    w.unmount()
    await nextTick()
    expect(fake.stats.maps).toBe(0)
    expect(fake.stats.overlaysCreated - fake.stats.overlaysRemoved).toBe(0)
  }, 30_000)
})
