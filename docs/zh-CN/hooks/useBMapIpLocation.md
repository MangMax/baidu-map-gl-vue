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
该 hooks 需要地图 ready 后才能执行定位；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数 | 描述                 | 类型                                | 默认值 |
| ---- | -------------------- | ----------------------------------- | ------ |
| map  | 地图组件 ref，用于等待地图 SDK 初始化（可省略，用注入值） | `unknown` | - |

### 返回值

| 返回值    | 描述                         | 类型 |
| --------- | ---------------------------- | ---- |
| data      | 定位信息，初始为 `null`（`location`/`result` 为其别名） | `Ref<BMapIpLocationResult \| null>` |
| location  | 定位信息，初始为 `null`      | `Ref<BMapIpLocationResult \| null>` |
| isLoading | 是否在获取中                 | `Ref<boolean>` |
| error     | 最近一次错误                 | `Ref<unknown>` |
| isError   | 是否出错                     | `Ref<boolean>` |
| isEmpty   | 结果是否为空                 | `Ref<boolean>` |
| status    | 异步状态                     | `Ref<'idle' \| 'loading' \| 'success' \| 'error'>` |
| get       | 获取定位方法                 | `() => Promise<BMapIpLocationResult \| null>` |
| cancel    | 取消 pending 请求            | `() => void` |
| reset     | 清空 data/error              | `() => void` |

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
  data: Ref<BMapIpLocationResult | null>
  result: Ref<BMapIpLocationResult | null>
  isLoading: Ref<boolean>
  error: Ref<unknown>
  isError: Ref<boolean>
  isEmpty: Ref<boolean>
  status: Ref<'idle' | 'loading' | 'success' | 'error'>
  get: () => Promise<BMapIpLocationResult | null>
  cancel: (reason?: unknown) => void
  reset: () => void
}
```
