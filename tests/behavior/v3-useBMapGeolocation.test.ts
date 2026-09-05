/**
 * M6-05: useBMapGeolocation 验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import { useBMapGeolocation } from '../../packages/vue3-baidu-map-gl/src/composables/useBMapGeolocation'
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

describe('useBMapGeolocation', () => {
  beforeEach(() => resetLifecycleState())

  it('locates after map ready and returns a point (as BMap child)', async () => {
    fake.stats.reset()
    const el = host()
    const located = ref<{ lng: number; lat: number } | null>(null)
    const Child = defineComponent({
      setup() {
        const geo = useBMapGeolocation()
        onMounted(async () => {
          await geo.locate()
          if (geo.data.value) {
            located.value = geo.data.value.point
          }
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
    await flushPromises()
    await nextTick()
    expect(located.value?.lng).toBe(116.4)
    wrapper.unmount()
    await nextTick()
  })
})
