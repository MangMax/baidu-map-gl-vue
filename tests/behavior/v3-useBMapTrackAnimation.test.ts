/**
 * M6-07: useBMapTrackAnimation 验证(自有状态机,不读私有 _status)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/vue3-baidu-map-gl/src/components/map/BMap.vue'
import { useBMapTrackAnimation } from '../../packages/vue3-baidu-map-gl/src/composables/useBMapTrackAnimation'
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

function mountChild(run: (t: ReturnType<typeof useBMapTrackAnimation>) => any) {
  const el = host()
  const collect = ref<any>(null)
  const Child = defineComponent({
    setup() {
      const track = useBMapTrackAnimation()
      onMounted(async () => {
        await run(track)
        collect.value = track.status.value
      })
      return () => h('div', 'track')
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

describe('useBMapTrackAnimation', () => {
  beforeEach(() => resetLifecycleState())

  it('transitions to playing on start using library state machine', async () => {
    fake.stats.reset()
    const { wrapper, collect } = mountChild(async (track) => {
      await track.setPath([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }])
      track.start()
    })
    await flushPromises()
    await nextTick()
    expect(collect.value).toBe('playing')
    wrapper.unmount()
    await nextTick()
  })

  it('user pause is not overwritten by document visibility resume', async () => {
    fake.stats.reset()
    const { wrapper, collect } = mountChild(async (track) => {
      await track.setPath([{ lng: 1, lat: 1 }])
      await track.start()
      track.pause('user')
      track.resume('document-hidden')
      collect.value = track.status.value
    })
    await flushPromises()
    await nextTick()
    expect(collect.value).toBe('paused')
    wrapper.unmount()
    await nextTick()
  })
})
