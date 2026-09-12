---
title: JSAPI 4.0 真实浏览器 Smoke
lang: zh-CN
---

# JSAPI 4.0 真实浏览器 Smoke

类型检查通过**不代表** SDK 真实可用。真实运行时会暴露类型层看不出来的差异——4.0 的
`MapTypeId` 只有短键、全局自述的版本是 `"gl"`、`openInfoWindow` 异步生效——这些都是靠这一层
门禁抓到的。

## 两档，用途不同

| 档 | 命令 | 依赖 | 进什么门禁 |
| --- | --- | --- | --- |
| fixture | `pnpm smoke:v4:fixture` | 只需一个 Chromium；外部请求被 CDP 阻断 | **PR 门禁**（`quality.yml`） |
| live | `pnpm smoke:v4`（`BAIDU_MAP_AK=...`） | 真实 AK + 外网 | nightly + 手动触发 |

两档共用同一份探针清单（`tests/browser/jsapi-v4/main.ts`），**期望值按档给**：

- fixture 把 Fake BMap v4 命名空间挂到 `globalThis.BMap`，再走**默认** Provider
  （`baiduJsapiV4Provider()`，它会命中「复用既有全局」分支）并断言精确读数
  （覆盖物 2、控件 1、图层 1、未释放资源 0）；
- live 走默认 Provider 的真实 `v=4.0` 入口，只要求「结算且形状自洽」——把「真实环境必须成功」
  写死，只会得到一个天天红的门禁。

## 怎么跑

```bash
# PR 门禁同款：无 AK、无网络
pnpm smoke:v4:fixture

# 真实 SDK（AK 只经 URL 查询参数传给页面，不写任何文件）
BAIDU_MAP_AK=你的AK pnpm smoke:v4

# 排障：把 ready 等待压到几秒，或换浏览器
pnpm smoke:v4:fixture -- --ready-ms=3000
SMOKE_BROWSER=/path/to/chromium pnpm smoke:v4:fixture
```

浏览器按 `SMOKE_BROWSER` → Playwright 缓存（`~/Library/Caches/ms-playwright` /
`~/.cache/ms-playwright`）→ 系统 Chrome/Chromium 的顺序查找，**不新增 npm 依赖**。CI 上
`ubuntu-latest` 自带 Chrome。

读数走 CDP（`Runtime.evaluate` 读 `window.__SMOKE__`），**不要**改用
`--dump-dom --virtual-time-budget`：真实瓦片持续加载时它会挂死（实测 2 分钟不退出、产物 0 字节）。

## 探针清单

| 探针 | 覆盖什么 |
| --- | --- |
| `default-entry-provider` / `default-entry-load` / `default-entry-url` | 默认入口的 Provider 家族、`v=4.0` 入口 URL、`globalThis.BMap` 命名空间 |
| `reuse-existing-global` / `sdk-constant-shape` | 存量全局复用路径、真实常量落点读数 |
| `map-ready` / `map-view-round-trip` | Map 创建、视野 round-trip、经纬度↔像素闭合 |
| `overlay-marker-polyline` | Marker / Polyline 真的挂到了 SDK 上 |
| `control-zoom` / `layer-panorama-coverage` | 控件 / 图层挂载（真实 SDK 无读取接口时如实标注 `readApi: unavailable`） |
| `overlay-infowindow-driver` | 气泡的地图级 API（创建 → 打开 → 回读 → 关闭） |
| `infowindow-component-gap` | `<BInfoWindow>` 组件的**已知缺口**（v4 上不可用，见下） |
| `map-tiles-loaded` / `map-event-binding` | `tilesloaded`（live）/ 绑定-解绑计数归零（fixture） |
| `service-geocode` | 基础服务（真实环境的失败带 `SERVICE_*` 码，提示配额/网络） |
| `unmount-release` / `remount-after-unmount` / `multi-map` | 销毁释放、重挂载、同页多地图 |
| `plugin-failure-does-not-block-ready` | 插件失败不阻塞基础 Map ready |
| `retry-after-provider-failure` | 经 `<BMapProvider>` error 插槽的 `retry()` |
| `unhandled-exceptions` | 本库相关的未处理异常必须为 0 |

