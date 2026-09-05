/**
 * M0-02: BMarker 行为快照
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import BMap from '../../packages/components/map/index.vue'
import BMarker from '../../packages/components/overlay/marker/index.vue'
import { getFakeBMapGl, resetLifecycleState } from '../../packages/test-utils'

function createHost() {
  const host = document.createElement('div')
  host.style.width = '200px'
  host.style.height = '200px'
  document.body.appendChild(host)
  return host
}

describe('BMarker v2 behavior snapshot', () => {
  beforeEach(() => resetLifecycleState())

  it('creates marker with options and adds overlay', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
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

    await vi.waitFor(() => expect(fake.stats.overlaysCreated).toBe(1))
    expect(fake.stats.overlaysRemoved).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('does not create marker when position is missing', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(
      {
        components: { BMap, BMarker },
        template: `
          <BMap ak="test-ak">
            <BMarker />
          </BMap>
        `,
      },
      { attachTo: host },
    )

    await vi.waitFor(() => expect(fake.stats.mapsCreated).toBe(1))
    await nextTick()
    expect(fake.stats.overlaysCreated).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('removes overlay when visible becomes false', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(
      {
        components: { BMap, BMarker },
        setup() {
          const visible = ref(true)
          return { visible }
        },
        template: `
          <BMap ak="test-ak">
            <BMarker :position="{ lng: 116.4, lat: 39.9 }" :visible="visible" />
          </BMap>
        `,
      },
      { attachTo: host },
    )
    await vi.waitFor(() => expect(fake.stats.overlaysCreated).toBe(1))

    wrapper.vm.visible = false
    await nextTick()
    expect(fake.stats.overlaysRemoved).toBe(1)
    wrapper.unmount()
    await nextTick()
  })
})
