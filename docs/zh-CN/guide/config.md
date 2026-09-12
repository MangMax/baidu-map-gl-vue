---
title: 配置
lang: zh-CN
---

# 配置

本章节将为你讲述如何配置 ak、apiUrl 与插件。v3 通过 Client 定义表达 SDK 加载，
只有 `app.use()`（默认定义）、`<BMapProvider>`（子树覆盖）与 `<BMap>` 自身 props 三处入口。

## Client 查找顺序

`<BMap>` 按以下顺序解析 SDK Client，命中即停：

1. 显式 `client` prop（已创建好的 `BMapClient`）
2. 显式 `definition` prop（`createBMapClientDefinition({ provider, loadOptions })`）
3. 显式 `provider/ak/apiUrl` props（就地组装定义）
4. 最近的 `<BMapProvider>` 提供的 Client 上下文
5. `app.use(createBMapPlugin(...))` 提供的默认定义
6. 若都没有：页面里已经存在**结构完整**的 `globalThis.BMap` 时，经 Loader 边界回退并 `warn`；否则报错（不再静默读取任何全局 SDK）

服务类 hooks（如 `useBMapGeocoder`）只需要 Client，可在 `<BMap>` 或 `<BMapProvider>` 子树内直接使用，无需地图实例。

## 默认 SDK：JSAPI 4.0

自 `3.0.0-beta` 的这一版起，**默认入口**（不显式传 `provider`）使用 JSAPI 4.0 CDN 家族：

```ts
// 等价于 createBMapPlugin({ provider: baiduJsapiV4Provider(), ak })
app.use(createBMapPlugin({ ak: '百度地图ak' }))
// → https://api.map.baidu.com/api?v=4.0&ak=... ，就绪回调后读取并校验 globalThis.BMap
```

- 入口**不带** `type=webgl`：4.0 入口本身就是 WebGL 引擎，`type=webgl` 是旧 GL 版的参数。
- 就绪信号是 JSONP `callback`，不是 `<script>` 的 `load` 事件（官方明确「不要仅凭 load 事件
  认为 BMap 可用」）。
- `allowExistingGlobal: true` 等价于 `provider: existingGlobalV4Provider()`：只复用页面里**已经
  就绪**的 `globalThis.BMap`（`Map` / `Point` / `Marker` 齐备），不完整即失败，不降级。
- `version` 默认 `4.0`，且只接受 4.x——显式声明其它版本会直接失败，不会静默按 4.0 加载。

### 显式选择 Provider

| 场景 | 用法 |
| --- | --- |
| 默认（在线 CDN） | `createBMapPlugin({ ak })` |
| 复用已有全局 | `createBMapPlugin({ provider: existingGlobalV4Provider() })` 或 `allowExistingGlobal: true` |
| 自建 / 私有入口 | `customScriptV4Provider('https://self.hosted/bmap.js', { mode: 'jsonp' \| 'load' })` |
| 迁移期旧引擎（`webgl-v1`） | 显式 `baiduCdnProvider()`；**已在删除计划内**，新代码不要用 |

`./advanced` 的 `createBMapClient()` 只接受结构化的 `BMapProviderLike`——`load()` 返回
`LoadedSdk`：

```ts
// JSAPI 4.0（Stable 基线）
{ engine: "jsapi-v4", version: "4.0", namespace: globalThis.BMap, load: { /* metadata */ } }
// 迁移期 webgl-v1（版本由 Driver 创建时探测，Loader 不声明）
{ engine: "webgl-v1", namespace: globalThis.BMapGL }
```

`createClientContext()` 做同样的归一：**同一份 definition 在任何入口**（`<BMap>` /
`<BMapProvider>` / 插件默认 definition / `resolveMapContext`）行为一致；需要固定 Driver 实现时
显式传 `definition.driver`。

