/**
 * M6-04: BPanoramaCoverageLayer 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BPanoramaCoverageLayer from '../../packages/baidu-map-gl-vue/src/components/layers/BPanoramaCoverageLayer.vue'
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

describe('BPanoramaCoverageLayer v3', () => {
  beforeEach(() => resetLifecycleState())

  it('adds and removes a panorama coverage layer', async () => {
    fake.stats.reset()
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BPanoramaCoverageLayer },
        setup: () => () => h(BMap, { provider: provider() }, () => [h(BPanoramaCoverageLayer)]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    // fake Map.addTileLayer 已计入 overlays
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.callLog).toContain('addTileLayer')
    wrapper.unmount()
    await nextTick()
    expect(map.callLog).toContain('removeTileLayer')
  })
})
