/**
 * BContextMenu 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
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
})