## 怎么读报告

行首是 `PASS` / `FAIL`，`FAIL` 后面方括号里是**原因码**，归因规则：

- `SERVICE_*` / `TILES_TIMEOUT` → 多半是配额、网络或外部波动；
- `BMAP_*` / `BLOCKED` / `DOM_RESIDUE` / `HANDLE_NOT_DISPOSED` → 提示库回归；
- `BLOCKED` 表示前置探针（通常是 `map-ready`）没过，本探针**没有执行**——不是通过。

跨域第三方脚本的异常记为 `INFO third-party-exceptions`，**不计入门禁**（浏览器只给
`"Script error."`，无法归属）。本库相关异常（同源 `source` 或 `unhandledrejection`）才要求为 0。

## 已知缺口

`<BInfoWindow>` 组件在 v4 上**不可用**：它的挂载路径把气泡当普通覆盖物
`driver.overlays.add(map, iw)`，而 v4 OverlayDriver 明确拒绝（`BMAP_INVALID_ARGUMENT`：
气泡是地图级 API）。smoke 用 `infowindow-component-gap` 把这个现状**钉成断言**（连原因码一起
断言），而不是从场景里悄悄拿掉——否则「smoke 覆盖了 InfoWindow」会变成一句假话。重构属
[#32](https://github.com/Mang-X/bmap-vue/issues/32)（M5）。
Driver 层的气泡 API（`createInfoWindow` / `openInfoWindow` / `closeInfoWindow`）是通的，
由 `overlay-infowindow-driver` 在真实 SDK 上验证。

## 覆盖不到的差异（别把它当成万能的）

fixture 档用的是 Fake v4 命名空间，而 Fake 的 `MapTypeId` 镜像的是**官方类型声明**的形状。
于是「真实 4.0 的 `MapTypeId` 只有 `NORMAL`/`EARTH`/`SATELLITE` 短键」这类**落点差异**在 fixture
里复现不出来——修前那版只读 `MapTypeId.BMAP_*` 的实现在 fixture 下照样 ready。

结论：**真实运行时形状**（常量落点、`getControls()` 是否存在、`openInfoWindow` 的异步时序、
全局自述版本是 `"gl"`）只能靠 live 档发现；把它固化成回归用例则要靠 vitest 里的
「真实形状」命名空间（见 `tests/behavior/v3-jsapi-v4-map.test.ts` 的
`v4 Map setMapType 的常量落点`）。两档各管一半，缺一不可。

另外：`tests/**` 与 `packages/test-utils/**` **不在任何 typecheck 门禁的覆盖范围内**
（`typecheck:v3` 只编 `packages/baidu-map-gl-vue/src`），harness 的 TS 语法错误会在运行到那一行时
才暴露。加探针时请把它当成「没有编译期保护」的代码来写。

## 加新探针的规矩

1. **一次实验只回答一个问题**；需要服务回包的探针排在前面（同一页面连续多次服务检索会因配额
   拿不到回包，表现为「回包数 0」而不是报错）。
2. **每个新探针都要自带已知会成功的对照组**；对照组也没回包时，结论一律记「未验证」，不要
   据此断言某个方法无效。
3. 探针独立 `try/catch`：一步失败不中断整轮，但**前置失败时后续探针必须以 `BLOCKED` 结算**，
   不能静默跳过。
4. 引擎/实现差异（读数落点、是否存在读取接口）收在 `main.ts` 的**模式描述**里，探针本身只写
   领域语言。
5. 探针自己申请的资源要在 `finally` 里释放，否则 `unmount-release` 会被自己污染。
