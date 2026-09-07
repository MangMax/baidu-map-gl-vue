/**
 * M4-08: BLabel 迁移验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BLabel from '../../packages/baidu-map-gl-vue/src/components/overlays/BLabel.vue'
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

function mountLabel(position = ref({ lng: 116.4, lat: 39.9 })) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BLabel },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BLabel, { content: 'hello', position: position.value, style: { color: 'red' } }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, position }
}

describe('BLabel v3', () => {
  beforeEach(() => resetLifecycleState())

  it('creates label with content, position and style', async () => {
    fake.stats.reset()
    const { wrapper } = mountLabel()
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const label = [...(map.overlays as Set<any>)][0]
    expect(label.content).toBe('hello')
    expect(label.style.color).toBe('red')
    wrapper.unmount()
    await nextTick()
  })

  it('updates content and position via field-level watch', async () => {
    fake.stats.reset()
    const position = ref({ lng: 116.4, lat: 39.9 })
    const { wrapper } = mountLabel(position)
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const label = [...(map.overlays as Set<any>)][0]

    position.value = { lng: 0, lat: 0 }
    await nextTick()
    expect(label.position.lng).toBe(0)
    expect(label.position.lat).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners and label on unmount', async () => {
    fake.stats.reset()
    const { wrapper } = mountLabel()
    await flushPromises()
    expect(fake.stats.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })
})
