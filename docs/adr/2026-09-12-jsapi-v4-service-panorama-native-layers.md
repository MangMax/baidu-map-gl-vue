# ADR 2026-09-12：v4 Service / Panorama / Native Layer Facet（归一化服务调用 / 运行时注入探测 / 装配收口）

- 状态：已接受（Accepted）
- 日期：2026-09-12
- 计划键：`M3A2-SERVICES-NATIVE`（issue #23，追踪 #12）
- 取代：无
- 相关：[`2026-09-11-jsapi-v4-driver-foundation`](./2026-09-11-jsapi-v4-driver-foundation.md)、[`2026-09-11-jsapi-v4-map-facet`](./2026-09-11-jsapi-v4-map-facet.md)、[`2026-09-11-jsapi-v4-overlay-facet`](./2026-09-11-jsapi-v4-overlay-facet.md)、[`2026-09-11-jsapi-v4-control-layer-facets`](./2026-09-11-jsapi-v4-control-layer-facets.md)、[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)

## 背景

`#19`~`#22` 交付了 v4 Driver 底座与 Map / Overlay / Control / Layer 四个 Facet，
`createJsapiV4Driver` 仍是「明确失败」的空壳（装配需要 Service / Panorama）。
最后一批缺口是**服务、全景与原生批量数据图层**，以及「Contract Harness 覆盖所有 Facet 与
unsupported policy」这件事。

动手前必须冻结八件容易写歪的事：

1. **服务是 callback 风格，且失败与「查无结果」不可区分**：`Geocoder#getPoint` /
   `Boundary#get` / `LocalCity#get` 失败时**只回 `null`**，服务端错误码（配额 302、
   Referer 限制）只出现在 JSONP 回调注册表 `_rd` 里；`Geolocation` 又是唯一自带
   `getStatus()`（`BMAP_STATUS_*`）的服务。业务不想要「每个调用各自写一遍超时 + 空判断」。
2. **`Autocomplete` 是事件式服务**：`search()` 只发起请求，结果经**构造选项**
   `onSearchComplete` 回来——没有「一次调用一次回调」的配对关系（用户在输入框里打字也会触发）。
3. **原生数据图层有八个 kind，但方法面并不一致**：官方专页的四类
   （`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）共享
   `setData` / `clearData` / 要素状态 / `setVisible` / `setOpacity` / `setZIndex` /
   `setStyleOptions` / `doOnceDraw`；而扩展 API 的四个
   （`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`）只公开各自那几个方法。
   把它们硬套成一套接口，必然产生「调了但没反应」。
4. **扩展 API 的实现是异步注入的**（官方明确），且 `@baidumap/jsapi-v4-types@4.0.4`
   **没有这四个类的类声明**：能力探测不能在 Driver 构造期冻结结论。
5. **样式不会自动重绘**：官方专页图层 `setStyleOptions()` 后需要显式 `doOnceDraw()`；
   层级方法还会访问「已关联的 Map」，因此顺序是 `create → add → setZIndex`。
6. **共享 `BMapDriver` 不能塞 v4 独有的面**：它要同时被 webgl-v1 满足，而 v1 既没有原生
   数据图层，也没有归一化服务调用面；但 `#22` 的结论又要求「组件不必访问 raw 服务/图层」。
7. **契约要在两个环境跑**：`driver-contract.ts` 顶部 import 了 vitest，浏览器里加载不了，
   而 issue 明确要求「同一 Contract Harness 可运行 Fake v4 和真实 smoke 子集」。
8. **迁移期行为要收口**：四个既有测试断言「v4 默认路径明确失败」（消息含 `M3A.2`），
   装配完成后它们必须转成正向断言，而不是被删掉。

## 决策

### 1. Service Facet 分两层，v4 独有面挂在 `JsapiV4Driver` 上

- **创建面** `ServiceDriver`（共享，两引擎都实现）：6 项基础服务 + `ViewAnimation` 的创建。
- **归一化调用面** `ServiceInvocationDriver`：`geocode` / `reverseGeocode` / `convert` /
  `queryBoundary` / `locate` / `locateCity` / `suggest`，每个返回 `ServiceCall<T>`。
