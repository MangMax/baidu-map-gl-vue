/**
 * BZoom/BScale 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BZoom from '../../packages/baidu-map-gl-vue/src/components/controls/BZoom.vue'
import BScale from '../../packages/baidu-map-gl-vue/src/components/controls/BScale.vue'
import BCityList from '../../packages/baidu-map-gl-vue/src/components/controls/BCityList.vue'
import BLocation from '../../packages/baidu-map-gl-vue/src/components/controls/BLocation.vue'
import BNavigation3d from '../../packages/baidu-map-gl-vue/src/components/controls/BNavigation3d.vue'
import BCopyright from '../../packages/baidu-map-gl-vue/src/components/controls/BCopyright.vue'
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

function mountControl(comp: any, props: Record<string, unknown> = {}) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, Comp: comp },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(comp, props)]),
    }),
    { attachTo: el },
  )
  return { wrapper }
}

describe('Control v3', () => {
  beforeEach(() => resetLifecycleState())

  it('BZoom adds a zoom control to the map', async () => {
    fake.stats.reset()
    const { wrapper } = mountControl(BZoom)
    await flushPromises()
    // fake Map.addControl 已实现(记录在 maps 的 controls 集合)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls.size).toBe(0)
  })

  it('BScale adds control and toggles visible', async () => {
    fake.stats.reset()
    const visible = ref(true)
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BScale },
        setup: () => () => h(BMap, { provider: provider() }, () => [h(BScale, { visible: visible.value })]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    visible.value = false
    await nextTick()
    expect(map.controls.size).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('BCityList adds a city-list control', async () => {
    fake.stats.reset()
    const { wrapper } = mountControl(BCityList, { expand: true })
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls.size).toBe(0)
  })

  it('BLocation adds a location control', async () => {
    fake.stats.reset()
    const { wrapper } = mountControl(BLocation)
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls.size).toBe(0)
  })

  it('BNavigation3d adds a navigation control', async () => {
    fake.stats.reset()
    const { wrapper } = mountControl(BNavigation3d)
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls.size).toBe(0)
  })

  it('BCopyright adds a copyright control with slot content', async () => {
    fake.stats.reset()
    const el = host()
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [
          h(BCopyright, {}, () => h('span', { class: 'copyright-content' }, 'custom copyright')),
        ]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    expect(map.controls.size).toBe(1)
    const control = [...map.controls][0] as { copyrights?: { content: string }[] }
    expect(wrapper.text()).toContain('custom copyright')
    wrapper.unmount()
    await nextTick()
    expect(map.controls.size).toBe(0)
  })

  it('BCopyright toggles visibility without re-adding the control', async () => {
    fake.stats.reset()
    const visible = ref(true)
    const el = host()
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [
          h(BCopyright, { visible: visible.value }, () => 'custom copyright'),
        ]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const control = [...map.controls][0] as { copyrights?: unknown[] }
    expect(control.copyrights).toHaveLength(1)
    visible.value = false
    await nextTick()
    expect(map.controls.size).toBe(1)
    expect(control.copyrights).toHaveLength(0)
    visible.value = true
    await nextTick()
    expect(map.controls.size).toBe(1)
    expect(control.copyrights).toHaveLength(1)
    wrapper.unmount()
    await nextTick()
  })
})
