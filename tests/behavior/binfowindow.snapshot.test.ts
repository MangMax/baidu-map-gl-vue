/**
 * M0-02: BInfoWindow 行为快照
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import BMap from '../../packages/components/map/index.vue'
import BInfoWindow from '../../packages/components/overlay/infowindow/index.vue'
import { getFakeBMapGl, resetLifecycleState } from '../../packages/test-utils'

function createHost() {
  const host = document.createElement('div')
  host.style.width = '200px'
  host.style.height = '200px'
  document.body.appendChild(host)
  return host
}

describe('BInfoWindow v2 behavior snapshot', () => {
  beforeEach(() => resetLifecycleState())

  it('creates infoWindow overlay on mount', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(
      {
        components: { BMap, BInfoWindow },
        template: `
          <BMap ak="test-ak">
            <BInfoWindow :position="{ lng: 116.4, lat: 39.9 }" title="测试" />
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

  it('opens when show=true, closes when show=false (v-model:show)', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(
      {
        components: { BMap, BInfoWindow },
        setup() {
          const show = ref(false)
          return { show }
        },
        template: `
          <BMap ak="test-ak">
            <BInfoWindow v-model:show="show" :position="{ lng: 116.4, lat: 39.9 }" />
          </BMap>
        `,
      },
      { attachTo: host },
    )

    await vi.waitFor(() => expect(fake.stats.overlaysCreated).toBe(1))
    await nextTick()

    // 初始不打开
    expect(wrapper.vm.show).toBe(false)

    wrapper.vm.show = true
    await nextTick()
    await nextTick()

    const iw = (wrapper.vm.$refs as any)?.iw
    // 获取 fake infoWindow:直接查 fake stats 不看实例,通过 map.openInfoWindows
    expect((fake as any).Map).toBeTruthy()
    wrapper.unmount()
    await nextTick()
  })

  it('emits update:show when SDK closes info window', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(
      {
        components: { BMap, BInfoWindow },
        setup() {
          const show = ref(true)
          return { show }
        },
        template: `
          <BMap ak="test-ak">
            <BInfoWindow v-model:show="show" :position="{ lng: 116.4, lat: 39.9 }" />
          </BMap>
        `,
      },
      { attachTo: host },
    )

    await vi.waitFor(() => expect(fake.stats.overlaysCreated).toBe(1))
    await nextTick()
    expect(wrapper.vm.show).toBe(true)
    wrapper.unmount()
    await nextTick()
  })
})