- `JsapiV4ServiceDriver extends ServiceDriver, ServiceInvocationDriver`。
- 新增 `JsapiV4Driver extends BMapDriver`，把 v4 独有的三个面收进去：
  `services`（收窄为 `JsapiV4ServiceDriver`）、`panorama`（收窄为 `PanoramaViewerDriver`）、
  `nativeLayers`（新 facet）。

理由：共享契约保持「webgl-v1 也能满足」的形状（v1 随 `#26` 删除，不为此写第二套实现），
同时 `#25` 完成默认 cutover 后，组件拿到 v4 Client 的类型就能用到全部能力。三个收窄成员都是
`BMapDriver` 对应成员的**子类型**，因此 `JsapiV4Driver` 可以原样传给任何期望 `BMapDriver` 的位置
（`createBMapClient` 的注入点、`createDriver` 的分派）。

### 2. 服务调用适配器：恒 resolve、先到者胜、空/失败分离、超时、取消

`src/driver/normalize/serviceCall.ts` 的 `createServiceCall`（engine 无关）：

| 语义 | 做法 | 为什么 |
| --- | --- | --- |
| 不 reject | 失败/超时/取消都表达成 `ServiceResult.status` | 业务不必为「服务失败」再写一层 try/catch；`start` 同步抛错也走结果通道 |
| 空结果 ≠ 失败 | `settle.empty()` / `settle.failed({code,message})` 两个入口 | 真实失败只回 `null`，混为一谈会让业务分不清「没有」与「出错」 |
| 先到者胜 | 首次结算后 `pending = false`，后续结算一律忽略 | 真实服务**在超时之后仍会回包**；不设这道门就会把过期结果写回去（迟到回调） |
| 超时 | 默认 `SERVICE_CALL_TIMEOUT_MS = 15000`（与 composable 层同值），`status: "timeout"` | SDK 失败时可能永不回调，否则 Promise 永久挂起 |
| 取消 | `cancel()` 立刻以 `canceled` 结算并执行 `onCancel` | JSONP 发出去收不回，只承诺「放弃结果 + 解绑」，不假装能中止请求 |

`ServiceResult` 的形状不变式（`status` 与 `data` / `error` 的对应关系）由共享契约的
`assertServiceResultShape` 固定，Fake 与真实环境都跑。

### 3. 「空结果 vs 失败」靠 JSONP 嗅探，抽到 `normalize/jsonpProbe.ts` 两引擎共用

`webgl-v1/services.ts` 里原有的 `captureJsonpServiceError` 直接**上移到**
`normalize/jsonpProbe.ts`，v1 保留同名再导出（import 路径与测试不变）。嗅探逻辑只依赖
`rawSdk._rd` 的形状、与 engine 无关，v4 Service Facet 因此不需要第二份实现。

调用顺序是硬约束（v1 composable 的注释已经写过，这次落进 Facet）：**先调 SDK（它同步注册
`_rd` 回调）→ 再 `probe.rescan()` 包装**。JSONP 回包恒为异步，所以 rescan 必定先于回包执行。
Fake 也把这条时序建模出来（回包走微任务），否则「嗅探没用」会成为一个假的测试结论。

### 4. `Geolocation` 的状态码表：数值字面量 + 类型层钉在官方声明上

`Geolocation#getStatus()` 是唯一自带状态的服务。失败状态码 → 可读原因的映射写在 Driver 内部
（**不读全局 `BMAP_STATUS_*`**：Driver 只认 `rawSdk` 传入的命名空间），与官方
`const/StatusCodes.d.ts` 的一致性由文件末尾的类型断言钉死（同 `#22` 的锚点常量表口径）。
`getStatus` 成员缺失或调用失败时返回 `null`，**不把缺成员伪装成状态 0**。

### 5. `Autocomplete`：Driver 挂内部分发器，而不是要求业务自己配对

`createAutocomplete` 在构造选项里装一个内部分发器：

```ts
onSearchComplete: (results) => {
  const settle = pendingSuggest.get(raw);      // suggest() 写入的 pending
  pendingSuggest.set(raw, null);
  settle?.success(readSuggestions(results)) / settle?.empty();
  options.onSearchComplete?.(results);         // 原样转发业务自己的监听
}
```

两个要点：**不吞掉业务监听**（`BAutoComplete.vue` 一直在用 `onSearchComplete`），以及
**取消只放弃 pending**——`suggest()` 的 `onCancel` 把 pending 置空，之后的回包仍然转给业务，
只是不复活本次调用。

