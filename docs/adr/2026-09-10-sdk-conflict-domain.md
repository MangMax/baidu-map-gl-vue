# ADR 2026-09-10：进程级 SDK 冲突域与迁移期分阶段域划分

- 状态：已接受（Accepted）
- 日期：2026-09-10
- 计划键：`M3A1-PROVIDERS`（issue #17，追踪 #12）
- 取代：无
- 相关：`packages/baidu-map-gl-vue/src/core/loader/SdkRegistry.ts`、`packages/baidu-map-gl-vue/src/core/loader/providers/**`

## 背景

`BMap`（JSAPI 4.0）与 `BMapGL`（迁移期 webgl-v1）都是**进程级全局对象**：同一个 realm 里只能存在一份配置，AK / 版本 / 入口 URL 一旦加载就无法并存。

在 #17 之前，registry 是按「namespace」各自持有一份缓存 + 一个 loader：

- 同一个全局对象被多个 namespace 共享，但冲突判定只在 namespace 内部生效，跨 Provider 的不同配置不会互相报冲突；
- registry 自己读 `window`、并持有具体加载实现，因此它既是缓存层又是加载层，难以单测、也把 DOM 依赖带进了本来与 DOM 无关的逻辑。

#16 已经把底层加载能力（显式 `load` / `jsonp`、共享 `<script>`、可取消、可重试）收敛进 `ScriptLoader` / `SharedLoadTask`，registry 有条件只负责「复用与冲突」。

## 决策

1. **冲突管理的单位是「冲突域（domain）」，不是 Provider 实例缓存。** 同一域内：同 fingerprint 的并发 / 后续调用复用同一任务；域内已就绪配置与请求配置不一致时进入冲突策略。
2. **registry 只做两件事**：任务复用 + 冲突判定。加载实现由请求级 `loader` 提供（`SdkRegistry.load({ fingerprint, loader })`），registry 不再持有 loader、不读 `window` / `document`，因此 SSR 导入安全、可脱离 DOM 单测。
3. **默认冲突策略为 `throw`**（`BMAP_SDK_CONFIG_CONFLICT`）。`warn` / `ignore` 只能通过显式配置开启（`getProcessSdkRegistry(domain, { conflictPolicy })`），不能成为默认——全局 SDK 无法真正并存，静默忽略会把「加载了两份配置」变成运行时不可解释的行为。
4. **失败与取消后条目被移除**，允许重试；成功条目复用其结果。
5. **所有 JSAPI 4.0 Provider 共享同一个进程级 `BMap` 域。** 迁移期 legacy Provider 使用独立的 `BMapGL` 域，因为两者对应两个不同的全局对象；M3A.3（#26）删除 legacy 实现后，`BMapGL` 域随之消失。
6. **v4 Provider 返回结构化 `LoadedJsapiV4`**（engine / version / namespace / load metadata），不再返回裸 `unknown`；复用的结果形状由此统一，跨 Provider 复用同一任务才成立。
7. **`./core` 子路径的 Loader 契约在 3.0.0-beta 内直接变更，不保留兼容层**：`SdkLoader` 由 `(options, signal)` 变为请求级 `(signal)`、`SdkRegistry` 构造签名改为 options 对象、`getProcessSdkRegistry(domain, options)` 取代 `(namespace, loader, fingerprintFn)`、移除 `SdkRegistry.global` getter 与未被读取的 entry 字段。
8. **engine 标识的可见范围沿用既有分层**：`./advanced` 已导出 `BMapEngine` / `BMapClient`，因此 `./core` 的 Loader 边界可以导出 `JsapiV4Engine`；**根入口 `src/index.ts` 仍然不导出任何 engine 枚举**，与 ADR 2026-09-10-jsapi-v4-only-baseline 的「面向使用者的公共 API 不得泄漏 engine 枚举」一致。

## 已知限制（显式接受）

- **legacy 与 v4 之间不跨域报冲突**：legacy `readGlobalSdk()` 优先读 `BMap`，会与 v4 Provider 落在同一个物理全局上，但分属两个域，因此过渡期「同一页面同时用 legacy Provider 和 v4 Provider」不会被判定为冲突。默认切换（#25）之后不存在该组合，故不在迁移期兑现。
- **复用已存在的全局无法反查其真实配置**：`globalThis.BMap` 不自述 AK 与版本，`ExistingGlobalV4Provider` / 复用分支只能按本次请求的指纹登记，因此这条路径不产生配置冲突（它仍然校验结构与版本来源）。

## 后果

- 正面：全局配置冲突有唯一、可解释的判定点；registry 无 DOM 依赖、可单测；Provider 返回结构化结果，下游不再靠猜 engine；AK 与 apiUrl 内嵌的 `ak` 都以哈希进入指纹，不落原始值。
- 负面 / 成本：registry 成为进程级单例状态，测试需要显式注入独立域（`new SdkRegistry({ domain })`）或重置；指纹参与冲突判定，任何影响全局语义的新配置都必须同时进入 fingerprint。
- 回滚：恢复「按 namespace 各持一份 registry + registry 内读 `window`」的旧实现即可回滚本决策，回滚不触及 raw SDK 边界与 Capability Catalog。保留旧实现为短期回滚提交。

## 非目标

- 不在本决策中实现 v4 Driver / Facet（M3A.2）与默认 Client 切换（#18）。
- 不承诺一个页面同时加载多个不同 AK / 版本的 `BMap` 全局。
- 不为 `./core` 子路径提供 beta 期兼容层。

## 参考

- issue #17 `[M3A.1] 实现进程级 SDK Registry 与 JSAPI 4.0 Providers`
- issue #16 `[M3A.1] 重构 ScriptLoader：显式 load/jsonp、SharedLoadTask 与 v4 URL`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- ADR [2026-09-10 冻结 JSAPI 4.0 单引擎基线](./2026-09-10-jsapi-v4-only-baseline.md)
- ADR [2026-09-10 BMap / raw SDK / 公共声明边界与 Capability Catalog](./2026-09-10-bmap-raw-sdk-boundary.md)
