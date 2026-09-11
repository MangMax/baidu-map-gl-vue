# ADR 2026-09-11：v4 Map Facet（构造选项映射 / 初次视野 / 交互开关 / 释放语义）

- 状态：已接受（Accepted）
- 日期：2026-09-11
- 计划键：`M3A2-MAP`（issue #20，追踪 #12）
- 取代：无
- 相关：[`2026-09-11-jsapi-v4-driver-foundation`](./2026-09-11-jsapi-v4-driver-foundation.md)、[`2026-09-11-loaded-sdk-client-boundary`](./2026-09-11-loaded-sdk-client-boundary.md)、[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)

## 背景

#19 交付了 v4 Driver 的底座（namespace 校验 / Handle Registry / Geometry / Event），
`createJsapiV4Driver` 仍是「明确失败」的空壳。第一个业务 Facet 是 Map：`BMap.vue` 的
初始化、视野、交互开关、底图类型、样式、投影与销毁全部经 `MapDriver`。

在写实现之前必须冻结四件容易写歪的事：

1. 项目 `InitialMapOptions`（含 `backgroundColor` / `restrictCenter` 这类 v1 时代键）怎么
   映射成 v4 `MapOptions`；
2. 「初次视野」与「后续受控更新」的差异（v4 没有 `setView`）；
3. 交互开关用哪条路径（官方文档提到 `map.setOptions`，但 4.0 API 参考与类型包都没有它）；
4. `destroy` 要释放什么、`destroy` 之后怎么处理后续命令。

## 决策

### 1. 交付 Facet，不提前装配

- Map Facet 落在 `src/driver/jsapi-v4/map.ts`，导出 `createJsapiV4MapDriver(input)`
  （input：`rawSdk` / `geometry` / `capabilities` / `registry` / `events`）。
- **`createJsapiV4Driver` 继续抛 `BMAP_CAPABILITY_UNSUPPORTED`**：装配需要 Overlay /
  Control / Layer / Service / Panorama 五个 Facet（#21~#23），默认 cutover 是 M3A.3（#25）。
  这与 #18 / #19 的立场一致，也保证 `createBMapClient.test.ts` 里「默认路径只接受
  jsapi-v4、且在 M3A.2 完成前明确失败」的断言仍然成立。
- 行为验证因此分两层：`src/driver/jsapi-v4/map.test.ts`（单元）与
  `tests/behavior/v3-jsapi-v4-map.test.ts`（契约 + 生命周期），后者手工组合 Map Facet，
  不经过默认 Client 路径。

### 2. 项目 MapOptions → v4 构造 options 用显式映射表

| 项目键 | 处置 | 依据 |
| --- | --- | --- |
| `minZoom` / `maxZoom` / `displayOptions` | 与 v4 `MapOptions` **同名直通** | `core/MapOptions.d.ts` |
| `backgroundColor` | **丢弃 + warn（每个 Driver 一次）** | v4 `MapOptions` 无该项；背景由容器样式 / `DisplayOptions` 表达 |
| `restrictCenter` | **丢弃 + warn（每个 Driver 一次）** | v4 没有布尔项，范围限制是 `restrictBounds(bounds)` |
| 其余索引签名键 | 原样透传 | `InitialMapOptions` 的索引签名是「v4 自身构造选项」的显式逃生口 |

丢弃而不是透传的理由：v4 会静默忽略不认识的键，整体透传等于「依赖 SDK 隐式默认」——
同一个 `restrictCenter: true` 在 webgl-v1 生效、在 v4 无声失效，是最难排查的一类迁移问题。
丢弃 + 一次性 warn 让迁移影响在日志里可见（迁移处置见下表）。

**库固定默认显式写进构造 options**（`LIBRARY_MAP_DEFAULTS`）：`enableDragging: true`、
`enableWheelZoom: false`。只固定「库已声明默认值且与 v4 隐式默认不同」的键——v4 的
`enableWheelZoom` 隐式默认是 `true`，而组件 `<BMap>` 的默认是 `enableScrollWheelZoom: false`；
不显式固定就会「同一个组件换引擎后滚轮缩放行为反转」。其余交互项库没有声明默认值，沿用 v4
默认，迁移期不引入第二套默认。

### 3. 初次视野用 `centerAndZoom`，后续用 `setCenter` / `setZoom`

- v4 **没有** `setView`（webgl-v1 有）；一次设定中心与级别的入口是 `centerAndZoom(center, zoom, options)`，
  且支持城市名重载（`centerAndZoom(city, zoom?)`）。
- `initializeView` 固定 `{ noAnimation: true }`：v4 文档里 `centerAndZoom` 的 `noAnimation`
  默认就是 `true`，显式写出是为了「不依赖隐式默认」，同时避免 `resetView()` 产生一次视野跳变。
