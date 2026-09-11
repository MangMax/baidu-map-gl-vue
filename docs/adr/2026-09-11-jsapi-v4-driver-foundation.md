# ADR 2026-09-11：v4 Driver 基础边界（Namespace / Handle Registry / Geometry / Event）

- 状态：已接受（Accepted）
- 日期：2026-09-11
- 计划键：`M3A2-FOUNDATION`（issue #19，追踪 #12）
- 取代：无
- 相关：[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)、[`2026-09-10-jsapi-v4-only-baseline`](./2026-09-10-jsapi-v4-only-baseline.md)、[`2026-09-11-loaded-sdk-client-boundary`](./2026-09-11-loaded-sdk-client-boundary.md)

## 背景

M3A.1 已经把加载结果收敛成结构化的 `LoadedSdk`，并让默认 `createBMapClient` 只接受
`jsapi-v4`。但 `createJsapiV4Driver` 仍然**只有契约**：Facet Driver 本体属于 M3A.2
（#19~#23）。在实现任何业务 Facet 之前，必须先落地四件底座能力，否则每个 Facet 都会各写
一套：

- 「读到的全局 `BMap` 到底是不是可用的 4.0 命名空间」没有统一判定；
- raw SDK 对象与项目 `SdkHandle` 之间没有登记表，句柄 identity 与**所有权**无从校验；
- 几何值对象（`Point` / `Pixel` / `Size` / `Bounds`）的构造与归一化没有统一口径，`NaN`
  可能被静默带进 SDK（例如 `new BMap.Size(NaN, 2)` 会让覆盖物直接不可见）；
- 事件订阅没有统一的释放语义：官方 API 按**函数身份**解绑，组件每次重渲染都换 handler，
  直连 `addEventListener` 必然泄漏，而迁移期的 `webgl-v1` EventDriver 是直通的。

本 ADR 冻结这四件事的口径，后续 #20~#23 只允许复用，不再各自实现。

## 决策

### 1. 结构化 v4 命名空间边界（`src/driver/jsapi-v4/internal.ts`）

- 驱动层只认识**结构化**的命名空间：`Map` / `Point` / `Pixel` / `Size` / `Bounds` 必须是
  构造器（`typeof === "function"`），成员存在但为 `null` / 非函数一律视为缺失。
- `assertJsapiV4Namespace` 失败抛 `BMAP_SDK_CALL_FAILED`（**不可重试**），错误信息点名缺失
  成员；与 Loader 侧 `requireJsapiV4Global` 的 `BMAP_SDK_LOAD_FAILED`（**可重试**）分工明确：
  前者是「加载成功但 SDK 边界不可用」，后者是「加载本身失败，值得重试」。
- 本文件**不引用官方类型包**：`BMap.*` 类型与 `typeof BMap` 都不出现在实现里，因此也不会
  进入公共声明产物。唯一的 `typeof BMap` 出现在文件末尾的**类型层断言**上：
  `typeof BMap extends JsapiV4Namespace` 必须成立，上游类型包移除 / 改名 `Map` / `Point` /
  `Pixel` / `Size` / `Bounds` 时 `pnpm typecheck:v3`（`skipLibCheck: false`）直接失败，而不是
  等运行时才发现「`BMap.Size is not available`」。断言不产生运行时代码，且本文件不进入发布
  产物。
- 构造器获取与调用统一走 `namespaceCtor` / `sdkCall`，可选成员走 `callOptional`。

### 2. 每个 Client 一份的 Handle Registry（`src/driver/jsapi-v4/registry.ts`）

- **双向映射**：`adopt(kind, raw)` 建立 raw → Handle（`WeakMap`，随 raw 一起回收）；
  `lookup(raw)` 反查；`resolve(handle)` 走 Handle → raw。
- **稳定 identity**：同一个 registry 上同一 raw 每次 `adopt` 返回**同一个** Handle 实例。
- **kind 不变**：同一 raw 被登记成第二种 type 属于内部不变式破坏，抛
  `BMAP_INVALID_ARGUMENT`（`Handle` 类型不允许随调用点漂移）。
- **非对象 raw 拒绝**：`WeakMap` 无法以原始值作键，直接抛 `BMAP_INVALID_ARGUMENT`。
- **所有权不写入公共形状**：`SdkHandle` 仍是 `{ [HANDLE_BRAND], raw }`，所有权令牌只存在
  registry 内部的 `WeakMap<handle, symbol>` 中，公共类型零改动。
- **跨 Client 混用必须失败**：句柄不属于本 registry 时抛新增错误码
  `BMAP_HANDLE_FOREIGN`（不可重试）。两个 Client 各自登记同一 raw 时互不可见——把 A 地图的
  Marker 句柄交给 B 地图的 Driver 会操作到另一张地图的资源，属于必须在此刻拦下的错误。
- 映射**每个 registry 一份**（不是模块级共享），这是上面这条约束成立的前提。

### 3. 几何口径（`src/driver/jsapi-v4/geometry.ts`）

