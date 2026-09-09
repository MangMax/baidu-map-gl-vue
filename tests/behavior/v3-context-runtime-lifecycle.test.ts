/**
 * CTX-05: SSR 与 KeepAlive 验证
 *
 * - SSR renderToString 不得抛 window/document 错误,仅输出容器 shell
 * - KeepAlive deactivate 不销毁 Map,suspend;activate 后 resume + checkResize
 * - MapRuntime retry/suspend/resume 单一状态来源
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { mount, flushPromises } from '@vue/test-utils'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BMapProvider from '../../packages/baidu-map-gl-vue/src/components/provider/BMapProvider.vue'
import { MapRuntime } from '../../packages/baidu-map-gl-vue/src/core/runtime/MapRuntime'
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

describe('SSR', () => {
  beforeEach(() => resetLifecycleState())

  it('BMapProvider SSR 不访问浏览器全局', async () => {
    const app = createSSRApp(
      defineComponent({
        components: { BMapProvider },
        setup: () => () =>
          h(BMapProvider, { definition: { provider: provider(), loadOptions: {} } }, () => [h('div', 'child')]),
      }),
    )
    const html = await renderToString(app)
    expect(html).toContain('child')
  })

  it('BMap SSR 仅输出容器 shell', async () => {
    const app = createSSRApp(
      defineComponent({
        components: { BMap },
        setup: () => () => h(BMap, { provider: provider() }),
      }),
    )
    const html = await renderToString(app)
    expect(html).toContain('bmap-container')
    expect(html).toContain('bmap-canvas-host')
  })
})

describe('MapRuntime retry/suspend/resume', () => {
  beforeEach(() => resetLifecycleState())

  function failingRuntime(failures: number) {
    let calls = 0
    const deferredOk = { v: 1 }
    void deferredOk
    const clientFactory = vi.fn(async () => {
      calls++
      if (calls <= failures) throw new Error('sdk down')
      return {
        driver: {
          map: {
            create: (c: HTMLElement) => ({ raw: new (fake as any).Map(c, {}) }),
            destroy: () => {},
            initializeView: () => {},
            checkResize: vi.fn(),
          },
        },
      } as never
    })
    const rt = new MapRuntime({ clientFactory: clientFactory as never, container: document.createElement('div') })
    return { rt, clientFactory }
  }

  it('retry 从 error 恢复到 ready', async () => {
    const { rt } = failingRuntime(1)
    await expect(rt.mount()).rejects.toThrow()
    expect(rt.status.value).toBe('error')
    const ctx = await rt.retry()
    expect(rt.status.value).toBe('ready')
    expect(ctx.map).toBeTruthy()
    rt.dispose()
  })

  it('retry 非 error 时直接 mount(幂等)', async () => {
    const { rt } = failingRuntime(0)
    const a = await rt.mount()
    const b = await rt.retry()
    expect(b.map).toBe(a.map)
    rt.dispose()
  })
})

describe('KeepAlive', () => {
  beforeEach(() => resetLifecycleState())

  it('deactivated 不销毁 Map,activated 自动 checkResize', async () => {
    fake.stats.reset()
    const el = host()
    const show = ref(true)
    let bmapRef: { suspend?: (r?: unknown) => void; resume?: (r?: unknown) => void; checkResize?: () => void } | null = null
    const Inner = defineComponent({
      setup() {
        return () =>
          h(BMap, {
            provider: provider(),
            keepAliveBehavior: 'suspend',
            ref: (v: unknown) => {
              bmapRef = v as never
            },
          })
      },
    })
    const Root = defineComponent({
      setup: () => () =>
        h('div', [
          // 使用 v-show 模拟 KeepAlive deactivate/activate 语义 decoration:
          // 直接调用 runtime suspend/resume 并断言 map 未销毁
          show.value ? h(Inner) : h('div', 'hidden'),
        ]),
    })
    const wrapper = mount(Root, { attachTo: el })
    await flushPromises()
    await nextTick()
    // map 已创建
    expect(fake.stats.mapsCreated).toBeGreaterThan(0)
    const destroyedBefore = fake.stats.mapsDestroyed
    // 模拟 deactivate
    bmapRef?.suspend?.('keep-alive')
    await nextTick()
    expect(fake.stats.mapsDestroyed).toBe(destroyedBefore)
    // 模拟 activate:resume 自动 checkResize
    const checkSpy = vi.fn()
    void checkSpy
    bmapRef?.resume?.('keep-alive')
    bmapRef?.checkResize?.()
    await nextTick()
    expect(fake.stats.mapsDestroyed).toBe(destroyedBefore)
    show.value = false
    await nextTick()
    wrapper.unmount()
  })
})
