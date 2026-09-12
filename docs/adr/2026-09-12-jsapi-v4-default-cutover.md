# ADR 2026-09-12：JSAPI 4.0 默认切换与真实浏览器 smoke

- issue：`#25`（`M3A3-CUTOVER`；总追踪 `#12`）
- 前置：`#18`（LoadedSdk/Client 收口）、`#19`~`#23`（v4 Facet Driver）、`#24`（Fake v4 诊断与双跑矩阵）
- 后续：`#26` 删除 `webgl-v1`、`types/BMapGL` 与 `fake-bmapgl`；`#32` 重构 `BInfoWindow`

## 背景

`#18` 起 `createBMapClient()` 的默认 Driver 已经是 JSAPI 4.0，`#23` 把七个 Facet 装配齐了，
但**组件默认入口仍然指向 legacy**：`createBMapPlugin()` 缺省用 `baiduCdnProvider()`（旧
`type=webgl` 入口），`<BMap>` 的存量全局回退读 `BMap ?? BMapGL`。结果是「线上默认路径」与
「Stable 基线」不一致：类型与单测都在 v4 上，用户实际跑的还是旧引擎。

这一版把默认入口切过去，并且——这是本 ADR 的主要价值——把切换建立在**真实浏览器**的证据上，
而不是「类型层核对过」。切换过程中真实运行时暴露了三处类型层看不出来的差异。

## 决策

### 1. 默认 Provider 换成 JSAPI 4.0 CDN 家族

`createBMapPlugin({ ak })` 与 `<BMap ak="...">` 的默认 Provider 改为 `baiduJsapiV4Provider()`：
入口 `https://api.map.baidu.com/api?v=4.0&ak=...`，就绪信号是 JSONP `callback`，命名空间
`globalThis.BMap`。`allowExistingGlobal: true` 改为 `existingGlobalV4Provider()`。

「默认」= **未显式传 `provider`** 的那条路径。显式传入的 Provider 仍按加载结果的 engine 分派
（`withMigrationDriver`），legacy 能力与 Fake 双跑随 `#26` 一并删除——这样 `#26` 的删除面是
「删一个文件 + 删一条分派」，不是「删一批用户可观察行为」。

### 2. 「存量全局」回退只认 `BMap`

新增 `hasExistingJsapiV4Global()`：`globalThis.BMap` 存在**且结构完整**（`Map`/`Point`/`Marker`）
才算就绪。`<BMap>` 的无定义回退从 `hasExistingGlobalSdk()`（读 `BMap ?? BMapGL`）改为它。

注意 4.0 入口自己会把 `BMapGL` 作为**同一对象的别名**挂上（见下「实测」），所以「有 `BMapGL`」
不等于「v4 就绪」，也不等于「legacy 可用」——两者不能用同一个探测表达。

### 3. Playground 双模式，组件不传 `provider`

`?mode=fake`（默认）注入 Fake v4 命名空间后用公开的 `existingGlobalV4Provider()` 复用；
`?mode=real&ak=...` 用默认 Provider 打真实 CDN。两种模式都走**默认定义**（`app.use` 的那份），
而不是给每个组件塞一个 provider——否则 demo 验证的路径和线上不是同一条。

### 4. 浏览器 smoke 分两档，只有一档进 PR 门禁

`tests/browser/jsapi-v4/` 是可复用的真实浏览器 harness（Vite 起页面 + CDP 读数 + 退出码）：

| 档 | 命令 | 依赖 | 进什么门禁 |
| --- | --- | --- | --- |
| fixture | `pnpm smoke:v4:fixture` | 只需 Chromium；外部请求被 CDP 阻断 | **PR 门禁**（`quality.yml`） |
| live | `pnpm smoke:v4` | 真实 AK（`BAIDU_MAP_AK`）+ 外网 | nightly + 手动触发 |

两档共用同一份探针清单，期望值按档给（`fixture` 要求精确读数，`live` 只要求「结算且形状自洽」）。
把「真实环境必须成功」写死会得到一个天天红的门禁，最后所有人都学会忽略它。

`fixture` 档刻意做成**零网络**：同页还会断言 `performance.getEntriesByType('resource')` 里
没有任何跨域请求——「PR 门禁不依赖外网」不是口号，是可断言的。

## 依据与真实运行时实测

