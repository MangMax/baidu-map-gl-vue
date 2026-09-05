# 错误码与排障

> v3 运行时通过统一的 [`BMapError`](../../packages/baidu-map-gl-vue/src/core/errors/BMapError.ts) 报告错误。
> 所有错误携带 `code`(稳定标识)、`message`、可选 `cause`/`mapId`/`component`/`plugin`。

## 错误码总览

| code | 分类 | 可重试 | 触发场景 |
|---|---|---|---|
| `BMAP_SDK_LOAD_FAILED` | SDK 加载 | ✅ | 在线 Provider 脚本注入失败(网络/拦截/CSP) |
| `BMAP_SDK_LOAD_TIMEOUT` | SDK 加载 | ✅ | 脚本注入超过 `timeout` 未回调 |
| `BMAP_SDK_CONFIG_CONFLICT` | SDK 配置 | ❌ | 进程级 SdkRegistry 检测到冲突配置 |
| `BMAP_PROVIDER_ABORTED` | Provider | ✅ | 加载被 AbortSignal 中止 |
| `BMAP_RUNTIME_DISPOSED` | 运行时 | ❌ | 在 MapRuntime 销毁后访问 |
| `BMAP_PARENT_CONTEXT_MISSING` | 上下文 | ❌ | 子组件未挂在 `BMap` 内(缺少 map context) |
| `BMAP_RESOURCE_CREATE_FAILED` | 资源 | ❌ | Overlay/Control/Layer 创建失败 |
| `BMAP_PLUGIN_LOAD_FAILED` | 插件 | ✅ | 插件脚本加载或初始化失败 |
| `BMAP_INVALID_POINT` | 参数 | ❌ | 传入非法坐标(缺 lng/lat) |

## 错误对象结构

```ts
interface BMapErrorLike {
  code: BMapErrorCode
  message: string
  cause?: unknown
  mapId?: symbol | string
  component?: string
  plugin?: string
  toJSON(): Record<string, unknown>
  retryable: boolean
}
```

- `retryable === true` 的错误(加载/配置类)可以重试。
- `toJSON()` 输出结构化上下文,便于上报面板/日志。

## 逐个排障

### `BMAP_SDK_LOAD_FAILED`

**原因**:在线 CDN 脚本无法注入。
**排查**:
- 检查网络能否访问 `api.map.baidu.com/api`。
- 检查 CSP `script-src` 是否放行。
- 检查 AK 是否有效。
**解决**:使用自定义 Provider(自托管脚本),见[配置指南](./config.md#provider)。

### `BMAP_SDK_LOAD_TIMEOUT`

**原因**:脚本注入后 `callback` 未在 `timeout` 内触发。
**排查**:AK 是否正确、网络是否缓慢、是否被广告拦截。
**解决**:提高 `timeout`,`provider` 注入更可控。

### `BMAP_SDK_CONFIG_CONFLICT`

**原因**:同一进程内多个不同配置请求同一 SDK。
**解决**:统一 Provider/AK;或使用独立 SDK Registry key。

### `BMAP_PROVIDER_ABORTED`

**原因**:组件卸载或用户取消导致加载中止。
**解决**:无需处理(预期行为),重试时会重新加载。

### `BMAP_RUNTIME_DISPOSED`

**原因**:Map 已卸载/销毁后仍调用 `whenReady` 等。
**解决**:在 `onUnmounted` 前完成异步逻辑,或监听 `unload` 事件。

### `BMAP_PARENT_CONTEXT_MISSING`

**原因**:`BMarker`/`BCircle` 等子组件未包裹在 `BMap` 内。
**解决**:将子组件放在 `<BMap>` 的默认插槽中。

### `BMAP_RESOURCE_CREATE_FAILED`

**原因**:SDK 对象创建失败(参数非法、SDK 方法不存在)。
**解决**:检查 props 是否符合组件文档;查看 `cause`。

### `BMAP_PLUGIN_LOAD_FAILED`

**原因**:插件脚本加载或 `load()` 失败。
**解决**:插件插件版本是否与 SDK 兼容;检查 `plugin` 字段;使用 `urlPluginDefinition` 固定版本。

### `BMAP_INVALID_POINT`

**原因**:position/center 等缺少 `lng`/`lat`。
**解决**:传入 `{ lng, lat }` 合法对象。

## 统一捕获

组件通过 `@resource-error`/`@error` 事件接收错误,或经 map context 的 `events` 总线订阅 `resource:error`:

```ts
import { useBMapContext } from 'baidu-map-gl-vue'

const ctx = useBMapContext()
ctx.events.on('resource:error', (e) => {
  console.error(e.error.code, e.error.toJSON())
})
```

> v2 迁移:错误处理从 `initd` 回调切换到统一错误事件/`BMapError`,见[迁移指南](./migration-from-v2.md)。
