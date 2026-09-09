---
title: 组件事件
lang: zh-CN
---

# 组件事件

v3 组件使用类型化 `emits` 直接对外广播，不经过内部事件总线。

## BMap

| 事件名       | 说明                                       | 载荷                              |
| ------------ | ------------------------------------------ | --------------------------------- |
| ready        | 地图就绪（`client + map` 可用）            | `{ client, map, container }`      |
| initd        | 同 `ready`（deprecated，请改用 `ready`）   | `{ client, map, container }`      |
| plugin-ready | 单个插件加载完成（载荷为插件名字符串）     | `name: string`                    |
| plugin-error | 单个插件加载失败                           | `{ name, error }`                 |
| click        | 地图点击（已归一化为 `MapMouseEvent`）     | `{ point, pixel, domEvent, raw }` |
| unload       | 地图组件卸载                               | -                                 |
| error        | 地图或 Client 加载失败                     | `BMapError`                       |

其中 `map` 为 `MapHandle`（不再是 raw SDK 地图；raw 地图经 `baidu-map-gl-vue/advanced` 的 `unwrapRaw()` 获取），
`client` 提供 `driver` 领域接口（`driver.map / driver.overlays / driver.services / driver.geometry`）。

```vue
<BMap ak="xxx" @ready="onReady" @plugin-ready="onPluginReady" @click="onClick" />
```

```ts
function onReady({ client, map }: { client: BMapClient; map: MapHandle }) {
  // 命令式能力经 driver 调用，例如：
  client.driver.map.setZoom(map, 15)
}
function onPluginReady(name: string) {
  console.log('plugin ready:', name)
}
```

## 子组件

覆盖物 / 控件 / 图层组件各自声明自己的 typed emits（如 `BMarker` 的 `click/dblclick/dragend/update:position`、
`BInfoWindow` 的 `open/close`、`BContextMenu` 的 `open/close`），详见各组件文档的事件表。
子组件没有 `initd/unload` 事件；如需地图实例，请用 `useBMap()` + `whenReady()`：

```ts
import { useBMap } from 'baidu-map-gl-vue'

const { whenReady } = useBMap() // 须在 <BMap> 子树内调用
const { client, map } = await whenReady()
```

## 内部诊断事件

`resource:error` / `plugin:ready` 等内部事件走每 Runtime 独立的诊断总线，仅用于日志与调试，
不作为组件间 ready 或注册同步机制，不建议业务代码订阅。
