# useBMapMarkerIcons

通过该 hooks 可获取一些内置的地图图标 (BMapGL.Icon)。

```ts
import { useBMapMarkerIcons } from 'baidu-map-gl-vue'
```

> 参考：[marker 图标可选值](/zh-CN/components/overlay/marker#默认图标可选值)

## 用法

```ts
const icons = useBMapMarkerIcons(client) // client 可在 ready 事件或 useBMap().client 获取
```

:::tip
图标经 `client.driver.overlays.buildIcon` 构建，不依赖全局 `BMapGL`；在 `<BMap>` 子树内调用时可省略参数
:::

### 参数

| 参数 | 描述 | 类型 |
| --- | --- | --- |
| client | BMapClient（map ready 后可用） | `BMapClient`（可选） |

### 返回值

| 返回值 | 描述                                    | 类型                                      |
| ------ | --------------------------------------- | ----------------------------------------- |
| icons  | 所有内置的 `BMapGL.Icon` 实例对象键值对 | `Record<DefaultMarkerIcons, BMapGL.Icon>` |

## 代码示例

```vue
<template>
  <Map @initd="handleInitd"></Map>
</template>

<script setup lang="ts">
  import { useBMapMarkerIcons } from 'baidu-map-gl-vue'

  function handleInitd() {
    const icons = useBMapMarkerIcons()
    // ...
  }
</script>
```

## TS 类型定义参考

```ts
export declare type DefaultMarkerIcons =
  | 'simple_red'
  | 'simple_blue'
  | 'loc_red'
  | 'loc_blue'
  | 'start'
  | 'end'
  | 'location'
  | 'red1'
  | 'red2'
  | 'red3'
  | 'red4'
  | 'red5'
  | 'red6'
  | 'red7'
  | 'red8'
  | 'red9'
  | 'red10'
  | 'blue1'
  | 'blue2'
  | 'blue3'
  | 'blue4'
  | 'blue5'
  | 'blue6'
  | 'blue7'
  | 'blue8'
  | 'blue9'
  | 'blue10'
export declare function useBMapMarkerIcons(client?: BMapClient): Record<string, unknown>
```
