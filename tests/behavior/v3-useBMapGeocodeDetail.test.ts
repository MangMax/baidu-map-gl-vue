/**
 * useBMapGeocodeDetail 验证(含真 Driver 全链路)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import { useBMapGeocodeDetail } from '../../packages/baidu-map-gl-vue/src/composables/useBMapGeocodeDetail'
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

function mountWithChild(child: (geo: ReturnType<typeof useBMapGeocodeDetail>) => Promise<void> | void) {
  const el = host()
  const Child = defineComponent({
    setup() {
      const geo = useBMapGeocodeDetail()
      const run = () => child(geo)
      onMounted(async () => {
        await run()
      })
      return () => h('div', 'geo')
    },
  })
  const wrapper = mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  )
  return { wrapper }
}

describe('useBMapGeocodeDetail', () => {
  beforeEach(() => resetLifecycleState())

  it('resolves address detail for a point via driver-converted Point', async () => {
    fake.stats.reset()
    let detail: any = null
    const { wrapper } = mountWithChild(async (geo) => {
      detail = await geo.get({ lng: 116.404, lat: 39.915 })
    })
    await flushPromises()
    await nextTick()
    expect(detail?.address).toBe('北京市海淀区上地10街')
    expect(detail?.point).toEqual({ lng: 116.404, lat: 39.915 })
    wrapper.unmount()
    await nextTick()
  })

  it('getBatch returns per-item details', async () => {
    fake.stats.reset()
    let results: any = null
    const { wrapper } = mountWithChild(async (geo) => {
      results = await geo.getBatch([
        { lng: 116.404, lat: 39.915 },
        { lng: 121.5, lat: 31.2 },
      ])
    })
    await flushPromises()
    await nextTick()
    expect(results).toHaveLength(2)
    expect(results[0].detail?.address).toBe('北京市海淀区上地10街')
    expect(results[0].point).toEqual({ lng: 116.404, lat: 39.915 })
    wrapper.unmount()
    await nextTick()
  })

  it('exposes error ref (not throw) on invalid input', async () => {
    const { wrapper } = mountWithChild(async (geo) => {
      await geo.get({ lng: 'x', lat: 1 } as any)
      expect(geo.status.value).toBe('error')
      expect(geo.error.value).toMatchObject({ code: 'BMAP_INVALID_POINT' })
    })
    await flushPromises()
    await nextTick()
    wrapper.unmount()
    await nextTick()
  })
})
