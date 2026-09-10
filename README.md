<p align="center">
  <a href="https://MangMax.github.io/baidu-map-gl-vue/zh-CN" target="_blank" rel="noopener noreferrer">
  <img src='https://github.com/MangMax/baidu-map-gl-vue/blob/main/docs/public/logo.svg' crossorigin="anonymous" style="overflow:hidden; width:180px;height:180px;border-radius:48px;">
  </a>
</p>

<h1 align="center"><img src="https://user-images.githubusercontent.com/74038190/213844263-a8897a51-32f4-4b3b-b5c2-e1528b89f6f3.png" width="50px" />&nbsp;Vue3 BaiduMap Gl&nbsp;<img src="https://user-images.githubusercontent.com/74038190/213844263-a8897a51-32f4-4b3b-b5c2-e1528b89f6f3.png" width="50px" /></h1>

<p align="center">易用 & 完整 & 高性能</p>
<p align="center"><strong>v3 beta</strong></p>
<p align="center">
<img src="https://img.shields.io/github/license/MangMax/baidu-map-gl-vue?style=flat-square" alt="" />
<img src="https://img.shields.io/github/package-json/v/MangMax/baidu-map-gl-vue?color=f90&style=flat-square" alt="GitHub package.json version (subfolder of monorepo)"/>
<img alt="npm" src="https://img.shields.io/npm/dm/baidu-map-gl-vue?logo=npm&style=flat-square" />
<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/MangMax/baidu-map-gl-vue?style=flat-square&color=%23daaa3f">
<img alt="GitHub issues" src="https://img.shields.io/github/issues/MangMax/baidu-map-gl-vue?style=flat-square" />
<img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/MangMax/baidu-map-gl-vue?style=flat-square">
<br />



</div>
</p>

面向 Vue 3 的百度地图组件/hooks 库，开箱即用。`v3` 正处于从百度地图 JavaScript GL 版（`BMapGL`）迁移到 **JavaScript API 4.0**（`v=4.0`，全局 `BMap`）的过程中；Stable 将只支持 JSAPI 4.0 单引擎基线，详见 [ADR 2026-09-10](./docs/adr/2026-09-10-jsapi-v4-only-baseline.md)。

## <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/Star.png" alt="Star" width="25" height="25" /> Star

如果喜欢这个项目，右上角给我们点个星星吧，这对我们意义非凡！

<img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Hand%20gestures/Backhand%20Index%20Pointing%20Right.png" alt="Backhand Index Pointing Right" width="55" height="55" /><img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/Glowing%20Star.png" alt="Glowing Star" width="55" height="55" /><img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Hand%20gestures/Backhand%20Index%20Pointing%20Left.png" alt="Backhand Index Pointing Left" width="55" height="55" />

## <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Activities/Sparkles.png" alt="Sparkles" width="25" height="25" /> 特性

- 🚀 自动加载百度地图 SDK，将百度地图繁琐的 Api 封装进组件，你只需关注组件本身
- 📦 20+ 高质量的开箱即用 Vue 3 组件以及 8+ hooks 封装
- 📐 遵循直觉的、简约的 Api 设计
- ⚡ Composition Api，更好的性能
- 🔨 完整的 TypeScript 支持，更好的体验
- 🧩 tree shaking 支持，模块分包，只打包你想要的的
- 🌏 基于百度地图 Gl 版 SDK，通过 WebGL 对地图、覆盖物等进行渲染，支持 3D 视角展示地图
- 🚀 支持 volar，组件提供完善的代码提示

## <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Gear.png" alt="Gear" width="25" height="25" /> 安装

推荐使用 pnpm 安装

```bash
# with pnpm
pnpm add baidu-map-gl-vue

# or with yarn
yarn add baidu-map-gl-vue

# or with npm
npm install baidu-map-gl-vue
```

## v3 快速开始

v3 要求 Node.js >= 24、pnpm >= 12，并使用 workspace 中声明的 `pnpm@12.0.0`。

```ts
import { BMap } from 'baidu-map-gl-vue'

// 推荐通过 createBMapPlugin 配置 provider/client，再将 provider 传给 BMap。
// 也可以在已有 window.BMapGL 时直接使用 BMap。
```

