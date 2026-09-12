# useBMapMarkerIcons

通过该 hooks 可获取一些内置的地图图标（JSAPI 4.0 的 `BMap.Icon` 实例）。

```ts
import { useBMapMarkerIcons } from 'baidu-map-gl-vue'
```

> 参考：[marker 图标可选值](/zh-CN/components/overlay/marker#默认图标可选值)

## 用法

```ts
const icons = useBMapMarkerIcons(client) // client 可在 ready 事件或 useBMap().client 获取
```

:::tip
图标经 `client.driver.overlays.buildIcon` 构建，不依赖全局 SDK 命名空间；在 `<BMap>` 子树内调用时可省略参数
:::

### 参数

| 参数 | 描述 | 类型 |
| --- | --- | --- |
| client | BMapClient（map ready 后可用） | `BMapClient`（可选） |

### 返回值

| 返回值 | 描述                                    | 类型                                      |
| ------ | --------------------------------------- | ----------------------------------------- |
| icons  | 所有内置的图标实例对象键值对 | `Record<DefaultMarkerIcons, unknown>`（raw SDK 实例，经 Driver 构建） |

## 代码示例

composable 必须在 `setup` 内调用（内部使用 `inject`）。在 `<BMap>` 子树内可省略参数，
否则请在 `ready` 载荷中拿到 `client` 后显式传入：

```vue
<template>
  <BMap @ready="handleReady">
    <IconUser />
  </BMap>
</template>

<script setup lang="ts">
import { BMap, useBMapMarkerIcons, type BMapClient } from 'baidu-map-gl-vue'
import { defineComponent, h } from 'vue'

// 子树内调用：省略参数
const IconUser = defineComponent({
  setup() {
    const icons = useBMapMarkerIcons()
    return () => h('div')
  }
})

function handleReady({ client }: { client: BMapClient }) {
  const icons = useBMapMarkerIcons(client)
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
