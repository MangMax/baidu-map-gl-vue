/**
 * M6-06: useBMapConvertor 验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import { useBMapConvertor, CoordinatesFromType, CoordinatesToType } from '../../packages/baidu-map-gl-vue/src/composables/useBMapConvertor'
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

function mountChild(run: (c: ReturnType<typeof useBMapConvertor>) => any) {
  const el = host()
  const collect = ref<any>(null)
  const Child = defineComponent({
    setup() {
      const conv = useBMapConvertor()
      const exec = () => run(conv)
      onMounted(async () => {
        await exec()
      })
      return () => h('div', 'conv')
    },
  })
  const wrapper = mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  )
  return { wrapper, collect }
}

describe('useBMapConvertor', () => {
  beforeEach(() => resetLifecycleState())

  it('converts coordinates and returns points', async () => {
    fake.stats.reset()
    const { wrapper, collect } = mountChild(async (conv) => {
      const r = await conv.convert([{ lng: 116.4, lat: 39.9 }], CoordinatesFromType.COORDINATES_WGS84, CoordinatesToType.COORDINATES_BD09)
      collect.value = r
    })
    await flushPromises()
    await nextTick()
    expect(collect.value).toHaveLength(1)
    // fake Convertor 默认 +1/+1
    expect(collect.value[0].lng).toBe(117.4)
    wrapper.unmount()
    await nextTick()
  })

  it('records structured error status when points missing', async () => {
    fake.stats.reset()
    const { wrapper, collect } = mountChild(async (conv) => {
      await conv.convert([], CoordinatesFromType.COORDINATES_WGS84, CoordinatesToType.COORDINATES_BD09)
      collect.value = { status: conv.status.value, code: (conv.error.value as any)?.code }
    })
    await flushPromises()
    await nextTick()
    expect(collect.value.status).toBe('error')
    expect(collect.value.code).toBe('BMAP_RESOURCE_CREATE_FAILED')
    wrapper.unmount()
    await nextTick()
  })
})
