/**
 * BContextMenu 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BMarker from '../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue'
import BContextMenu from '../../packages/baidu-map-gl-vue/src/components/overlays/BContextMenu.vue'
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

describe('BContextMenu v3', () => {
  beforeEach(() => resetLifecycleState())

  it('adds context menu to parent marker via typed overlay context', async () => {
    fake.stats.reset()
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker, BContextMenu },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 } }, () => [
                h(BContextMenu, { width: 120, menuItems: [{ text: 'a', callback: () => {} }, '-'] }),
              ]),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    await flushPromises()
    // marker 的 addContextMenu 被调用(callLog)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const marker = [...(map.overlays as Set<any>)][0]
    expect(marker.callLog).toContain('addContextMenu')
    wrapper.unmount()
    await nextTick()
    expect(marker.callLog).toContain('removeContextMenu')
  })

  it('menuItems 重建释放旧菜单实例 child scope(listener 不随重建累积)', async () => {
    fake.stats.reset()
    const el = host()
    const menuItems = ref<(Record<string, unknown> | string)[]>([{ text: 'a', callback: () => {} }])
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker, BContextMenu },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 } }, () => [
                h(BContextMenu, { width: 120, menuItems: menuItems.value as never }),
              ]),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    await flushPromises()
    // 基线:marker 事件 + context menu open/close(菜单已接入 fake.stats 计数)
    const baseline = fake.stats.listeners
    expect(baseline).toBeGreaterThan(0)
    expect(fake.createdContextMenus).toHaveLength(1)
    const firstMenu = fake.createdContextMenus[0]
    // 当前菜单持有 open/close 两个监听
    expect(firstMenu.getListenerCount()).toBe(2)

    const seenMenus: unknown[] = [firstMenu]
    for (let i = 0; i < 10; i++) {
      menuItems.value = [{ text: `item-${i}`, callback: () => {} }]
      await nextTick()
      await flushPromises()
      // 每次原子重建产出新菜单实例,旧实例监听被释放,新实例持有 2 个监听
      expect(fake.createdContextMenus).toHaveLength(i + 2)
      const currentMenu = fake.createdContextMenus[fake.createdContextMenus.length - 1]
      expect(seenMenus[seenMenus.length - 1]).not.toBe(currentMenu)
      seenMenus.push(currentMenu)
      expect(currentMenu.getListenerCount()).toBe(2)
      for (const old of seenMenus.slice(0, -1)) {
        expect((old as { getListenerCount(): number }).getListenerCount()).toBe(0)
      }
    }
    // 全局 listener 总数稳定,不随轮次累积
    expect(fake.stats.listeners).toBe(baseline)

    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
