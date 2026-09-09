# BPolygon 多边形

在地图上绘制简单的多边形

```ts
import { BPolygon } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 在地图上绘制可编辑的多边形
overlay/polygon/index
:::

## 镂空面绘制 / 行政区域边界

:::demo 结合 [`useBMapAreaBoundary`](../hooks/useBMapAreaBoundary) 获取边界字符串，并通过 `isBoundary` 为 `true` 绘制行政区域
overlay/polygon/boundaries
:::

## 静态组件 Props

| 属性           | 说明                                                       | 类型       | 默认值   |
| -------------- | ---------------------------------------------------------- | ---------- | -------- |
| clip           | 是否进行跨经度 180 度裁剪，绘制跨精度 180 时为了优化效果， | `boolean ` | `true `  |
| geodesic       | 是否开启大地线模式，true 时，两点连线将以大地线的形式。    | `boolean ` | `false ` |
| isBoundary     | 是否是行政区域的边界多边形                                 | `boolean ` | `false ` |
| autoCenter     | 是否自动根据多边形居中地图                                 | `boolean ` | `true`   |
| enableClicking | 是否响应点击事件                                           | `boolean ` | `true `  |

## 动态组件 Props

| 属性            | 说明                                        | 类型                             | 可选值                    | 默认值     | 版本                               |
| --------------- | ------------------------------------------- | -------------------------------- | ------------------------- | ---------- | ---------------------------------- |
| path            | 多边形的坐标数组                            | ` { lng: number, lat: number}[]` | -                         | `required` | -                                  |
| strokeColor     | 描边的颜色，同 CSS 颜色                     | `string`                         | -                         | `#000000`  | -                                  |
| strokeWeight    | 描边的宽度，单位为像素                      | `string `                        | -                         | `2 `       | -                                  |
| strokeOpacity   | 描边的透明度，范围 0-1                      | `number `                        | -                         | `1 `       | -                                  |
| strokeStyle     | 描边的样式，为实线、虚线、或者点状线        | `string `                        | `solid / dashed / dotted` | -          | -                                  |
| fillColor       | 面填充颜色，同 CSS 颜色                     | `string `                        | -                         | `#fff`     | -                                  |
| fillOpacity     | 面填充的透明度，范围 0-1                    | `number `                        | `0-1`                     | `0.3 `     | -                                  |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean`                        | -                         | ` true`    | -                                  |
| enableEditing   | 开启可编辑模式                              | `boolean `                       | -                         | `false `   | -                                  |
| visible         | 是否显示                                    | `boolean`                        | -                         | `true`     | <Badge type="tip" text="^2.2.0" /> |

## 组件事件

v3 子组件没有 `initd/unload` 事件；以下为实际发出的 typed emits（载荷为 SDK 原生事件）：

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 鼠标左键单击事件的回调函数 | `(e: unknown) => void` |
| dblclick | 鼠标左键双击事件的回调函数 | `(e: unknown) => void` |