第一手来源：官方 `@baidumap/jsapi-v4-types@4.0.4` 的 `.d.ts`、仓库内 `bmap-jsapi-v4` 官方技能
文档、以及**真实 AK + headless Chromium 的运行时读数**。三者不一致时以运行时为准，并把差异
写进「已知限制」。

实测（2026-09-12，`v=4.0` + 有效 AK，`docs/examples` 里的 AK，不落盘）：

| 事实 | 读数 |
| --- | --- |
| 入口 URL | `https://api.map.baidu.com/api?v=4.0&ak=***`，`metadata.mode=jsonp`、`versionSource=url` |
| `type=webgl` 参数 | **与不带它的 `v=4.0` 返回完全相同的 bootstrap**（都写 `window.BMap = window.BMapGL = …`），因此删除它是纯减法 |
| 常量落点 | `BMap.BMAP_NORMAL_MAP = "B_NORMAL_MAP"`（命名空间上**存在**）；`BMap.MapTypeId` 实际是 `{ NORMAL, EARTH, SATELLITE }` |
| `MapTypeId` 取值 | `SATELLITE: "B_STREET_MAP"` —— 与 `BMAP_HYBRID_MAP` 同值，**不是** `BMAP_SATELLITE_MAP`（`"B_SATELLITE_MAP"`） |
| 全局版本自述 | `BMap.version === "gl"`（`VERSION` 缺失） |
| `getOverlays()` | 存在，且**会把打开的气泡计入**（打开前 2 → 打开后 3） |
| `getControls()` / `getLayers()` | **不存在**，控件/图层的 SDK 侧读数无法核对 |
| `openInfoWindow` | 异步生效（约 100~300ms 后才 `getInfoWindow()` 可见） |
| `tilesloaded` | 正常派发 |
| `PluginRegistry` | `TrackAnimation` 脚本在 4.0 上**加载成功后运行时抛错**（跨域，见「已知限制」4） |

## 据此修掉的两处真实缺陷

### 1. `setMapType` 读错了常量落点（`driver/jsapi-v4/map.ts`）

原实现只读 `BMap.MapTypeId.BMAP_NORMAL_MAP`，而真实运行时 `MapTypeId` 的键是 `NORMAL` /
`EARTH` / `SATELLITE` → 取值为 `undefined` → `setMapType("normal")` 抛
`BMAP_SDK_CALL_FAILED: BMap.MapTypeId.BMAP_NORMAL_MAP is not available` → **`<BMap>` 永远
到不了 ready**（`applyMapType` 在 `boot()` 里）。

修法：先读**命名空间自身的同名常量** `BMap.BMAP_NORMAL_MAP`（官方类型包注释里写的就是
「`@since 4.0` 推荐直接使用 `BMAP_*_MAP` 全局常量」，真实运行时也确有），再退回
`BMap.MapTypeId.<同名常量>`（官方声明形状 + Fake v4 形状）。

**刻意不做的事：不读 `MapTypeId` 的短键**。它的 `SATELLITE` 取值是 `"B_STREET_MAP"`，与
`BMAP_HYBRID_MAP` 同值——按短键映射会把「卫星图」静默换成「混合图」。宁可显式失败，也不要
一个取值语义不可信的映射。

### 2. 版本探测把非版本令牌当版本号（`core/loader/providers/namespace.ts`）

真实 4.0 全局自述 `version: "gl"`，而 `resolveExistingJsapiV4Version()` 只要探测到字符串就
做 `4.x` 校验 → `existingGlobalV4Provider()` 对**完全正常的** 4.0 全局抛
`SDK version "gl" is not JSAPI 4.0`。

修法：只对**看起来像版本号**（`/^\d/`）的取值做 4.x 校验；非版本令牌不构成版本证据，回退到
声明值/基线并标注 `versionSource: "declared"`。像版本号但不是 4.x（如 `"3.0"`）**仍然**显式
失败——守卫的本意是「别把 v3 全局当 v4」，不是「必须能读出版本号」。

注意这不是新发现：ADR 2026-09-11（Overlay facet）已经记过「`BMap.VERSION` 是 `"gl"`，不要用它
做 v4 判定」，但代码没有随之调整。这次把它落成回归测试。

## 生命周期与资源释放

- 默认 Provider 家族的释放路径不变：`SdkRegistry` 按 fingerprint 去重 → `SharedLoadTask`
  在成功/失败/取消三条路径清理 callback、abort listener、timer 与 `<script>`（`#16`）。