- **不做范围校验**：官方构造器只做类型归一，不检查 `lng ∈ ±180` / `lat ∈ ±90`；驱动也不
  额外加码——`0/0`、`±180/±90` 都是合法坐标，经纬度写反属于业务判断。
- **只拒绝真正的非法值**：非有限数、缺分量、非对象 → `BMAP_INVALID_POINT`（Point）或
  `BMAP_INVALID_ARGUMENT`（Pixel / Size / Bounds）。理由见背景：`NaN` 会被 SDK 静默接受，
  失败会推迟到「覆盖物不可见」这种难以定位的现象上。
- **复合入口先校验容器、再读属性**：`toRawPoints` / `fromRawPoints` 必须先确认入参是数组，
  `toRawBounds` 必须先确认容器是对象。否则 `null` / `undefined` 会在进入既有校验之前抛原生
  `TypeError`（`Cannot read properties of null (reading 'map')`），调用方无法按 `BMapError.code`
  分类处理（PR #59 评审 P2-2）。空数组 `[]` 与 `0/0` 坐标仍然合法。
- **不做墨卡托逆投影**：`webgl-v1` 需要把 WebGL 渲染路径下的 BD09MC 米制事件点位换算成度，
  4.0 的事件 `point` / `latLng` 本身就是经纬度（墨卡托坐标走独立的 `pointMC` 字段），
  因此这里不引入猜测式换算。
- 空 `Bounds`（无参构造 / 未 `extend`）在运行时 `getSouthWest()` 返回 `null`，按
  `BMAP_INVALID_ARGUMENT` 上报，不把 `null` 当作 `0/0`。

### 4. EventDriver：可释放、不重绑、带所有权校验（`src/driver/jsapi-v4/events.ts`）

- 同一个 `target + type` 只向 SDK 注册**一个**稳定的 raw 包装函数：handler 更新/追加只改
  订阅集合，**不重新绑定**；最后一个订阅释放时才 `removeEventListener`，监听器计数归零。
- **每次 `on()` 都是一份独立订阅**，disposer 与它一一对应：同一函数订阅两次就是两份，
  各自释放一份、计数归零才解绑。分组内用「函数 → 份数」计数而不是 `Set`——`Set` 无法表达
  两份订阅，且会让先释放的那份连带摘掉更晚建立的订阅（PR #59 评审 P2-1）。
- 派发时同一个函数每轮只调用一次，与「一个 target+type 只有一个 raw 绑定」保持一致。
- disposer 幂等：重复调用只执行一次释放逻辑。
- **摘除分组必须校验分组身份**：只有仍是当前分组的那个才允许解绑。这是防御性约束（当前公共
  API 下不可达：计数归零意味着该分组必然已是当前分组），用于保护后续重构。
- 订阅集合为空时立刻删除 registry 内的 target/type 分组，驱动不会因为「曾经订阅过某张地图」
  而长期持有已销毁的 raw 对象。
- `on()` 入口先做所有权校验，跨 Client 句柄在此失败（`BMAP_HANDLE_FOREIGN`）。
- 目标缺少 `addEventListener` / `removeEventListener` 时 `logger.warn` 并返回 **no-op
  disposer**（保持「所有订阅都返回可调用 disposer」这一契约，同时让异常可观测）。

### 5. 事件归一化与 raw 逃生口

- `normalizeDriverEvent(type, raw, geometry)` 产出 `DriverEvent`：`type` / `point` / `pixel` /
  `size` / `zoom` / `targetZoom` / `domEvent` + `raw` 逃生口；`MapMouseEvent` 是它在指针事件上
  的特化（`point` 必有），由 `normalizeMapMouseEvent` 继续提供，历史行为保持不变。
- `point` 优先取 `point`，其次 `latLng`（4.0 图形覆盖物事件两者都带，取值口径一致）。
- **归一化异常不外溢**：事件派发由 SDK 驱动，抛回 dispatch 会中断同一次事件里的其它监听器。
  实现上不用 try/catch 兜底，而是以 `isPairLike`（有限数形状检查）作为唯一前置闸门：只有形状
  合法的 raw 值才交给 `GeometryDriver`，而驱动只拒绝非有限数 / 缺分量，因此调用点按构造不会
  抛错——既不依赖异常控制流，也不吞掉真正的实现缺陷。形状不对时字段缺失（`point: undefined`），
  需要原始数据时用 `raw`。
- `EventDriver.on` 的默认泛型保持 `unknown`：迁移期 `webgl-v1` 仍直通 raw event，不能对外
  承诺引擎无关的 payload 形状；v4 调用方按需写成 `events.on<DriverEvent>(...)`。

### 6. `createJsapiV4Driver` 继续明确失败

本 Issue 只交付底座：Map / Overlay / Control / Layer / Service / Panorama Facet 属于
#20~#23。因此 `createJsapiV4Driver` **保持抛出** `BMAP_CAPABILITY_UNSUPPORTED`，不提供
「看似可用」的 driver（与 ADR 2026-09-11-loaded-sdk-client-boundary 的立场一致）。

