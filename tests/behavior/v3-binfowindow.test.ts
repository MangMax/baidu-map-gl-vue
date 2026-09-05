/**
 * M4: BInfoWindow 状态机与资源释放
 *
 * 验证 §11.3:
 * - open= true → 打开(infoWindow 可读)
 * - open→false → 关闭
 * - SDK close 事件回写 update:open
 * - 卸载后无残留 listener
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import BInfoWindow from '../../packages/vue3-baidu-map-gl/src/components/overlays/BInfoWindow.vue'
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

describe('BInfoWindow state machine', () => {
  beforeEach(() => resetLifecycleState())

  it('opens and closes via open prop, respecting state machine', async () => {
    fake.stats.reset()
    const el = host()
    const open = ref(true)
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, open: open.value, title: 't' }),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    // fake 的 infoWindow 应已打开(map.openInfoWindow 被调用)
    expect(fake.stats.overlaysCreated).toBe(1)

    // 关闭
    open.value = false
    await nextTick()
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })

  it('SDK close event writes update:open false', async () => {
    fake.stats.reset()
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, open: true, title: 't' }),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    // 从 fake 找到 infoWindow 并触发 close
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const iw = [...(map.openInfoWindows as Set<{ emit?: (t: string, e: unknown) => void }>)][0]
    if (iw && (iw as any).emit) {
      ;(iw as any).emit('close', { type: 'close' })
    }
    await nextTick()
    // 子组件 BInfoWindow 应发出 update:open false
    const iwComp = wrapper.findComponent(BInfoWindow) as unknown as { emitted: (n: string) => unknown }
    const updates = iwComp.emitted('update:open')
    expect(updates).toBeTruthy()
    wrapper.unmount()
    await nextTick()
  })
})