- 后续受控更新走两个独立调用（`setCenter` / `setZoom`），与组件「center、zoom 分别 watch」
  的语义一致：更新一个轴不影响另一个轴。`initializeView` 与这两者的差异在契约里被断言
  （见 `runMapFacetContract`）。

### 4. 交互开关用官方成对 `enable*` / `disable*` 方法，**不用** `setOptions`

- 官方 4.0 API 参考的 `BMap.Map` 方法表与 `@baidumap/jsapi-v4-types@4.0.4` 都**没有** `Map#setOptions`
  （`setOptions` 只出现在 Panorama / Marker / Control 上）；仓库内的官方参考（Skill
  `map-core.md`）虽然提到「运行期间统一用 `setOptions()` 修改」，但它是文档描述，不是可核对的声明。
- augmentation 治理规则只允许补「有运行时依据」的缺口（`@runtimeBasis` 必须可核对），因此**不新增**
  `Map#setOptions` 声明；改用官方参考与类型包**都**公开列出的成对方法。
- 这条判断是刻意的「不做某个转换」：如果真实 runtime 确认存在 `Map#setOptions`，应作为**新的上游缺口
  或新 ADR** 处理（连同 4.0 参考未列出的原因），而不是在这里就地补一条无法验证的声明。
- **例外只有一个：`tilt-gestures` 在 v4 没有运行时成对方法。** `enableTiltGestures` / `disableTiltGestures`
  在官方 4.0 `BMap.Map` 方法表与 `@baidumap/jsapi-v4-types@4.0.4` 的 `core/Map.d.ts` 中都不存在
  （只有构造选项 `MapOptions.enableTiltGestures`；对比 `enableRotateGestures()` 是存在的）。
  因此该开关**告警一次 + 不生效**，而不是让 `callOptional` 把它变成静默 no-op；需要关闭手势倾斜时
  只能在构造 options 里显式传 `enableTiltGestures: false`。
  其余 11 个语义项与官方方法一一对应（`rotate-gestures` 有 `enableRotateGestures`/`disableRotateGestures`）。

### 5. 能力守卫：只守卫「引擎/渲染能力相关」的成员

- 走 `capabilities.require(...)` 的：`map.heading`、`map.tilt`、`map.animate`、`map.style`、
  `map.viewport`、`map.pixel-conversion`。
- 不加守卫的：`getCenter` / `setCenter` / `getZoom` / `setZoom` / `getBounds` / `getSize` /
  `checkResize` / `panTo` / `panBy` / `destroy`——这些是所有引擎都有的核心视野能力，加守卫只会
  增加噪音。
- 读取类调用的失败语义：`callRequired`（成员缺失 → `BMAP_SDK_CALL_FAILED`），避免把「SDK 缺成员」
  伪装成「读到了空值」；`capabilities.require` 先按 `unsupported` 策略给出可解释的
  `BMAP_CAPABILITY_UNSUPPORTED`/warn。

### 6. 投影转换进公共 `MapDriver`

- 新增 `pointToPixel(map, point): Pixel` / `pixelToPoint(map, pixel): Point`，对应 catalog 的
  `map.pixel-conversion`；`webgl-v1` 同步实现（BMapGL 参考里同名同形），共享契约因此在两个引擎上
  跑同一套断言。
- **catalog 的 `map.pixel-conversion.engines` 从 `V4_ONLY` 放宽为 `WEBGL_V4`** 并重新生成能力矩阵：
  该成员被提升为公共 `MapDriver` 成员后 webgl-v1 也必须实现，而 BMapGL 本就提供它，
  继续标 `V4_ONLY` 会让「能力清单的单一事实源」与实际支持漂移（AGENTS.md 的 catalog 约束）。
- 不加 `lnglatToMercator` / `mercatorToLnglat` / `getDistance` 等：属「把官方 Map 方法一比一公开」
  的非目标，等业务出现真实需求再按 Facet 补。
- v4 特有映射：`panBy(pixel)` → `panBy(x, y)`（v4 收两个数字，不是 `Pixel`）；`fitBounds(bounds)`
  → `setViewport([southwest, northeast])`（v4 没有 `fitBounds`，用两点取景保证包含该范围）。

### 7. 释放语义：destroy 幂等 + 先停业务资源 + 之后拒绝命令

```
destroy(map):
  1. registry.resolve(map)     // 所有权校验（跨 Client 抛 BMAP_HANDLE_FOREIGN）
  2. 已销毁 → return           // 幂等
  3. disposed.add(raw)         // 先登记：destroy 过程中由事件触发的重入命令也会被拒绝
  4. events.release(map)       // 摘掉 Driver 在该 target 上的订阅分组（解绑 raw listener）
  5. animations.delete(raw)    // 丢掉最近一次启动的视角动画引用
  6. raw.destroy()             // 最后才销毁 SDK 对象
```