v3 的开发与构建命令以 workspace scripts 为准：

```bash
pnpm install
pnpm playground:dev
pnpm docs:dev
pnpm build:v3
pnpm typecheck:v3
```

从 v2 迁移请先阅读 `scripts/migrate-v2-to-v3.mts` 及文档站的 v3 迁移说明。v3 组件使用 `BMap`、`BMarker` 等 Vue 3 组件，SDK 加载通过 provider/client 管理；`BPointLayer` 已标记为 deprecated，新的列表组件名为 `BMarkerList`。

v3 架构：所有 raw `BMapGL` 调用收进 `src/driver`（geometry/map/overlays/controls/layers/services/events）与 `src/client`（`createBMapClient`）。组件与业务 composable 只依赖 `client + MapHandle` 领域接口，raw SDK 仅通过 `baidu-map-gl-vue/advanced`（`unwrapRaw`/`createDriver`）提供逃生口；能力支持度经 `CapabilityRegistry` 运行时解释，`unsupported` 策略可选 `throw/warn/silent`。仓库门禁 `pnpm check:raw-sdk` 保证 `src/components`、`src/composables`、`src/core/runtime` 不出现 `window.BMapGL`/`new BMapGL.*`。

## <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Open%20Book.png" alt="Open Book" width="25" height="25" /> 文档

[中文](https://MangMax.github.io/baidu-map-gl-vue/)

- [从 v2 迁移](https://MangMax.github.io/baidu-map-gl-vue/zh-CN/guide/migration-from-v2)
- [AI 开发与官方 Skill](https://MangMax.github.io/baidu-map-gl-vue/zh-CN/contributing/ai-development)

## 版本与支持政策

仓库中同时存在三种「版本」，讨论升级时必须区分：**组件库版本**、**SDK engine**（内部 `webgl-v1` / `jsapi-v3` / `jsapi-v4`）与 **SDK version**（百度地图 JSAPI `v=4.0`）。

| 组件库版本 | SDK 基线 | 支持状态 |
| --- | --- | --- |
| `baidu-map-gl-vue@2.x` | JSAPI GL v1（`BMapGL`） | 仅安全/关键修复 |
| `baidu-map-gl-vue@3.0.0-beta.x` | 迁移期：GL v1 过渡 + JSAPI 4.0 目标 | 开发中，API 未冻结 |
| `baidu-map-gl-vue@3.0.0`（Stable） | JavaScript API 4.0（全局 `BMap`） | 唯一稳定基线 |

- v3 Stable 的目标是 **单引擎**：只支持 `v=4.0` 与全局 `BMap`，不提供 `BMapGL` 回退；需要 `BMapGL` 请停留在 2.x。
- 官方类型包 `@baidumap/jsapi-v4-types` 精确锁定为开发期依赖，不进入运行时 bundle；官方 Skill `bmap-jsapi-v4` 通过 `skills` CLI 管理，仅作开发参考。
- 完整决策、回滚边界与非目标见 [ADR 2026-09-10](./docs/adr/2026-09-10-jsapi-v4-only-baseline.md)。

### Roadmap

v3 按「前置审计 → v4 决策与边界 → v4 Loader/Provider → v4 Driver → 默认切换与删除 BMapGL → Vue Map/Overlay API → 原生数据/服务/插件 → 包与发布冻结 → Stable」推进，总追踪见 [issue #12](https://github.com/MangMax/baidu-map-gl-vue/issues/12)。

## <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Hammer%20and%20Wrench.png" alt="Hammer and Wrench" width="25" height="25" /> 开发参与贡献

```bash
# 环境
# pnpm >= 12.0.0
# node >= 24.0.0

# clone
git clone https://github.com/MangMax/baidu-map-gl-vue
cd ./baidu-map-gl-vue

# install
pnpm install

# 运行 playground
pnpm playground:dev

# 运行文档站点，用来测试组件，预览文档
pnpm docs:dev
```

## <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/Star.png" alt="Star" width="25" height="25" /> Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MangMax/baidu-map-gl-vue&type=Timeline)](https://star-history.com/#MangMax/baidu-map-gl-vue&Timeline)

## License

[MIT licenses](https://opensource.org/licenses/MIT)
