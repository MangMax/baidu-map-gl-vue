/**
 * M7: v3 入口与安装器 smoke
 */
import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'
import { createBMapPlugin, baiduCdnProvider, Vue3BaiduMapGlResolver, useBMapGeolocation } from '../../packages/baidu-map-gl-vue/src'

describe('v3 public entry', () => {
  it('exposes createBMapPlugin and provider factories', () => {
    expect(typeof createBMapPlugin).toBe('function')
    expect(typeof baiduCdnProvider).toBe('function')
  })

  it('installs via app.use and registers global components', () => {
    const app = createApp({ template: '<div />' })
    const plugin = createBMapPlugin({ ak: 'test' })
    app.use(plugin)
    // 组件已注册
    expect(app.component('BMap')).toBeTruthy()
    expect(app.component('BZoom')).toBeTruthy()
  })

  it('resolver resolves B-prefixed components to components path', () => {
    const resolver = Vue3BaiduMapGlResolver()
    const r = resolver.resolve('BMap')
    expect(r).toEqual({ name: 'BMap', from: 'baidu-map-gl-vue/components' })
    // 非组件名不解析
    expect(resolver.resolve('FooBar')).toBeUndefined()
  })

  it('exports composables from root', () => {
    expect(typeof useBMapGeolocation).toBe('function')
  })
})