### 6. `TrackAnimation` 显式失败，指向 `TrackLine`

Catalog 的 `service.track-animation` 是 `unsupported`（该插件属 `BMapGLLib`，迁移结论属 M8 #43）。
v4 的 `createTrackAnimation` 抛出带 `capability: "service.track-animation"` 的
`BMAP_CAPABILITY_UNSUPPORTED`，消息里直接给出 4.0 的替代入口
（`driver.nativeLayers.create("track-line")`）——**不静默给一个不能用的实例**。

### 7. 原生图层：八个 kind，操作面按 kind 声明，不支持的操作显式失败

`NATIVE_LAYER_DESCRIPTORS`（`Record<NativeLayerKind, …>`，漏一个 kind 直接编译失败）里每个 kind
一条记录：`ctor` / `declared` / `operations`。`declared` 同时决定三件事（写在一起才不会漂移）：
能否用 `namespaceCtor`、能否用字段级 setter 族、缺成员时报哪个错误码。

| kind | ctor | declared | operations |
| --- | --- | --- | --- |
| `point-icon` / `point-shape` / `line` / `fill` | 同名类 | ✅ | setData, clearData, setStyle, setVisible, setOpacity, setZIndex, setZoomRange, updateState, removeState, clearState, setEnablePicked |
| `point` | `PointLayer` | ❌ | setData, clearData, setStyle, setEnablePicked, hitTest |
| `cluster` | `ClusterLayer` | ❌ | setData, clearData, setStyle |
| `heatmap` | `Heatmap` | ❌ | setData, clearData, setStyle |
| `track-line` | `TrackLine` | ❌ | setData |

- **不支持的操作抛 `BMAP_CAPABILITY_UNSUPPORTED`**（先 `warnOnce` 一条），不静默 no-op。
  「调了但什么都没发生」是数据图层最难排查的一类问题。
- `supports(kind, operation)` 是**调用前查一次**的唯一入口；它的答案与真实调用的一致性由共享
  契约（`runNativeLayerFacetContract`）与单测（8 kind × 12 操作）双向断言。
- `setStyle`：`declared` 的走 `setStyleOptions` **并显式 `doOnceDraw()`**（官方不自动重绘）；
  扩展 API 走整袋 `setOptions`（官方只给这一个入口）。
- `setZoomRange` 只改**给到的那一端**：补默认值会把调用方先前的设置悄悄改掉。
- `updateState(keys, state, append)` 的第三参数是官方的 `ifAppend`，落在领域签名上叫 `append`
  并默认 `false`（替换语义）。

### 8. runtime-only 图层按「加载后就绪」探测，能力守卫也在调用时刻求值

- 四个扩展 API 的构造器用 `requireRuntimeCtor` 结构探测，**在 `create()` 调用时刻判断**：
  注入前 `create` 失败（`BMAP_CAPABILITY_UNSUPPORTED`），注入后**同一个 Driver** 再 `create`
  就能成功。Driver 不在构造期冻结这个结论。
- 能力守卫 `capabilities.require(...)` 也放在 `create()` 里（`supports()` 每次重算
  `rawMembers`），因此「先建 Driver、后注入实现」这条正常顺序成立；`throw` 策略下失败发生在
  构造之前，不会留下孤儿实例。

### 9. `Panorama`：`supported` 是重新探测的 getter，`destroy` 幂等且**成功后记账**

- `supported` 实现成每次读取都重新探测 `namespace.Panorama` 的 getter（同 §8 的理由）。
- `create` / `createService` 走能力守卫 + `namespaceCtor`，实例经 `registry.adopt` 成句柄。
- `destroy()` 幂等：口径是 **claim → 调 SDK → 失败 `release`**（与 Control / Layer Facet 同源）。
  先 claim 挡重入（业务在 SDK 的销毁回调里再次 `destroy` 同一个实例）；失败时 release，
  保证「销毁失败」不会被记账伪装成「已销毁」——真实 4.0 在**未加载场景**的实例上
  `destroy()` 会抛 `TypeError`（见 smoke 记录），那时必须能重试。
