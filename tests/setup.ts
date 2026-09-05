/**
 * 测试全局 setup:
 * - 每个用例前重置 fake BMapGL 统计
 * - 注入 fake SDK 到 window.BMapGL(组件 init 会读取)
 * - patch document.createElement:对百度脚本执行 callback,模拟 SDK 加载完成
 */
import { beforeEach, vi, afterEach } from 'vitest'
import { getFakeBMapGl, resetLifecycleState, registerRuntimeCounters } from '../packages/test-utils'

const fake = getFakeBMapGl()
;(window as unknown as { BMapGL: unknown }).BMapGL = fake

// 模块级缓存原始 createElement(避免 spy 链递归)
const origCreateElement = document.createElement.bind(document)

function isBMapScript(el: HTMLScriptElement): boolean {
  return el.src.includes('api.map.baidu.com')
}

beforeEach(() => {
  resetLifecycleState()
  registerRuntimeCounters()
  document.body.innerHTML = ''

  // 拦截 script 创建,让 SDK 加载 Promise 立即 resolve(模拟)
  vi.spyOn(document, 'createElement').mockImplementation((tag: any, options?: any) => {
    const el = origCreateElement(tag, options)
    if (tag === 'script') {
      setTimeout(() => {
        const src = (el as HTMLScriptElement).src
        if (src && isBMapScript(el as HTMLScriptElement)) {
          const key = src.match(/callback=([^&]+)/)?.[1]
          if (key && (window as any)[key]) {
            ;(window as any)[key]()
            delete (window as any)[key]
          }
        }
      }, 0)
    }
    return el
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