- `disposed` 是每个 Driver 一份的 `WeakSet`（键为 raw map），`WeakMap` 存「最近一次 `startViewAnimation`
  的实例」——v4 的取消入口 `cancelViewAnimation(animation)` 必须传同一个实例，而 `MapDriver.stopViewAnimation`
  没有入参。
- **`EventDriver.release(target)` 是本次新增的内部能力**（`JsapiV4EventDriver`，不进公共
  `EventDriver` 类型）：`groups` 是强引用 `Map`，不摘分组的话 Driver 会长期持有已销毁的 raw map。
  它逐条走既有的 `removeGroup`，因此分组身份校验与「集合空则删 target 条目」的收尾逻辑都被复用，
  晚到的 disposer 不会二次解绑。
- destroy 之后的命令抛 `BMAP_RESOURCE_DISPOSED`（不可重试，`retryable === false`）。
- **配套的 runtime 加固**：`MapRuntime` 在 `initializeView` 抛错时销毁那个「已创建但还没写进
  `this.map.value`」的 Map。原先只有 `this.map.value` 有值的路径会被清理，而 `initializeView`
  永远发生在赋值之前——本 Facet 的能力守卫在 `unsupported: 'throw'` 下正好会走到这里，
  不修就会稳定泄漏一个 WebGL Map。这属于 issue 要求的「destroy 释放地图资源」同一类问题，
  因此一并修掉而不是只记欠账。

### 8. 路况：显式告警，不静默降级

v4 把路况收敛成 `TrafficLayer`（`map.addLayer`），`Map` 自身没有开关。`setTraffic` 在 v4 facet 里
**warn 一次 + no-op**，并点名由 Layer Facet（#22 / M3A2-CONTROLS-LAYERS）承接；不假装生效，
也不因为「组件传了 `enableTraffic`」就抛错打断整张地图的初始化。

### 9. 地图类型常量从命名空间读取

`BMap.MapTypeId.BMAP_*_MAP`（官方类型包已声明为静态成员）→ 语义 `MapType`。不读全局
`BMAP_*_MAP`：Driver 边界只认 `rawSdk` 传入的命名空间，避免访问未经 Provider 校验的全局值。
常量缺失时报 `BMAP_SDK_CALL_FAILED`，不猜测常量值。

### 10. 契约拆成两层

- `runMapFacetContract`（新）：只需要 `map` / `geometry` / `events` / `capabilities`，
  所以 v4（其余 Facet 未实现）与 webgl-v1 都能跑，覆盖创建/销毁、视野 round-trip、
  bounds/size、投影 round-trip、全部交互项、零尺寸容器。
- `runMapDriverContract`：webgl-v1 时代的全量契约（覆盖物 / 能力策略），内部复用上面那层。
  这样 #21~#23 扩展 Facet 契约时不必复制 Map 部分。

## 后果

- 正面：Map Facet 有可直接组装、行为可断言的实现；构造选项、初次视野、交互、释放四条口径被冻结；
  v4 与 webgl-v1 跑同一套 Map 契约，迁移期差异有据可查；Fake v4 的 Map 从「占位」变成
  「可观测的 v4 替身」（选项、交互状态、投影、动画、尺寸都可断言）。
- 负面 / 成本：公共 `MapDriver` 新增两个成员（外部自定义实现需要补齐，beta 内允许直接变更）；
  `driver/jsapi-v4/{internal,events}.ts` 各新增一个小能力（`callRequired` / `release`），
  属底座文件的增量而非改写；catalog 一行（`map.pixel-conversion.engines`）与生成的能力矩阵随之更新；
  `MapRuntime` 增加「initializeView 失败即销毁部分创建的地图」两行加固；
  `fake-bmapgl` 为跑通共享契约新增两个投影方法 + 四对交互方法（随 #26 一起删除）。
- 回滚：删除 `map.ts` / `FakeMap.ts` 与两处公共成员即可——Facet 未挂进 `createJsapiV4Driver`，
  回滚不影响默认 Client / 组件 / 发布产物（`dist` 不含 `driver/jsapi-v4/**`，由 `check:public-dts` 断言）。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `MapDriver` 新增 `pointToPixel` / `pixelToPoint` | 公共接口新增成员，自定义实现需补齐 | 直接实现；两个内置引擎已实现 |