同理，四个基础模块**不新增任何公共导出**：`internal` / `registry` / `geometry` / `events`
只被彼此与测试引用，既不在 `driver/index.ts`、也不在 `./advanced` 出现；`DriverEvent` 与
`normalizeDriverEvent` 同样只留在 `driver/normalize`、`driver/types` 内部，等 #20 真正接线
出可用的 v4 驱动后再决定是否提升为公开 API（避免「公共 API 先于可用能力落地」）。

`driver/jsapi-v4/` 在 `vite.config.build.ts` 与 `check-public-dts.mts` 中仍被整体视作类型边界
目录；#20 接线时需要一并决定该目录的声明边界处理（本 ADR 不改变既有边界规则）。

### 7. Fake v4 边界

`packages/test-utils/fake-bmap-v4/**` 提供结构化 v4 替身：几何构造器、Map / 核心覆盖物、
统一的 `listenCalls` / `liveListeners` 统计。它与 `fake-bmapgl` 并列存在，因为后者是迁移期
v1 边界并将在 `#26` 删除；两者不共享实现，避免 v4 测试依赖待删除代码。

## 后果

- 正面：v4 Facet 有一致底座（命名空间校验、句柄所有权、几何口径、事件释放语义）；跨地图句柄
  误用从「难以定位的运行时异常」变为可在边界断言的稳定错误码；公共 `SdkHandle` 与几何类型
  形状不变，公共声明不泄漏 `BMap.*`。
- 负面 / 成本：新增错误码 `BMAP_HANDLE_FOREIGN`（`BMapErrorCode` 是公开类型，属于新增而
  非破坏性变更）；`driver/jsapi-v4/internal.ts` 与 `driver/webgl-v1/internal.ts` 存在少量
  形状相似的 ctor/call 助手——重复会在 `#26` 删除 `webgl-v1` 时自然消失，本 Issue 不做跨引擎
  抽取以免让待删除代码阻塞 v4 底座。
- 回滚：撤销本 Issue 的文件即可——未挂进发布入口图，因此回滚不影响默认 Client / Provider /
  组件路径。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `MapMouseEvent` 改为 `DriverEvent` 的特化 | 仅新增可选字段（`type` / `size` / `zoom` / `targetZoom`），`point` 仍必有 | 现有调用点无需改动 |
| `GeometryDriver` 新增 `fromRawPoints` | 公共接口新增成员：外部自定义实现需要补齐（beta 内允许直接变更，见 ADR 2026-09-11-loaded-sdk-client-boundary） | 需要反向批量转换时直接调用 |
| 新增错误码 `BMAP_HANDLE_FOREIGN` | `BMapErrorCode` 联合类型新增成员 | 已有 `switch` 若穷举需要补分支 |
| `createJsapiV4Driver` 行为不变 | 仍抛 `BMAP_CAPABILITY_UNSUPPORTED`（消息含 `#19~#23`） | 无需改动，`#20` 起逐步接线 |
| 四个基础模块与 `DriverEvent` / `normalizeDriverEvent` 均未公开导出 | 消费者看不到任何新 API | 无需改动；#20 接线后再评估公开 |

## 非目标

- 不实现 Map / Overlay / Control / Layer / Service / Panorama Facet（#20~#23）。
- 不向公共事件暴露官方 `BMap.*` 事件类型；不做 per-event-name 的类型化事件表（属 #28）。
- 不在组件或 composable 中直接使用 Handle Registry。
- 不改变 `driver/jsapi-v4/**` 的声明边界规则（#15 的既有规则保持）。

## 已知限制（显式接受）

- **底座模块在 `#20` 接线前不进入构建入口图**：因此 `pnpm build:v3` 产物不含它们，消费者
  也看不到任何新导出；接线时需要一并处理该目录的声明边界。
- **`lookup` 只认已 `adopt` 的 raw**：未登记对象返回 `undefined`，调用方需要的话应先 `adopt`。
- **同一函数每轮事件只调用一次**：即便它被订阅了两份（两份都要各自 dispose 才解绑）。这是为了
  与「一个 target+type 只有一个 raw 绑定」保持一致；需要每份订阅各回调一次的场景请传入不同的
  函数对象。
- **事件路径的非法坐标退化为字段缺失**：`normalizeDriverEvent` 只在 raw 值通过有限数形状
  检查时才调用 `GeometryDriver`，因此事件里的残缺坐标不会成为结构化错误（`point` 为
  `undefined`，原始值走 `raw`）。理由是事件派发链路由 SDK 驱动，抛回 dispatch 会中断同一
  次事件里的其它监听器。驱动 API 路径（`toRawPoint` 等）仍然一律抛结构化错误。

## 参考

- issue #19 `[M3A.2] 实现 v4 Namespace/Handle Registry、GeometryDriver 与 EventDriver`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- 官方 Skill `bmap-jsapi-v4`：`references/coordinates-and-geometry.md`、`references/events-and-lifecycle.md`
- `packages/baidu-map-gl-vue/src/driver/jsapi-v4/{internal,registry,geometry,events}.ts`
- `packages/baidu-map-gl-vue/src/driver/normalize/events.ts`
- `packages/test-utils/fake-bmap-v4/**`
