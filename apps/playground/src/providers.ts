/**
 * Playground 的 Provider 选择：Fake v4 / 真实 v4 两种模式（M3A3-CUTOVER / #25）
 *
 * 两种模式刻意走**同一套公共 API**，差别只在「SDK 从哪来」：
 *
 * - `fake`（默认）：把 Fake BMap v4 命名空间挂到 `globalThis.BMap`，再用公开的
 *   `existingGlobalV4Provider()` 复用。这与线上「宿主页面已经加载好 SDK、本库只消费」是同一条
 *   代码路径，既不需要 bundle 任何私有内部模块，也不依赖外网与 AK，`vite build` 能直接跑通。
 * - `real`：不显式传 provider，用 `createBMapPlugin({ ak })` 的**默认** Provider（真实
 *   `https://api.map.baidu.com/api?v=4.0&ak=...`），验证的正是线上默认路径。
 *
 * 不要回到「Fake BMapGL + 宽松 Provider」的老形态：默认 engine 已经是 `jsapi-v4`，那份 fake
 * 属于迁移期 legacy（随 #26 删除），拿它跑组件只会验证到一条不存在的路径。
 */
import { createBMapPlugin, existingGlobalV4Provider } from 'baidu-map-gl-vue'
import { createFakeBMapV4 } from '@test-utils-v4'

export type PlaygroundMode = 'fake' | 'real'

export interface PlaygroundSetup {
  mode: PlaygroundMode
  /** 真实模式缺 AK 时为 true：地图会停在 error 状态并给出提示 */
  missingAk: boolean
  plugin: ReturnType<typeof createBMapPlugin>
}

export function createPlaygroundSetup(options: { mode: PlaygroundMode; ak?: string }): PlaygroundSetup {
  if (options.mode === 'real') {
    const ak = options.ak ?? ''
    return { mode: 'real', missingAk: ak.length === 0, plugin: createBMapPlugin({ ak }) }
  }

  const fake = createFakeBMapV4()
  ;(globalThis as unknown as { BMap: unknown }).BMap = fake.namespace
  return { mode: 'fake', missingAk: false, plugin: createBMapPlugin({ provider: existingGlobalV4Provider() }) }
}