| `restrictCenter` 在 v4 无效果 | `<BMap restrict-center>` 在 v4 下不生效（warn 一次） | 需要范围限制时改用 `restrictBounds`（后续 Facet 议题） |
| `backgroundColor` 在 v4 无效果 | 同上 | 用容器样式 / `DisplayOptions` 表达 |
| `enableTraffic` 在 v4 无效果 | 路况属 `TrafficLayer`（#22） | 等 Layer Facet 落地，facet 会承接该 prop |
| `destroy` 之后调用命令 | v4 抛 `BMAP_RESOURCE_DISPOSED`（webgl-v1 只保证幂等） | 组件/业务按既有 ResourceScope 顺序释放即可 |
| `getHeading()` 返回带符号角度 | v4 的 `setHeading(270)` → `getHeading()` 为 `-90` | 不要用 heading 做 round-trip 判断；类型化事件与状态属 #28 |
| `setInteraction(map, "tilt-gestures", …)` 在 v4 不生效 | v4 没有该成对方法（只有构造选项） | 告警一次；需要关闭手势倾斜时在构造 options 传 `enableTiltGestures: false` |
| `noAnimation` prop 未贯通到 `MapView` | 初次视野固定 `noAnimation: true`（既有行为在两个引擎上都是「不读该 prop」） | 属 Vue 层（组件 props → `MapView`）的后续议题，本 issue 不改组件契约 |
| `map.pixel-conversion` 能力在 webgl-v1 变为可用 | catalog `engines` 由 `V4_ONLY` 放宽为 `WEBGL_V4` | 能力矩阵已随之重生成（`generate:capability-matrix`） |

## 非目标

- 不装配 Driver、不改默认 Client / Provider / 组件默认路径（#23/#25）。
- 不实现 Overlay / Control / Layer / Service / Panorama Facet（#21~#23）。
- 不把官方 Map 方法一比一公开（截图、主题、`setTheme`、`getDistance`、墨卡托换算、控件与覆盖物
  增删等留给各自 Facet 或按需补）。
- 不新增 augmentation；不改 `driver/jsapi-v4/**` 的声明边界规则（仍整体不进发布产物）。

## 已知限制（显式接受）

- **未做真实 AK smoke**：`MapTypeId` 静态常量的真实取值、`setHeading` 的 360 归一化、
  真实投影精度都只在官方文档/类型层面核对过；真实浏览器验证属 M3A.3（#25）。
- **Fake 不负责任值归一化**：`fake-bmap-v4` 记录「传进去什么」，不复刻 SDK 的 heading 归一与
  tilt 截断，因此共享契约只断言不依赖归一化的取值。
- **webgl-v1 不追平新策略**：它是 #26 待删除实现，只补齐公共接口新增的成员（投影转换），
  不补「destroy 后拒绝命令」与「未知交互项报错」。契约断言按引擎分层（见 `driver-contract.ts` 头部）：
  共享部分只断言「不抛错」，交互映射是否真正落地由各引擎自己的测试用可观察状态断言
  （v4 看 `fake-bmap-v4` 的交互状态；webgl-v1 看 `fake-bmapgl` 的 `callLog`）。
- **`noAnimation` prop 仍然没有贯通**：`BMap.vue` 声明了 `noAnimation`（默认 `false`），但
  `MapRuntime`/`MapView` 都不携带它，两个引擎的 `initializeView` 都不读——这是既有缺口，
  本 Facet 只把「初次视野不做动画」显式固定下来（v4 文档默认值），没有顺手改组件契约。
- **`setInteraction` 未知项行为不统一**：v4 抛 `BMAP_INVALID_ARGUMENT`，webgl-v1 静默返回。
- **两个引擎交互表的重复是刻意保留的**：`jsapi-v4/map.ts` 与 `webgl-v1/map.ts` 各持一份
  `MapInteraction` → 官方方法名映射表；跨引擎抽取会让 #26 待删除的实现阻塞 v4 底座
  （同 ADR 2026-09-11-jsapi-v4-driver-foundation 的「负面 / 成本」）。
- **`restrictCenter` / `backgroundColor` / `enableTraffic` 的迁移处置是占位**：分别需要
  `restrictBounds`、容器样式/`DisplayOptions`、`TrafficLayer` 的真实承接，当前只做到「可见 + 不误导」。

## 参考

- issue #20 `[M3A.2] 实现 JSAPI 4.0 MapDriver`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- 官方 4.0 API 参考：`BMap.Map` 方法表、`BMap.MapOptions`、`BMap.ViewportOptions`
- 官方类型包 `@baidumap/jsapi-v4-types@4.0.4`：`core/Map.d.ts`、`core/MapOptions.d.ts`、`map-type/MapTypeId.d.ts`
- 官方 Skill `bmap-jsapi-v4`：`references/map-core.md`、`references/view-animation.md`
- 代码：`src/driver/jsapi-v4/map.ts`、`src/driver/jsapi-v4/{internal,events}.ts`、
  `src/driver/types/map.ts`、`src/driver/webgl-v1/map.ts`
- Fake 与契约：`packages/test-utils/fake-bmap-v4/FakeMap.ts`、`packages/test-utils/driver-contract.ts`