> 迁移期说明：显式传入的 Provider 仍按**加载结果的 engine** 分派 Driver，所以
> `createBMapPlugin({ provider: baiduCdnProvider() })` 依旧落在旧引擎上。这条分派随
> [#26](https://github.com/Mang-X/bmap-vue/issues/26) 删除 `webgl-v1` 时一并收敛，
> 决策见 `docs/adr/2026-09-12-jsapi-v4-default-cutover.md`。

## 配置方式

目前支持三种方式：全局 `app.use` 默认定义、`<BMapProvider>` 子树覆盖、组件 props 传入。
当同时指定时，按上面的查找顺序，就近优先。

### 迁移期：Driver 选择

组件默认路径（`app.use` / `<BMapProvider>` / `<BMap>`）按**加载结果的 engine** 分派 Driver：

- `jsapi-v4`（Stable 基线，**默认**）：全部 Facet 已装配，可用；
- `webgl-v1`（迁移期 legacy）：只有显式传入 legacy Provider（`baiduCdnProvider()` /
  `existingGlobalProvider()` / `customScriptProvider()`）或显式声明 `engine: "webgl-v1"` 时会走到，
  随 [#26](https://github.com/Mang-X/bmap-vue/issues/26) 删除。

### 1。通过全局注册配置 ak 与插件

全局注册 Options（`createBMapPlugin`）：

| 属性               | 说明                                             | 类型               | 默认值 |
| ------------------ | ------------------------------------------------ | ------------------ | ------ |
| ak                 | 百度地图 [ak](../guide/quick-start#申请-ak-密钥) | `string`           | -      |
| apiUrl             | 自建地图 api 资源地址（一般用于离线地图）        | `string`           | -      |
| version            | SDK 版本（只接受 4.x）                           | `string`           | `4.0`  |
| provider           | 自定义加载器（默认 JSAPI 4.0 的 CDN Provider）   | `AnyBMapProviderLike` | `baiduJsapiV4Provider()` |
| plugins            | 需要注册的插件                                   | `string[]`         | -      |
| defaults           | 透传的加载选项                                   | `BMapLoadOptions`  | -      |
| allowExistingGlobal| 复用页面里已就绪的全局 `BMap`                    | `boolean`          | -      |
| client             | 完整自定义 Client 定义（覆盖以上组装）           | `CreateBMapClientOptions` | - |

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { createBMapPlugin } from 'baidu-map-gl-vue'

const app = createApp(App)
app.use(createBMapPlugin({
  ak: '百度地图ak',
  plugins: ['TrackAnimation']
}))
app.mount('#app')
```

### 2。用 `<BMapProvider>` 覆盖子树默认

```vue
<template>
  <BMapProvider :definition="definition" @ready="onReady" @error="onError">
    <template #loading>SDK 加载中…</template>
    <template #error="{ error, retry }">
      <button @click="retry">加载失败：{{ error.message }}，点击重试</button>
    </template>
    <RouterView />
  </BMapProvider>
</template>

<script setup lang="ts">
import { BMapProvider, baiduJsapiV4Provider } from 'baidu-map-gl-vue'

const definition = {
  provider: baiduJsapiV4Provider(),
  loadOptions: { ak: '百度地图ak' }
}
function onReady() {}
function onError() {}
</script>
```

### 3。组件 `BMap` 传入 [`props`](/zh-CN/components/map#%E9%9D%99%E6%80%81%E7%BB%84%E4%BB%B6-props) 配置

<!-- prettier-ignore -->
```html
<BMap
  ak='百度地图ak'
  :plugins="['TrackAnimation']"
/>
```

## 扩展插件 plugins

配置插件后，地图实例 ready 不会等待插件加载。请通过 [BMap 组件的 `plugin-ready` 事件](../components/map#v3-行为说明) 获取单个已加载插件的名称（载荷即插件名字符串）；插件加载失败通过 `plugin-error` 处理。v2 的 `pluginReady` 事件在 v3 已移除，请改用 kebab 写法 `@plugin-ready`。

::: warning 插件在 JSAPI 4.0 上的状态
切换默认 SDK 到 4.0 后，内置插件里**没有任何一个**有「在 4.0 上验证通过」的运行时证据。
下表最后一列是当前结论与证据；没有运行时证据的一律记为 `未验证`，**不当作可用**。
结论明细与后续动作见 [JSAPI 4.0 默认切换 ADR](../../adr/2026-09-12-jsapi-v4-default-cutover)
的「插件兼容 inventory」。
:::

| PluginId                                                                                 | 插件名称         | 描述                                                                               | 版本                               | 4.0 状态 |
| ---------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| [TrackAnimation](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#视角轨迹动画) | 视角轨迹动画     | TrackAnimation 类提供视角轨迹动画展示效果。                                        |                                    | **不兼容（待复核）**：脚本加载成功后运行时抛错 |
| [Mapvgl](https://mapv.baidu.com/gl/docs/index.html)                                     | MapVGL 可视化    | 基于 WebGL 的点、线、面和热力图图层。                                      |                                    | 未验证（→ #43） |
| [DrawingManager](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file)              | 鼠标绘制工具条库 | 提供鼠标绘制点、线、面、多边形（矩形、圆）的编辑工具条的开源代码库。               | <Badge type="tip" text="^2.5.0" /> | 未验证（→ #43） |
| [DistanceTool](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#测距工具)       | 测距工具         | 测距工具类                                                                         | <Badge type="tip" text="^2.5.0" /> | 无内置定义（→ #42） |
| [GeoUtils](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#几何运算)           | 几何运算         | 提供若干几何算法                                                                   | <Badge type="tip" text="^2.5.0" /> | 未验证（→ #43） |
| [AreaRestriction](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#区域限制)    | 区域限制         | 浏览区域限制类                                                                     | <Badge type="tip" text="^2.5.0" /> | 无内置定义（→ #42） |
| [InfoBox](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#自定义信息窗口)      | 自定义信息窗口   | 类似于 infoWindow，比 infoWindow 更有灵活性，比如可以定制 border，关闭按钮样式等。 | <Badge type="tip" text="^2.5.0" /> | 无内置定义（→ #42） |
| [RichMarker](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#富标注)           | 富标注           | 富 Marker 类                                                                       | <Badge type="tip" text="^2.5.0" /> | 无内置定义（→ #42） |
| [LuShu](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#路书)                  | 路书             | 路书类，实现 Marker 沿路线运动                                                     | <Badge type="tip" text="^2.5.0" /> | 无内置定义（→ #42） |

### 更换插件资源链接

如果需要自建或其他地址的资源链接，请用 `customScriptV4Provider(scriptSrc, { mode })` 构造
Provider，再经 `createBMapPlugin({ provider })` 或 Client 定义传入。
`mode` 缺省是 `load`（script 的 `load` 事件）；**入口确实支持 `callback` 时**必须显式传 `jsonp`——
「传了 apiUrl 就猜 JSONP」是错的，JSONP 只有在入口确实支持 `callback` 时才是正确的就绪信号。

```ts
import { createBMapPlugin, customScriptV4Provider } from 'baidu-map-gl-vue'

app.use(createBMapPlugin({
  provider: customScriptV4Provider('https://self.hosted/bmap.js', { mode: 'load' }),
  defaults: { ak: '百度地图ak' }
}))
```

同样支持组件级覆盖：

<!-- prettier-ignore -->
```html
<BMap
  :plugins="['TrackAnimation']"
  apiUrl="https://self.hosted/bmap.js"
/>
```

### 自定义插件定义

除了内置插件（`TrackAnimation` / `Mapvgl` / `DrawingManager`，经 `plugins: ['xxx']` 声明），
你还可以通过插件定义扩展。插件定义 shape 见 `BMapPluginDefinition`（`name/scope/dependencies/required/load/setup/dispose`），
用 `urlPluginDefinition` 或 `stringToPluginDefinitions` 构造，并在需要地图的组件内经 PluginRegistry 注册。
插件加载结果通过 `plugin-ready` / `plugin-error` 事件回执。