- 检索归一化用 `retrieve()`：`getPanoramaById` / `getPanoramaByLocation` 都是
  「id/point + callback(`PanoramaData | null`)」，查不到是 `empty`（官方口径），不是 `failed`。
  按坐标检索**不给半径时省略该实参**（官方的两个重载不是「可选参数占位」）。

### 10. 装配：`createJsapiV4Driver` 真正装配，返回 `JsapiV4Driver`

- 装配点**只从 `driver/jsapi-v4/**` 取运行时实现**、返回类型全部来自 `driver/types/**`：
  前者是声明边界目录（`check:public-dts` 断言它不得进入发布产物），从它 import **类型**会让
  公共 `.d.ts` 指向未发布的文件。
- 命名空间形状在装配点先断言一次（`assertJsapiV4Namespace`），让「命名空间不可用」有唯一、
  清晰的失败点，而不是由「第一个碰巧需要 Map 的 Facet」决定报错信息。
- 依赖顺序写在一处：`geometry → events → map(需要 events) → overlays → controls → layers →
  services → panorama → nativeLayers`，每个 Client 一份独立 Handle Registry（跨 Client 混用抛
  `BMAP_HANDLE_FOREIGN`）。
- **迁移影响**：四个断言「v4 默认路径明确失败（消息含 `M3A.2`）」的测试改成**正向**断言
  （`createBMapClient` 默认路径装出可用 v4 Client），而不是删除；默认 Provider / Playground /
  Docs 的切换仍属 `#25`。

### 11. 契约拆两半：纯探针 + vitest 断言

- `packages/test-utils/facet-probes.ts`：`probeServiceFacet` / `probeNativeLayerFacet` /
  `probePanoramaFacet` / `callNativeLayerOperation`，**不 import vitest**，只做调用与结构化记录。
- `packages/test-utils/driver-contract.ts`：新增 `runServiceFacetContract` /
  `runNativeLayerFacetContract` / `runPanoramaFacetContract`，用 vitest 断言探针结果，并把探针
  再导出（调用方不必知道文件怎么切）。
- 契约带 `expectation: "fixture" | "live"` 两档：Fake 环境要求「命中 fixture」；真实环境只要求
  「结算且形状自洽」——配额、网络与 Referer 都不受本库控制，把「真实环境必须成功」写进契约
  只会得到一个不稳定的门禁。
- `callNativeLayerOperation` 是「怎么调」的单一实现，Fake 侧单测与真实 smoke 共用，避免
  「契约里测的那套调用」与「浏览器里跑的那套调用」各自漂移。

### 12. Capability Catalog 与运行时一致

- 新增三个 runtime-only 能力：`layer.point` / `layer.heatmap` / `layer.track-line`
  （`V4_ONLY`、`experimental`、`runtimeOnly: true`）。前两个是原生数据图层的缺口，
  `layer.track-line` 同时登记「播放控制与迁移结论属 M8 #43」。
- 已有的 `layer.cluster`（extended）/ `layer.point-icon` / `layer.point-shape` / `layer.line` /
  `layer.fill` 维持原状；能力矩阵由脚本重生成（64 条）。
- **控件不进 Catalog** 是 `#22` 冻结的 family 划分结果，本 issue 不改。

## 后果

- 正面：v4 有了完整可用的 Service / Panorama / Native Layer 三个面，且**装配完成**——
  用 v4 Provider 的组件路径从「明确失败」变成「可用」；服务调用不再需要业务自己写
  「超时 / 空结果 / 迟到回调」三件套；原生数据图层的「调了没反应」被显式失败取代；
  契约在两个环境（Fake 与真实 AK）跑同一份探针代码。
- 负面 / 成本：新增三个 v4 独有类型面（`JsapiV4Driver` / `NativeLayerDriver` /
  `ServiceInvocationDriver`）；`createJsapiV4Driver` 的返回类型从 `BMapDriver` 收窄为
  `JsapiV4Driver`（子类型，不破坏既有调用方）；`facet-probes.ts` 与
  `driver-contract.ts` 拆成两个文件；v1 的 `captureJsonpServiceError` 变成再导出；
  Catalog +3 条（能力矩阵与 docs JSON 随之更新）。
