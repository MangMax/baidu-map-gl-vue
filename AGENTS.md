# AGENTS.md

## 项目

`baidu-map-gl-vue`：Vue 3 的百度地图组件/hooks 库。

v3 正处于从 JavaScript API GL v1（`BMapGL`）迁移到 JavaScript API 4.0（`v=4.0`，全局 `BMap`）的过程中，Stable 目标是 JSAPI 4.0 单引擎。

工程：pnpm workspace（Node >= 24，pnpm >= 12），Vite + vue-tsc + Vitest + VitePress。

## 版本模型

| 维度 | 说明 |
| --- | --- |
| 组件库版本 | `packages/baidu-map-gl-vue/package.json` |
| SDK engine（内部） | `webgl-v1` / `jsapi-v3` / `jsapi-v4`（`src/driver/types/bmap.ts`） |
| SDK version | Stable 目标 `4.0`（`v=4.0`） |

讨论「升级」时需说明是哪一种版本。

## 架构与模块分布

- `packages/baidu-map-gl-vue/src/driver`：Facet Driver（geometry/map/overlays/controls/layers/services/panorama/events）、capability 与 raw SDK 边界。
- `src/client`：`createBMapClient`，聚合 Driver 与运行时能力。
- `src/core`：loader/provider、context、lifecycle、runtime、composables、data、events、errors 等底座。
- `src/components`、`src/composables`：面向使用者的 Vue 组件与 hooks。
- `src/plugins`、`src/resolver`、`src/advanced`：插件适配、按需解析、raw SDK 逃生口。
- `docs/`：VitePress 文档站；`docs/adr/`：架构决策记录；`apps/playground`：本地调试。

约定：`BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK 与最小类型边界；组件/composable/runtime 只依赖项目领域类型与 Facet Driver，不得直接访问全局 SDK。所有监听器、覆盖物、控件、图层、服务结果、Observer、Timer、RAF 与动画都必须有释放路径。
