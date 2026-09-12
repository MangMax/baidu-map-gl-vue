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

## 测试基建（`packages/test-utils`）

Fake SDK 在 raw SDK 扫描范围之外，是「组件/Facet 与 SDK 之间」的替身边界。两条约定：

- **诊断分两个口径**：`fake.diagnostics.snapshot()` 返回 `leaks`（当前**未释放**的资源，门槛值恒为 0，`assertNoLeaks()` 逐项点名）与 `activity`（累计发生过什么，不要求归零）。定时器与回调是「在飞」而非「未释放」，**只进 `activity` 与 `pendingAsync()`**——需要断言「没有在飞窗口」时要显式写出来。新增资源种类必须同时登记进 `LeakCounters` 与 `LEAK_FIELD_BY_KIND`（后者穷尽，漏登记会编译失败）。
- **跨引擎行为用 driver matrix**：`packages/test-utils/driver-matrix.ts` 的 `runDriverMatrix` / `expectSameDomainResult` 让同一份场景在多个引擎上跑并比较**领域结果**（不比较 raw SDK 调用序列）；引擎差异（Provider 形状、假账本位置、气泡活状态怎么读）一律收在引擎描述里。迁移期双跑只用于验证，不形成长期兼容承诺（见 ADR `2026-09-12-fake-v4-diagnostics-and-dual-driver-matrix`）。