- 回滚：删除 `jsapi-v4/{services,panorama,native-layers}.ts`、`normalize/serviceCall.ts`、
  `types/native-layers.ts`、`facet-probes.ts`、Fake 增量与 Catalog 三条，并把
  `createJsapiV4Driver` 恢复为抛 `BMAP_CAPABILITY_UNSUPPORTED` 即可——`dist` 不含
  `driver/jsapi-v4/**`，回滚不影响发布产物；四个「默认路径」测试会立刻变红，提示恢复对应的
  断言。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `createJsapiV4Driver` 从「明确失败」变为「装配完成」 | 用 v4 Provider 的组件路径从失败变为可用；`createBMapClient` 默认路径同样 | 正向变化；默认 Provider / Playground / Docs 切换属 #25 |
| `createJsapiV4Driver` 返回类型 `BMapDriver` → `JsapiV4Driver` | 子类型，赋给 `BMapDriver` 的位置不受影响 | 需要 v4 独有面时按 `JsapiV4Driver` 使用 |
| 新增 `JsapiV4Driver` / `ServiceInvocationDriver` / `ServiceResult` / `ServiceCall` / `NativeLayerDriver` 等公共类型 | `src/index.ts` 与 `src/driver/index.ts` 增加类型导出 | 逐步可用；`BMapClient.driver` 的类型收窄属 #25 |
| `ServiceDriver` 不变（创建面） | 既有 7 个 composable 仍走 `create*` + `handle.raw` | 迁到归一化调用面属 M7 #38（ServiceSpec / AsyncTaskController 与之一并设计） |
| `captureJsonpServiceError` 的实现位置 | 从 `webgl-v1/services.ts` 上移到 `normalize/jsonpProbe.ts`，原路径保留再导出 | 无需改动调用方 |
| 原生图层 `supports()` 回答 `false` 的操作 | 调用抛 `BMAP_CAPABILITY_UNSUPPORTED`（原先不存在这个 Facet） | 用 `supports()` 先问，或按 ADR §7 的表 |
| `Heatmap` / `TrackLine` / `PointLayer` / `ClusterLayer` 的未声明继承成员（`setVisible` / `setOpacity` / `setZIndex`） | 真实 4.0 可调用，但本 Facet 按官方文档回答「不支持」 | 见「已知限制」；放开只需改 `operations` 一处 |
| Catalog 新增 `layer.point` / `layer.heatmap` / `layer.track-line` | `supports()` 在 v4 下由「无此能力」变为 true | 能力矩阵与 docs JSON 已重生成（64 条） |
| `service.track-animation` 在 v4 的失败码 | `BMAP_CAPABILITY_UNSUPPORTED`（消息指向 `TrackLine`） | 迁移到原生图层或等 M8 #43 |
| `Panorama#destroy()` 在未加载场景的实例上抛错 | 归一为 `BMAP_SDK_CALL_FAILED`；重复销毁会**真的重试** | 组件路径（M7 #41）先 `setId` / `setPosition` 再销毁 |
| `panorama.supported` | 从常量变为**每次读取重新探测**的 getter | 行为更正确；读取有极小开销 |

## 非目标

- 不提供完整 LocalSearch / Route 的 Vue Composable，也不把 7 个既有 service composable 迁到
  归一化调用面（`#38`）。
- 不实现 Native Layer / Panorama 的 Vue 业务组件（issue 明确列为非目标）。
- 不实现 TrackLine 的播放控制（`start/pause/resume/stop/setSpeed/setProcess`）与迁移结论
  （M8 #43）。
- 不做 `enableTraffic` 接线、不做 WMS / WMTS / MVT（`#22` 的欠账与本 issue 无关）。
- 不为扩展 API 的四个类写 augmentation：官方 4.0.4 没有类声明，本 issue 只按结构探测构造器，
  不臆造声明（同 `#22` 对 `PanoramaCoverageLayer` 的口径）。
- 不改 `BMapClient.driver` 的类型收窄与默认 Client / Provider / Playground / Docs 的切换（#25）。

## 真实 AK smoke 记录（2026-09-12）

用 docs 站点示例里的 AK（`docs/examples/layer/panoramaCoverage.vue`）在真实 JSAPI 4.0 上跑
**装配后的 `createJsapiV4Driver`**：headless Chromium（SwiftShader）+ 临时 Vite 页面直接
`import` Facet 源码与**共享探针** `facet-probes`（harness 未入库，跑完移出；AK 只经 URL
查询参数传入，不落盘）。25 项检查全部通过。

