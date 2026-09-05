/**
 * M0-02: BMap 行为快照
 *
 * 锁定 v2 BMap 的现有行为,重构时防止无意行为变化。
 * 使用 fake BMapGL 挂载真实组件,断言:
 * - Map 容器渲染
 * - SDK 脚本加载后创建 Map
 * - props 默认值注入 SDK options
 * - 事件绑定 & emits
 * - 卸载时 map.destroy() 且不重复
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BMap from '../../packages/components/map/index.vue'
import { getFakeBMapGl, resetLifecycleState } from '../../packages/test-utils'

function createHost() {
  const host = document.createElement('div')
  host.style.width = '100px'
  host.style.height = '100px'
  document.body.appendChild(host)
  return host
}

describe('BMap v2 behavior snapshot', () => {
  beforeEach(() => {
    resetLifecycleState()
  })

  it('renders container and creates map after sdk loads', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(BMap, {
      attachTo: host,
      props: {
        ak: 'test-ak',
        center: { lng: 116.4, lat: 39.9 },
        zoom: 12,
      },
      global: {
        provide: {
          'map-config': undefined,
        },
      },
    })

    expect(wrapper.find('.baidu-map-container').exists()).toBe(true)
    await vi.waitFor(() => expect(fake.stats.mapsCreated).toBe(1))
    const map = (wrapper.vm as any).getMapInstance()
    expect(map).toBeTruthy()
    expect(map.zoom).toBe(12)
    wrapper.unmount()
  })

  it('destroys map on unmount exactly once', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(BMap, {
      attachTo: host,
      props: { ak: 'test-ak' },
    })
    await vi.waitFor(() => expect(fake.stats.mapsCreated).toBe(1))
    expect(fake.stats.maps).toBe(1)

    wrapper.unmount()
    await nextTick()
    expect(fake.stats.mapsDestroyed).toBe(1)
    expect(fake.stats.maps).toBe(0)
  })

  it('emits initd with map instance and BMapGL namespace', async () => {
    const fake = getFakeBMapGl()
    fake.stats.reset()
    const host = createHost()

    const wrapper = mount(BMap, {
      attachTo: host,
      props: { ak: 'test-ak' },
    })
    await vi.waitFor(() => expect(fake.stats.mapsCreated).toBe(1))
    await nextTick()
    const emitted = (wrapper.emitted('initd')?.[0]?.[0] as any) ?? undefined
    expect(emitted).toBeTruthy()
    expect(emitted.map).toBeInstanceOf((getFakeBMapGl() as any).Map)
    expect(emitted.BMapGL).toBe(fake)
    wrapper.unmount()
  })
})
