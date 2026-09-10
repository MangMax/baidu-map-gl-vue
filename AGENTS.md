# AGENTS.md

## 项目

`baidu-map-gl-vue`：Vue 3 的百度地图组件/hooks 库。

工程：pnpm workspace（Node >= 24，pnpm >= 12），Vite + vue-tsc + Vitest + VitePress。

## 版本模型

| 维度 | 说明 |
| --- | --- |
| 组件库版本 | `packages/baidu-map-gl-vue/package.json` |
| SDK engine（内部） | `webgl-v1` / `jsapi-v3` / `jsapi-v4`（`src/driver`） |
| SDK version | `4.0`（`v=4.0`） |

讨论「升级」时需说明是哪一种版本。

## 架构与模块分布

组件库源码在 `packages/baidu-map-gl-vue/src`，顶层模块：

- `driver`：raw SDK 边界与 Facet Driver。
- `client`：`createBMapClient`，聚合 Driver 与运行时能力。
- `core`：loader/provider、context、lifecycle、runtime、events、errors 等底座。
- `components`、`composables`：面向使用者的 Vue 组件与 hooks。
- `plugins`、`resolver`、`advanced`：插件适配、按需解析、raw SDK 逃生口。
- `types`、`manifest`：公共类型与组件清单。

约定：`BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK 与最小类型边界；组件/composable/runtime 只依赖项目领域类型与 Facet Driver，不得直接访问全局 SDK。所有监听器、覆盖物、控件、图层、服务结果、Observer、Timer、RAF 与动画都必须有释放路径。

## SDK 边界与门禁

边界配置的单一事实源：`scripts/raw-sdk-boundary.mts`（白名单 + 命名空间/全局对象清单）；
检测引擎：`scripts/raw-sdk-detector.mts`（源码门禁与公共声明门禁共用）。

raw SDK 白名单（相对 `packages/baidu-map-gl-vue/src`）：`driver/**`、`client/**`、`core/loader/**`、`plugins/**`；
`packages/test-utils` 作为 Fake 边界在扫描范围之外。其余目录（`components`、`composables`、`core/runtime` 等）为禁区。

| 命令 | 作用 |
| --- | --- |
| `pnpm check:raw-sdk` | 禁区目录静态扫描（`BMapGL`、`window.BMap`、`new BMap.*`、`BMap.*` 类型、`namespace BMap`、官方类型包导入） |
| `pnpm check:raw-sdk:tree` | 以白名单扫描整棵 `src` |
| `pnpm check:public-dts` | `dist/**/*.d.ts` 不得泄漏 `BMap.*` / `BMapGL` / 官方类型包引用（需先 `pnpm build:v3`） |
| `pnpm generate:capability-matrix:check` | Capability Catalog 能力矩阵无漂移 |

类型边界 augmentation 位于 `src/driver/jsapi-v4/augmentations/`，治理规则与元数据模板见该目录 `README.md`；
每个文件必须带 `@upstream` / `@upstreamVersion` / `@runtimeBasis` / `@deletionCondition` 元数据，禁止 `any`。

Capability Catalog 是能力清单的单一事实源（`src/driver/capability/catalog.ts`），
覆盖 Map / Overlay / Layer / Service / Panorama / Runtime，用 `status`（`native` / `extended` / `experimental` / `unsupported`）与 `runtimeOnly` 表达能力语义；
能力矩阵由 `pnpm generate:capability-matrix` 生成，禁止手工编辑。
