/**
 * M0-04: 生命周期泄漏断言
 *
 * 100 次挂载/卸载后,fake SDK 的地图、覆盖物、监听器、Observer 和 pending task
 * 数量回到基线(全部为 0)。
 *
 * 注意:这是 v2 基线。v2 已知存在 MutationObserver 泄漏(bindObserver 未 disconnect),
 * 所以本测试只断言 fake SDK 层面的资源(Maps/Overlays/Listeners)。
 * Observer/RAF/Timer 断言在 v3 运行时(带 ResourceScope)后启用。
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

describe('M0-04 lifecycle leak snapshot (v2 baseline)', () => {
  beforeEach(() => resetLifecycleState())

  it('after 100 mount/unmount cycles: maps/overlays/listeners back to zero', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()

    for (let i = 0; i < 100; i++) {
      const host = createHost()
      const wrapper = mount(
        {
          components: { BMap, BMarker },
          template: `
            <BMap ak="test-ak">
              <BMarker :position="{ lng: 116.4, lat: 39.9 }" />
            </BMap>
          `,
        },
        { attachTo: host },
      )
      await vi.waitFor(() => expect(fake.stats.mapsCreated).toBe(i + 1))
      wrapper.unmount()
      await nextTick()
      host.remove()
    }

    // 每次 mount 会创建 1 map + 1 marker;卸载后都回到 0
    expect(fake.stats.maps).toBe(0)
    expect(fake.stats.mapsCreated).toBe(100)
    expect(fake.stats.overlaysCreated - fake.stats.overlaysRemoved).toBe(0)
    // SDK listener 应全部解除(依赖组件清理正确)
    expect(fake.stats.listeners).toBe(0)
    // 未观察到的资源:Observer/RAF/Timer 在 v2 有已知泄漏,见方案附录 A.12.2
  }, 30_000)
})
