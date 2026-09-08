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

基于百度地图 JavaScript GL 版（使用了 WebGL 对地图、覆盖物等进行渲染，支持 3D 视角展示地图） API 封装设计的 Vue3 组件/hooks 库，开箱即用。

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

## <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Open%20Book.png" alt="Open Book" width="25" height="25" /> 文档

[中文](https://MangMax.github.io/baidu-map-gl-vue/)


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
