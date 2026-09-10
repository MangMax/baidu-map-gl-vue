# AI 开发与官方 Skill

本页说明在本仓库中使用 AI Agent 与百度地图官方资料的规则。核心原则：**官方 Skill 与官方类型包都是开发期知识来源，不是运行时依赖**。

## 版本模型

仓库里同时存在三种「版本」，讨论时必须区分：

| 维度 | 含义 | 当前取值 |
| --- | --- | --- |
| 组件库版本 | `baidu-map-gl-vue` 包版本 | `3.0.0-beta.x` |
| SDK engine | 项目内部驱动引擎枚举（`webgl-v1` / `jsapi-v3` / `jsapi-v4`） | 迁移期并存，Stable 目标 `jsapi-v4` |
| SDK version | 百度地图 JSAPI 运行时版本 | Stable 目标 `4.0`（`v=4.0`） |
| 官方类型包版本 | `@baidumap/jsapi-v4-types` | `4.0.4`（精确锁定） |

决策依据见 [ADR 0016：冻结 JSAPI 4.0 单引擎基线](/adr/0016-jsapi-v4-only-baseline)。

## 官方 Skill：`bmap-jsapi-v4`

官方 Skill 是百度地图维护的 JSAPI 4.0 开发知识包，覆盖加载、Map、覆盖物、图层、服务、生命周期与排障。它在编码、评审、排障时提供 API 参考，**不是源码、不是依赖、不参与打包**。

### 安装与更新（必须使用 skills CLI）

本仓库用 [`skills`](https://skills.sh) CLI 管理，安装产物由 `skills-lock.json` 锁定。不要手工复制或改写 Skill 文件。

```bash
# 查看已安装
npx skills list

# 首次安装（会写入 .agents/skills 与 .claude/skills，并更新 skills-lock.json）
npx skills add baidu-maps/jsapi-skills --skill bmap-jsapi-v4

# 按锁文件恢复到干净环境
npx skills experimental_install

# 更新到最新版本
npx skills update bmap-jsapi-v4
```

安装落点：

- `.agents/skills/bmap-jsapi-v4/` —— 规范副本（含 `SKILL.md` 与 `references/`）。
- `.claude/skills/bmap-jsapi-v4` —— 指向规范副本的符号链接。
- `skills-lock.json` —— 版本与完整性哈希，必须随仓库提交。

### 使用规则

- 只把它当作 `v=4.0` + 全局 `BMap` 的 API 参考，**禁止混用其他版本的加载参数与命名空间**（如 `BMapGL`、`v=1.0`）。
- 从 reference 中选取满足需求的最小 API 组合，不要凭类名猜测构造参数、事件或清理方法。
- 创建监听器、覆盖物、控件、图层、服务结果、动画、全景或 `Map` 时，必须同时给出解绑/移除/取消/销毁路径。
- 依赖 AK、在线服务、CORS、WebGL 或真实数据的结果**必须在真实浏览器验证**；类型检查通过不等于运行成功。
- 不得把 Skill 文件当作源码引用、复制进 `src/` 或打进构建产物。

## 官方类型包

`@baidumap/jsapi-v4-types` 以精确版本声明在 `packages/baidu-map-gl-vue/package.json`，并通过 `packages/baidu-map-gl-vue/tsconfig.build.json` 的 `compilerOptions.types` 接入。

- 纯 `.d.ts`，没有运行时代码，也不是运行时依赖。
- 业务代码使用全局 `BMap.*`，**禁止具名导入**：

  ```ts
  // 错误
  import { Map } from "@baidumap/jsapi-v4-types";

  // 正确：类型由全局命名空间提供
  const map = new BMap.Map("container");
  ```

- 官方声明缺口只在 `packages/baidu-map-gl-vue/src/driver/jsapi-v4/types-reference.d.ts` 做最小 augmentation；禁止 `any`、禁止复制整套声明。
- 保持 `skipLibCheck: false`。升级类型包后必须重新核对 augmentation，官方补齐的声明要删除。

## AI Agent 边界

- `BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK、`src/driver/jsapi-v4/**` 类型边界与最小 augmentation。
- 组件、业务 composable、runtime 只能依赖项目领域类型与 Facet Driver，禁止直接访问 `window.BMap` / `window.BMapGL`。
- raw SDK 只允许出现在 `src/driver`、`src/client`、`src/core/loader`、`src/plugins` 适配层与 Fake 边界。
- 任何资源都必须有释放路径；`pnpm check:raw-sdk` 是硬门禁。

## 提交前验证

```bash
pnpm typecheck:v3   # 官方类型接入后仍要求通过
pnpm test:unit
pnpm build:v3
pnpm docs:build     # 涉及文档时
```

涉及 SDK 行为的改动，在 PR 描述中说明：

- SDK 依据（`v=4.0`/`BMap` 还是迁移期 `webgl-v1`）；
- 生命周期检查（监听器/覆盖物/控件/图层/异步/动画的释放路径）；
- 迁移影响（是否改变公共 API、是否影响 2.x/3.x 支持政策）。