- `<BMap>` 的卸载路径不变：`MapRuntime.dispose()` → 先摘子资源（覆盖物/控件/图层/监听），
  再 `driver.map.destroy(map)`；`MapDriver` 契约要求销毁后其它命令被拒绝。
- smoke 的两档门禁分别核对这两件事：
  - fixture：`FakeV4Diagnostics.assertNoLeaks()`（未释放资源恒为 0，逐项点名）；
  - live：`driver.map.getZoom(map)` 必须抛 `BMAP_RESOURCE_DISPOSED`（证明销毁路径真的跑过）+
    SDK 在地图容器里搭的 DOM 已撤除（`.bmap-canvas-host` 子节点为 0）+ `unload` 事件恰好一次。
- 新增/改动的探针自身不留资源：插件失败探针、多地图探针、retry 探针都在 `finally` 里卸载。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `createBMapPlugin()` 默认 Provider 换成 `baiduJsapiV4Provider()` | 不传 provider 的用法现在加载 `v=4.0` 并读 `globalThis.BMap` | **这就是本 issue 的目的**；需要 legacy 的显式传 `baiduCdnProvider()`（随 `#26` 删除） |
| `allowExistingGlobal` 语义改为「复用已就绪的 `BMap`」 | 原来期待它探测 `BMapGL` 的用法会失败 | 文档已改；legacy 存量全局请显式用 `existingGlobalProvider()` |
| `<BMap>` 无定义时的存量全局回退只认结构完整的 `BMap` | 只有 `BMapGL` 的页面不再被静默接管 | 显式传 provider 或 `definition` |
| 新增公开导出 `baiduJsapiV4Provider` / `customScriptV4Provider` / `existingGlobalV4Provider` | 纯新增 | 文档示例改用它们 |
| 公开导出面变化 | manifest/API 产物需重新生成 | `pnpm generate:manifest`（见「测试与门禁」） |
| `setMapType` 常量解析顺序 | 真实 v4 由「抛错」变为「可用」 | 无破坏性变更；类型层签名不变 |
| 版本探测对非版本令牌的容忍 | `existingGlobalV4Provider()` 对真实 4.0 全局由「抛错」变为「可用」 | 无破坏性变更 |

无破坏性的公共 API 签名变更；`AnyBMapProviderLike` 等类型保持原样（显式传 legacy Provider 仍合法）。

## 测试与门禁

| 门禁 | 命令 | 本 issue 结果 |
| --- | --- | --- |
| 静态边界（禁区目录） | `pnpm check:raw-sdk` | 绿 |
| 静态边界（整棵 src） | `pnpm check:raw-sdk:tree` | 绿 |
| 公共声明边界 | `pnpm check:public-dts`（需先 build） | 绿 |
| v3 manifest / capability 矩阵 | `pnpm generate:manifest:check`、`pnpm generate:capability-matrix:check` | 绿 |
| 类型 | `pnpm typecheck:v3` | 绿（**只跑一次，且必须在 build 之前**，见下方备注）。注意该步骤**不在 CI 里**：上游 `@baidumap/jsapi-v4-types` 的 `index.d.ts` 大小写问题在 Linux 上必然失败（`quality.yml` 有注释说明），因此 CI 覆盖不到它 |
| 单元/行为 | `pnpm test:unit` | 96 文件 / 1054 用例全绿 |
| 打包消费 | `pnpm pack:v3` + `pnpm verify:package` | 绿 |
| 浏览器 smoke（fixture） | `pnpm smoke:v4:fixture` | 19 探针全绿，0 本库未处理异常 |
| 浏览器 smoke（live） | `pnpm smoke:v4`（需 AK） | 18 探针全绿，0 本库未处理异常 |
| Playground 构建 | `pnpm playground:build` | 绿（**未进 CI**） |

新增测试：

- `tests/behavior/v3-default-v4-cutover.test.ts`：默认 Provider 家族、`allowExistingGlobal` 指向
  v4、默认入口在 `globalThis.BMap` 就绪时产出 `jsapi-v4` Client 且 `rawSdk` 就是该命名空间、
  「只有 `BMapGL`」时默认回退不接管。
- `namespace.test.ts` 增补：`version: "gl"` → `declared`；`"3.0"` 仍抛错。
- `map` facet 测试增补：常量只落在命名空间上（真实形状）时也能解析；`MapTypeId` 只有短键时
  显式失败而不是取到错值。
