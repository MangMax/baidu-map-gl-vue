---
title: 数据组件
---

# 数据组件

数据组件用于用数组驱动多个地图标记。它们适合由数据更新统一管理 Marker 生命周期。

## BMarkerList

`BMarkerList` 是当前的实现名称。每个 item 对应一个 SDK Marker，适合中小规模、仍需要逐点交互的数据。

```ts
import { BMarkerList } from 'baidu-map-gl-vue'
```

```vue
<BMarkerList
  :data="stations"
  item-key="id"
  :get-position="station => ({ lng: station.lng, lat: station.lat })"
  @item-click="onItemClick"
/>
```

| 属性 | 说明 | 类型 |
| --- | --- | --- |
| `data` | 数据数组 | `readonly Item[]` |
| `itemKey` | item 唯一键，也可以传函数 | `keyof Item \| ((item: Item) => PropertyKey)` |
| `getPosition` | 从 item 返回经纬度 | `(item: Item) => { lng: number; lat: number }` |
| `dataVersion` | 数据引用不变但内容变化时可递增 | `PropertyKey` |
| `visible` | 数据层可见性标记 | `boolean` |

| 事件 | 说明 | 参数 |
| --- | --- | --- |
| `item-click` | 某个 Marker 被点击 | `item` |

组件会进行 keyed diff，并在卸载时移除全部 Marker 和事件监听。

## BPointLayer

`BPointLayer` 仍可使用，但已标记为 deprecated alias，实际行为与 `BMarkerList` 相同。它不是单个 SDK 批量点资源，而是每个 item 创建一个 SDK Marker。

新代码请使用 `BMarkerList`。

## BMarkerCluster

`BMarkerCluster` 使用 zoom 和像素网格进行聚合。`gridSize` 的单位是像素，`minClusterSize` 以下的点会展开成独立 item，不会因为没有达到聚合阈值而丢失。

```vue
<BMarkerCluster
  :data="stations"
  item-key="id"
  :get-position="station => ({ lng: station.lng, lat: station.lat })"
  :grid-size="64"
  :min-cluster-size="3"
  @cluster-click="onClusterClick"
  @item-click="onItemClick"
/>
```

| 属性 | 说明 | 默认值 |
| --- | --- | --- |
| `data` | 数据数组 | - |
| `itemKey` | item 唯一键 | - |
| `getPosition` | 从 item 返回经纬度 | - |
| `gridSize` | 像素网格大小 | `64` |
| `zoom` | 聚合使用的地图 zoom；未提供时读取地图 zoom | 地图 zoom / `8` |
| `minClusterSize` | 达到该数量才聚合 | `3` |
| `dataVersion` | 数据版本标记 | - |
| `visible` | 可见性标记 | - |

`cluster-click` 的参数是聚合对象，`item-click` 的参数是未聚合的 item。
