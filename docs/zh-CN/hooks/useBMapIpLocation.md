# useBMapIpLocation <Badge type="tip" text="^0.0.33" />

用于获取用户所在的城市位置信息。(根据用户 IP 自动定位到城市)

```ts
import { useBMapIpLocation } from 'baidu-map-gl-vue'
```

## 示例

:::demo
hooks/useBMapIpLocation
:::

## 用法

```ts
const { get, location, isLoading } = useBMapIpLocation(map)
```

:::tip
该 hooks 依赖于 `BMapGL`，所以需要在 `Map` 组件初始化完毕调用 `get` 方法后数据才可用
:::

### 参数

| 参数 | 描述                 | 类型                                | 默认值 |
| ---- | -------------------- | ----------------------------------- | ------ |
| map  | 地图组件 ref，用于等待地图 SDK 初始化 | `unknown` | - |

### 返回值

| 返回值    | 描述                         | 类型 |
| --------- | ---------------------------- | ---- |
| isLoading | 是否在获取中                 | `boolean` |
| location  | 定位信息，初始为 `null`      | `BMapIpLocationResult \| null` |
| get       | 获取定位方法                 | `() => Promise<BMapIpLocationResult \| null>` |
| error     | 最近一次错误                 | `unknown` |

## TS 类型定义参考

```ts
import { Ref } from 'vue'
import type { PointLike } from 'baidu-map-gl-vue'
interface BMapIpLocationResult {
  point: PointLike
  code: number
  name: string
}
/**
 * ip定位
 */
export declare function useBMapIpLocation(map?: unknown): {
  location: Ref<BMapIpLocationResult | null>
  isLoading: Ref<boolean>
  get: () => Promise<BMapIpLocationResult | null>
}
```
