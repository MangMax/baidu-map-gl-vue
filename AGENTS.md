# AGENTS.md

本文件面向在此仓库工作的 AI Agent（OpenCode、Claude Code、Codex、Copilot 等）与人类贡献者，说明不可违背的边界、命令与知识来源。

## 项目概览

- 目标：Vue 3 的百度地图组件/hooks 库 `baidu-map-gl-vue`。
- 当前状态：v3 beta。SDK 基线正在从 JSAPI GL v1（`BMapGL`）迁移到 JavaScript API 4.0（全局 `BMap`）。
- 工程：pnpm workspace（Node >= 24，pnpm >= 12），Vite + vue-tsc + Vitest + VitePress。

## 版本模型（务必区分）

| 维度 | 当前取值 |
| --- | --- |
| 组件库版本 | `3.0.0-beta.x`（`packages/baidu-map-gl-vue/package.json`） |
| SDK engine（内部） | `webgl-v1` / `jsapi-v3` / `jsapi-v4`（`driver/types/bmap.ts`） |
| SDK version | Stable 目标 `4.0`（加载 `v=4.0`） |
| 官方类型包 | `@baidumap/jsapi-v4-types` 精确 `4.0.4`（开发期依赖） |

讨论「升级」时必须说明是哪一种版本。详见 `docs/adr/2026-09-10-jsapi-v4-only-baseline.md`。

## 不可违背的边界

- `BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK、`src/driver/jsapi-v4/**` 类型边界与最小 augmentation。
- 组件、业务 composable、runtime 只能依赖项目领域类型与 Facet Driver，禁止直接访问 `window.BMap`/`window.BMapGL`。
- raw SDK 只允许出现在 `src/driver`、`src/client`、`src/core/loader`、`src/plugins` 适配层与 Fake 边界；全局探测统一走 `hasExistingGlobalSdk()`。
- 公共 API 不泄漏 `BMap.*`，raw SDK 仅通过 `baidu-map-gl-vue/advanced`（`unwrapRaw`/`createDriver`）提供逃生口。
- 任何监听器、覆盖物、控件、图层、服务结果、Observer、Timer、RAF、动画都必须有明确释放路径。
- 禁止提交真实 AK/密钥。

## 常用命令

```bash
pnpm install
pnpm typecheck:v3        # vue-tsc -p packages/baidu-map-gl-vue/tsconfig.build.json（skipLibCheck: false）
pnpm test:unit           # vitest tests/behavior tests/__smoke__.test.ts
pnpm build:v3            # 构建 ESM + 声明 + CDN iife
pnpm check:raw-sdk       # raw SDK 静态扫描门禁
pnpm docs:build          # 文档站构建
pnpm docs:check          # 文档 format:check + lint + typecheck
```

完成改动后至少运行 `pnpm typecheck:v3 && pnpm test:unit && pnpm build:v3`；涉及文档时再跑 `pnpm docs:build`。

## SDK 类型基线

- 官方类型包是纯 `.d.ts`，**不是运行时依赖**，不得具名导入：
  - 反例：`import { Map } from "@baidumap/jsapi-v4-types"`。
  - 正例：使用全局 `BMap.Map`，类型由 tsconfig `types` / `/// <reference types>` 提供。
- 接入位置：`packages/baidu-map-gl-vue/tsconfig.build.json` 的 `compilerOptions.types`。
- 边界与 augmentation：`packages/baidu-map-gl-vue/src/driver/jsapi-v4/types-reference.d.ts`。
- 保持 `skipLibCheck: false`。官方声明缺口只允许在边界文件做最小 augmentation；禁止 `any` 或复制整套声明。升级类型包后必须重新核对并删除已被官方覆盖的 augmentation。
- 类型检查通过不代表 SDK 真实可用；依赖 AK/网络/CORS/WebGL/在线数据的能力必须在真实浏览器验证。

## 官方 Skill：`bmap-jsapi-v4`

本仓库通过 `skills` CLI 管理官方 Skill，**不要手工复制或改写 Skill 文件**。

```bash
# 查看
npx skills list

# 安装（按 skills-lock.json 恢复）
npx skills experimental_install

# 安装/更新单个 Skill
npx skills add baidu-maps/jsapi-skills --skill bmap-jsapi-v4
npx skills update bmap-jsapi-v4
```

- 安装产物：`.agents/skills/bmap-jsapi-v4/`（规范副本）与 `.claude/skills/bmap-jsapi-v4`（符号链接），由 `skills-lock.json` 锁定版本。
- 使用规则：仅作为 `v=4.0` + 全局 `BMap` 的 API 参考；不得混用其他版本加载参数/命名空间；不得把 Skill 文件当作源码或运行时依赖。
- 触发场景：开发、审查或排查百度地图 JavaScript API 4.0、`v=4.0` 加载器或全局 `BMap` 命名空间的代码时，先加载该 Skill 的对应 reference。
- 详细说明：`docs/zh-CN/contributing/ai-development.md`。

## 文档与 ADR

- ADR 一律使用日期前缀命名：`docs/adr/YYYY-MM-DD-<slug>.md`（同日多条用 `<slug>` 区分）。
- 涉及 SDK 基线、公共 API 契约、包发布策略的改动必须先写 ADR；已接受的 ADR 不原地改写，用新 ADR 取代。
- ADR 索引：`docs/adr/README.md`。