- `tests/browser/jsapi-v4/**`：真实浏览器探针（Loader/Map/覆盖物/控件/图层/信息窗/服务/
  tilesloaded/多地图/重挂载/插件失败不阻塞/retry/未处理异常）。

## 已知限制

1. **`<BInfoWindow>` 组件在 v4 上不可用**（刻意不修）。它的挂载路径把气泡当普通覆盖物
   `driver.overlays.add(map, iw)`，而 v4 OverlayDriver 按 `#21` 的决策明确拒绝
   （`BMAP_INVALID_ARGUMENT`：气泡是地图级 API）。smoke 把它钉成可断言的现状
   （探针 `infowindow-component-gap`）而不是从场景里悄悄拿掉。Driver 层的
   `createInfoWindow` / `openInfoWindow` / `closeInfoWindow` 是通的（探针
   `overlay-infowindow-driver` 在真实 SDK 上验证过）。重构属 `#32`（M5）。
2. **真实 v4 的 `Map` 没有 `getControls()` / `getLayers()`**：控件与图层的 SDK 侧读数无法核对，
   live 档只能核对「Driver 调用成功 + 容器 DOM 已撤除」。smoke 的读数里显式标注
   `readApi: "unavailable"`，不写成「已验证」。
3. **`getOverlays()` 的口径**：真实 4.0 会把打开的气泡计入，Fake 把气泡放在单独的 `infoWindow`
   字段。两档的读数下限因此在模式描述里各自给出，不跨档比较绝对数字。
4. **不把插件标成支持**：`TrackAnimation` 在真实 4.0 上脚本加载成功但运行时抛
   `Cannot read properties of undefined (reading 'language')`（跨域脚本，浏览器只给
   `"Script error."`，取不到堆栈）→ 结论 **incompatible（待复核）**，后续动作 `#43`。
   其余内置插件的结论见下节「插件兼容 inventory」。
5. **live 档的未处理异常判读**：跨域脚本的异常（`source` 为空或非页面 origin）记为
   `thirdPartyUnhandled`，**不计入门禁**，只在报告里列出。否则一个插件脚本的噪声会让 nightly
   永久变红、掩盖真正的回归。本库相关异常（同源 `source` 或 `unhandledrejection`）仍为 0 才通过。
6. **`nightly` 的失败归因**：报告里的原因码是给归因用的——`SERVICE_*` / `TILES_TIMEOUT`
   提示配额、网络或外部波动；`BMAP_*` / `BLOCKED` / `DOM_RESIDUE` 提示库回归。
7. **未处理异常的门禁有已知盲区**：跨域脚本的异常在浏览器里只以 `"Script error."` 出现
   （无 `source`、无堆栈），无法归属，因此记为 `thirdPartyUnhandled` 不算门禁。这意味着
   「本库误用 SDK → 在跨域 SDK 内部未捕获抛出」这一类回归，只能靠**探针的结果断言**兜住，
   异常计数本身看不见它。runner 侧另有 CDP `Runtime.exceptionThrown`（特权通道，能看到跨域
   异常的堆栈），但当前只记录不判退——它同样会被插件自身的噪声污染（实测 `TrackAnimation`
   那条）。真要收紧，需要「已声明的第三方脚本清单 + 白名单之外一律判退」，属 `#45`。
8. **fixture 档覆盖不到「真实运行时形状」**：Fake v4 的 `MapTypeId` 镜像官方**类型声明**形状，
   所以本 ADR 决策 1 修掉的那个缺陷在 fixture 里复现不出来（修前版本也能 ready）。该回归由
   vitest 用「真实形状命名空间」守住（`tests/behavior/v3-jsapi-v4-map.test.ts`）。
9. **`tests/**` 不在 typecheck 门禁内**（`typecheck:v3` 只编 `src`），harness 与行为测试的
   类型错误没有编译期保护；本次新写的 harness 靠运行时逐条验证。
10. **`pnpm docs:build` 在改动之前就是坏的**（与本次改动无关）：`docs/` 下存在工作区依赖
    `docs/node_modules`，vitepress 的源码扫描会跟着符号链接走进
    `node_modules/vitepress/template/.vitepress/theme/*.vue`，其中有无法用 SFC 解析的文件 →
    `Element is missing end tag`。复现：`git archive HEAD | tar -x -C /tmp/pristine`（再链上
    node_modules）后 `vitepress build docs`，报同一个错。该步骤**不在 CI 里**，所以一直没暴露。
    本 issue 只验证了文档内容层面的一致性（格式检查、SFC 可解析性、术语 grep），构建失败
    记为欠账，修复属文档工具链（建议单开 issue）。
