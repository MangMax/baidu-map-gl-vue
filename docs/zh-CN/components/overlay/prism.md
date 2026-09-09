# BPrism 3d 棱柱

通过该组件可在地图上绘制 3d 棱柱，可以基于位置经纬度，高度，顶面和侧面的颜色、透明度等属性来绘制不规则的棱柱体。

```ts
import { BPrism } from 'baidu-map-gl-vue'
```

## 示例

:::demo 通过 [`useBMapAreaBoundary`](../hooks/useBMapAreaBoundary) 获取边界字符串，并传给 `BPrism` 的 `path`，同时设置 `isBoundary` 为 `true`
overlay/prism
:::

## 静态组件 Props

| 属性           | 说明                       | 类型       | 默认值   |
| -------------- | -------------------------- | ---------- | -------- |
| isBoundary     | 是否是行政区域的边界多边形 | `boolean ` | `false ` |
| autoCenter     | 是否自动根据多边形居中地图 | `boolean ` | `true`   |
| enableClicking | 是否响应点击事件           | `boolean ` | `true `  |

## 动态组件 Props

| 属性            | 说明                                        | 类型                            | 可选值 | 默认值     | 版本                               |
| --------------- | ------------------------------------------- | ------------------------------- | ------ | ---------- | ---------------------------------- |
| path            | 普通多边形使用点对象数组，行政边界使用边界字符串数组 | `{ lng: number, lat: number}[] \| string[]` | - | `required` | - |
| altitude        | 3d 棱柱高度                                 | `number`                        | -      | `required` | -                                  |
| topFillColor    | 顶面填充颜色                                | `string `                       | -      | `#fff`     | -                                  |
| topFillOpacity  | 顶面填充颜色透明度                          | `number`                        | `0-1`  | -          | -                                  |
| sideFillColor   | 侧面填充颜色                                | `string`                        | -      |            | -                                  |
| sideFillOpacity | 侧面填充颜色透明度                          | `number`                        | `0-1`  | `#fff`     | -                                  |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean`                       | -      | ` true`    | -                                  |
| visible         | 是否显示                                    | `boolean`                       | -      | `true`     | <Badge type="tip" text="^2.2.0" /> |

## 组件事件

v3 子组件没有 `initd/unload` 事件；以下为实际发出的 typed emits（载荷为 SDK 原生事件）：

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 鼠标左键单击事件的回调函数 | `(e: unknown) => void` |
| dblclick | 鼠标左键双击事件的回调函数 | `(e: unknown) => void` |
| mouseover | 鼠标指针移入该覆盖物事件的回调函数 | `(e: unknown) => void` |
| mouseout | 鼠标指针移出该覆盖物事件的回调函数 | `(e: unknown) => void` |