| 检查 | 结果 |
| --- | --- |
| 构造器存在性（原生图层 8 + 服务/全景 9） | **全部存在**（含类型包未声明的 `PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`） |
| 装配：九个 facet 就位 | geometry / events / map / overlays / controls / layers / services / panorama / nativeLayers |
| Capability Registry vs 真实命名空间 | 16 个能力为 true；`service.track-animation` 为 **false**（Catalog `unsupported`，与预期一致） |
| `panorama.supported` | true |
| `createTrackAnimation` | 抛 `BMAP_CAPABILITY_UNSUPPORTED`（消息指向 `TrackLine`） |
| Service facet：7 个归一化调用 + 取消 | `geocode` success、`reverseGeocode` success、`convert` success(0)、`boundary` success、`locate` **failed(6)**、`locateCity` success、`suggest` **failed**、`canceled` canceled |
| 原生图层逐 kind：探针（走 `supports()`） | 8 个 kind 全部结算；**不支持的操作 100% 显式失败**（`rejectedWhenUnsupported: true`） |
| 原生图层逐 kind：**直接调用 raw**（绕过 `supports()`） | `point-icon/shape/line/fill` 11 项全 ok、`hitTest` 缺成员；`point` 8 项 ok（`setEnablePicked`/`hitTest` ok，状态与 `setMinZoom` 缺成员）；`cluster`/`heatmap`/`track-line` 6 项 ok |
| `Panorama` viewer 生命周期 | `create` / `setPosition` / `setPov` / `setZoom` / `show` / `hide` 全部 ok；**`destroy` 抛 `TypeError: Cannot read properties of undefined (reading 'START')`**（未加载场景的实例） |
| `PanoramaService` 检索 | `getPanoramaById` / `getPanoramaByLocation` 都结算为 `empty`（不存在的 id / 50m 内无全景） |

smoke 顺带确认（并已回写进决策）的运行时事实：

- **扩展 API 的四个类从共享基类继承了 `setVisible` / `setOpacity` / `setZIndex`**（调用不抛错），
  而官方扩展 API 专页没有把它们列为这些类的方法面 → 本 Facet 按**声明的**面回答 `supports()`
  （保守），差异与实测证据登记在「已知限制」。
- `PointLayer#setMinZoom/setMaxZoom` 与 `Heatmap`/`ClusterLayer`/`TrackLine` 的
  `updateState/removeState/clearState` 在运行时**确实不存在** → `supports()` 的 `false` 与实测一致。
- `locate` 在 headless 下得到 `BMAP_STATUS_PERMISSION_DENIED`(6)，并且**归一化结果里
  `sdkStatus === 6`**（状态码确实来自 `getStatus()`，不是猜的）。
- `Panorama#destroy()` 的失败形态（读 `START` of undefined）只在**未加载场景**时出现；
  Driver 因此把记账放在成功之后，重复销毁会真的重试。

## 已知限制（显式接受）

- **`suggest` 在真实环境下返回 `failed`**：headless 页面里没有真实的输入框交互（`search()`
  发起的请求结果形态与用户输入路径不同）。契约的 live 档只要求「结算且形状自洽」，
  「输入提示端到端」留给 M7 #41 / M3A.3 #25。
- **`locate` 需要浏览器定位授权**：headless 下必然失败（`BMAP_STATUS_PERMISSION_DENIED`）。
  这里验证的是「状态码 → 归一化 `failed` + 可读原因」，不是「能拿到坐标」。
- **`Panorama` 的真实场景渲染未覆盖**：smoke 只做构造 / 视角 / 显隐 / 销毁 / 检索；真实全景图块
  加载与交互留给 M7 #41。**未加载场景时 `destroy()` 会抛错**（见上），组件路径必须先 `setId` /
  `setPosition`。
- **扩展 API 的继承成员保守回答**：`setVisible` / `setOpacity` / `setZIndex` 在真实运行时可用，
  但不在官方文档的方法面里，本 Facet 不认它们；放开只需把对应操作加进 `operations`（一处）。
- **TrackLine 只支持 `setData`**：播放控制（运行时确实存在：`start/pause/resume/stop/setSpeed/
  setProcess`）不在本 issue 的接口面内，属 M8 #43。