11. **公开声明仍带着 Provider 实现类**：`src/index.ts` 新增 v4 家族导出后，`dist/index.d.ts`
    里出现 `BaiduJsapiV4Provider` 与 `JsapiV4ProviderOptions{ loader?: ScriptLoader; registry?: SdkRegistry }`。
    legacy 的 `baiduCdnProvider` 早已是同样形态（不是本次引入），但出口收口属 `#44`。
12. **`check:public-dts` 只查 `BMap.*` / `BMapGL` 泄漏**，不查「实现类是否被导出」这类 API 面
    问题；`pnpm verify:manifest` 在当前 main 上就已经指向不存在的
    `scripts/collect-api-manifest.mts`（既存欠账，本次未修，避免把手伸进别人的门禁决策）。

## 插件兼容 inventory（实施步骤 5）

结论口径：证据来自真实 v4 运行时的 smoke 与代码路径核对；**没有运行时证据的一律记
`unverified`**，不因为「代码看起来能用」就写成 compatible。

| 插件 | 项目内入口 | v4 结论 | 证据 / 后续动作 |
| --- | --- | --- | --- |
| TrackAnimation | `plugins: ['TrackAnimation']`（`BMapGLLib`） | **incompatible（待复核）** | live smoke：脚本加载成功（`plugin-ready`）后抛 `Cannot read properties of undefined (reading 'language')`；跨域无堆栈。→ `#43` 定论，`#38`/`#41` 讨论 native replacement（`driver.map.startViewAnimation` 已可用） |
| DrawingManager | `plugins: ['DrawingManager']`（`BMapGLLib`） | **unverified** | 依赖 `BMapGL` 命名空间与 `BMapGL.*` 构造器；4.0 入口虽把 `BMapGL` 设为别名，但 `DrawingManager` 的绘制结果与 v4 Driver 的覆盖物记账没有对接证据。→ `#43` |
| GeoUtils | `plugins: ['GeoUtils']`（`BMapGLLib`） | **unverified** | 纯几何运算，与引擎耦合最弱；但仍未在 v4 上跑过。→ `#43` |
| MapVGL | `plugins: ['Mapvgl']` | **unverified** | 自带 WebGL 图层栈，与 v4 的 `map.addLayer` 容器关系未验证。→ `#43`（native 替代方向见 `#35`/`#36` 的原生数据图层） |
| DistanceTool / AreaRestriction / InfoBox / RichMarker / LuShu | 出现在文档的插件表，代码里**没有**内置定义 | **unsupported** | `stringToPluginDefinitions` 对未知名字返回 `required: false` 的空载入（不阻断 ready）。→ `#42`/`#43` 决定是否补 |

「不依赖 nightly 才发现基础加载失败」由两件事满足：① PR 门禁的 fixture 档在**无网络**下覆盖
Loader/Map/覆盖物/控件/图层/生命周期；② live 档把 Loader 作为**第一个**探针，任何后续失败都
先排除了 SDK 加载问题。

## 非目标与后续

- 不删除 `webgl-v1` Driver、`types/BMapGL` 与 `fake-bmapgl`（`#26`）。
- 不修 `<BInfoWindow>` 组件（`#32`）。
- 不给插件下 native replacement 的定论（`#43`）。
- 不在本条里统一 `Control` / `Layer` 的 SDK 侧读取接口（真实 SDK 没有该成员，属 `#41`）。

## 相关文件

- `packages/baidu-map-gl-vue/src/plugins/createBMapPlugin.ts`
- `packages/baidu-map-gl-vue/src/components/map/BMap.vue`
- `packages/baidu-map-gl-vue/src/core/loader/providers/{namespace,index}.ts`
- `packages/baidu-map-gl-vue/src/driver/jsapi-v4/map.ts`
- `packages/baidu-map-gl-vue/src/index.ts`
- `apps/playground/src/{main,providers}.ts`、`apps/playground/vite.config.ts`
- `tests/browser/jsapi-v4/**`、`tests/behavior/v3-default-v4-cutover.test.ts`
- `docs/zh-CN/guide/config.md`、`docs/zh-CN/components/{provider,map}.md`、`docs/zh-CN/contributing/v4-browser-smoke.md`
- `.github/workflows/quality.yml`、`.github/workflows/nightly-v4-smoke.yml`