- **服务归一化面的消费者是契约与探针**：7 个既有 service composable 仍在用 `create*` +
  `handle.raw`（`#38` 一并迁移）；本 issue 只保证「seam 已就位」——
  `driver.services.geocode(...)` 这类调用不再需要 raw。
- **`setStyle` 的 `doOnceDraw()` 是显式补的**：官方专页图层不自动重绘，Driver 因此替调用方
  补这一次重绘；如果调用方自己也要 `doOnceDraw()`，多调一次是幂等的。
- **真实 smoke 未覆盖**：真实拖动/点击拾取交互、多分辨率/多浏览器、真实数据渲染结果、
  `PanoramaCoverageLayer` 与原生图层的叠加效果。
- **`layer.cluster` 的 capability 是 `extended`**：`#35`（M6）要做的 fallback 聚类仍待办；
  本 issue 只提供 SDK 原生入口。
- **`BMapClient.driver` 仍是 `BMapDriver`**：组件要直接用 `nativeLayers` / 归一化服务调用需要
  v4 的类型收窄，那是 `#25` 的默认切换的一部分（本 issue 不做，避免在迁移期改动公共客户端类型）。

## 提交前的双轴自审（Standards / Spec，各一个子代理）

**Standards 轴**（无硬违规；以下为发现项，全部已修）：

| 发现 | 处置 |
| --- | --- |
| `_AssertRuntimeCtorsUndeclared` 是**非分配式**断言：四个构造器名取联合后整体判断，上游只补齐其中 1~3 个声明时联合仍不整体可赋值 → 断言静默通过（门禁空转） | 改为**逐成员分配式**：先对单个 kind 求条件类型、再取联合，并要求结果是 `never`；`_AssertDeclaredCtors` 同步改成同一形状（`MissingDeclaredCtors extends never`） |
| `Panorama.destroy` 先调 SDK 再记账：可重试但丢了重入保护（与 `#22` 明确保留的「先记账挡重入」口径相反） | 改为 **claim → 调 SDK → 失败 `release`**：重入被挡、失败可重试；Fake 加 `onDestroy` 重入注入 + 一条重入单测 |
| `setStyle` 的 `doOnceDraw` 缺成员时**静默跳过**：样式已写入但画面不会变，调用方无任何提示 | 改为 `warnOnce` 明确告警「样式已更新但不会重绘」 |
| `NativeLayerPointTuple` / `toGeoJsonPosition` 零消费者，且把运行时函数放进 `types/` | 删除（M6 的数据适配层需要时再加） |
| 单测的 `KINDS` / `OPERATIONS` 与探针里的常量是同一事实的两份真相，且新增操作时契约会**静默漏测** | 单测改为 import 探针常量；探头两张表加 `as const satisfies` + 「必须覆盖全部 kind / 操作」的完备性断言（漏加即编译失败） |
| 同包内两个**同名不同形状**的 `ServiceErrorInfo`（`code` 是否可为 `null`） | JSONP 侧改名 `JsonpServiceErrorInfo`，并删掉 `webgl-v1/services.ts` 里已无消费方的再导出 |
| `ServiceInvocationDriver` 的文档说「不抛错」，但句柄所有权校验会同步抛 `BMAP_HANDLE_FOREIGN` | 修正文档：句柄所有权属**调用方错误**（同步抛，不伪装成「服务失败」）；参数非法则走结果通道 |
| Fake 里大量成员无任何消费方（getter 家族、`PointLayer` 的 `getItems`、`ClusterLayer` 的 getter、`Heatmap` 的 `setGradient/setRadius`、`TrackLine` 的播放控制、`Autocomplete` 的扩展面…），与自身注释「避免 Fake 先于实现膨胀」矛盾 | 全部删除，只留 Driver / 契约真正调用的成员（正是上一个 ADR 反对的形态） |
| `invoke` 的 `default` 分支不可达（保留它反而暗示「可能到达」） | 删掉，改为 switch 之后的 `operation satisfies never`——保留完备性保护，没有死代码 |
| `SERVICE_CALL_TIMEOUT_MS` 与 composable 的 `SERVICE_TIMEOUT_MS` 两份真相（仅靠注释自称同值） | composable 改为从 Driver 导入（单一事实源），保留原名字再导出 |
| 契约 live 档的幂等断言是重言式（`!idempotent ⇒ failed` 天然成立） | 改为「**首次成功** → 重复销毁必须短路」；live 档只要求「结果已记录」 |

**Spec 轴**（issue 逐条核对）：

| 发现 | 处置 |
| --- | --- |
| 实施步骤 1 / 2（callback → Promise/Result、迟到回调 / 空结果 / SDK status 标准化） | 已实现，见 §1 / §2 / §4；测试见 `serviceCall.test.ts` 与 `services.test.ts` |
| 实施步骤 3（原生图层 setData/clearData/style/state/picking） | 已实现，见 §7 |
| 实施步骤 4（对官方类型缺失的扩展成员建立最小 augmentation） | **刻意不做**：augmentation 治理白名单要求「无法通过项目领域类型绕开」，此处已用领域类型 + 结构探测绕开；`#22` 对 `PanoramaCoverageLayer` 是同一口径。已在「非目标」写明，PR 正文复述，避免被按字面判为漏项 |
| 实施步骤 5 / 测试要求 5（同一 Harness 可跑 Fake v4 与真实 smoke 子集） | 探针拆成零 vitest 依赖的 `facet-probes.ts`，vitest 契约与真实 AK 页面共用同一份代码；**smoke 本身是一次性人工验证、不进门禁**（AK 来自 docs 示例，进门禁会把门禁绑到外部配额），此点在 ADR 与 PR 正文都明确标注 |
| 测试要求 1~4 | 逐条对应：`serviceCall.test.ts`(9)、`services.test.ts`(23)、`native-layers.test.ts`（含 8×12 一致性）、`panorama.test.ts`(12)、`v3-jsapi-v4-services-native-layers.test.ts`(12，跑装配后的 Driver) |
| 验收标准 2「后续组件不需要访问 raw BMap 服务或图层」 | **部分达成**：seam 已就位（`driver.services.geocode(...)` / `driver.nativeLayers.*` 不需要 raw），但**现有 7 处 service composable 与 `BAutoComplete.vue` 仍用 `handle.raw`**——迁移属 M7 `#38`（与 ServiceSpec / AsyncTaskController 一并设计）。ADR「迁移影响」与「已知限制」都登记了这条，**不当作已完成** |
| 验收标准 1「v4 Driver 覆盖 Cutover 前现有全部功能」 | 部分：LocalSearch / Route 服务类、TrackLine 播放控制、panorama 声明式能力、`layer.traffic` 均有据顺延（各自的 ADR / issue 已登记） |
| 风险条目「能力探测必须允许加载后就绪」 | 已实现且有用例（§8） |
| 「DoD」7 条 | typecheck / test:unit / build / 边界与声明门禁 / 能力矩阵 / pack + verify:package 全绿；PR 描述含 SDK 依据、生命周期检查与迁移影响 |

## 参考

- issue #23 `[M3A2] 实现 Service/Panorama/Native Layer Facet 并完善 Driver Contract`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- 官方 4.0 API 参考：`Geocoder` / `Convertor` / `Boundary` / `LocalCity` / `Geolocation` /
  `Autocomplete` / `ViewAnimation` / `Panorama` / `PanoramaService` / `PointLayer` /
  `ClusterLayer` / `PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer` /
  `Heatmap` / `TrackLine`
- 官方类型包 `@baidumap/jsapi-v4-types@4.0.4`：`service/*.d.ts`、`panorama/*.d.ts`、
  `layer/{PointIconLayer,PointShapeLayer,LineLayer,FillLayer}.d.ts`、`const/StatusCodes.d.ts`
- 官方 Skill `bmap-jsapi-v4`：`references/visualization-layers.md`、
  `references/runtime-extended-apis.md`、`references/search-and-geocoding.md`、
  `references/geolocation-and-convertor.md`、`references/panorama.md`、
  `references/data-layers.md`
- 代码：`src/driver/jsapi-v4/{services,panorama,native-layers}.ts`、
  `src/driver/normalize/{serviceCall,jsonpProbe}.ts`、`src/driver/createJsapiV4Driver.ts`、
  `src/driver/types/{services,panorama,native-layers,bmap}.ts`、
  `src/driver/capability/catalog.ts`
- Fake 与契约：`packages/test-utils/fake-bmap-v4/{services,native-layers,panorama}.ts`、
  `packages/test-utils/{facet-probes,driver-contract}.ts`
