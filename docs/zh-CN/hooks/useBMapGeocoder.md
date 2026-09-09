# useBMapGeocoder <Badge type="tip" text="^0.0.39" />

通过地址解析坐标点

```ts
import { useBMapGeocoder } from 'baidu-map-gl-vue'
```

## 单个地址解析

使用地址字符串作为 `get` 方法参数解析单个地址
:::demo 通过下拉框切换地址解析坐标点
hooks/useBMapGeocoder/index
:::

:::tip
在 Ts 中使用单个解析地址时，使用泛型 `Point` 内部可推断 `point` 为可推断为 `Point`，从而避免读取值时 ts 的报错。

```ts
import { Point } from 'baidu-map-gl-vue'
const { point } = useBMapGeocoder(map)
```

:::

## 批量解析地址

使用地址字符串数组作为 `get` 方法参数批量解析地址
:::demo
hooks/useBMapGeocoder/batch
:::

:::tip
在 Ts 中使用批量解析地址时，使用泛型 `Point[]` 内部可推断 `point` 为可推断为 `Point[]`，从而避免遍历时 ts 的报错。

```ts
import { Point } from 'baidu-map-gl-vue'
const { getBatch } = useBMapGeocoder(map)
```

:::

## 用法

```ts
const { get, getBatch, point, isLoading, isEmpty } = useBMapGeocoder(map)
```

:::tip
该 hooks 需要地图 ready 后才能执行解析；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数 | 描述                                         | 类型      | 默认值 |
| ---- | -------------------------------------------- | --------- | ------ |
| map  | `Map`地图组件实例或 `ref`（可省略，用注入值） | `unknown` | -      |

### 返回值

| 返回值    | 描述                                                                                                                  | 类型                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| data      | 解析结果（`point`/`location`/`result` 均为其别名）                                                                     | `Ref<GeoPoint \| null>`                                  |
| point     | 地址解析出来的坐标点                                                                                                  | `Ref<GeoPoint \| null>`                                  |
| error     | 错误信息                                                                                                              | `Ref<unknown>`                                           |
| isError   | 是否出错                                                                                                              | `boolean`                                                |
| isEmpty   | 是否无解析结果                                                                                                        | `boolean`                                                |
| isLoading | 是否在获取中                                                                                                          | `boolean`                                                |
| status    | 异步状态                                                                                                              | `Ref<'idle' \| 'loading' \| 'success' \| 'error'>`       |
| get       | 获取地址到坐标点方法，需要在`Map`组件`ready`后才可调用；参数 `address` 表示要解析的地址，`city` 表示地址所属的城市     | `(address: string, city: string) => Promise<GeoPoint>`   |
| getBatch  | 批量解析，逐项返回 `{ address, point, error? }`                                                                        | `(addresses: string[], city: string) => Promise<GeocodeItemResult[]>` |
| cancel    | 取消 pending 请求                                                                                                     | `() => void`                                             |
| reset     | 清空 data/error                                                                                                       | `() => void`                                             |

#### Point

```ts
type Point = { lng: number; lat: number }
```

## TS 类型定义参考

```ts
import { Ref } from 'vue'
import { type Point } from 'baidu-map-gl-vue'

export interface GeoPoint {
  lng: number
  lat: number
}

export interface GeocodeItemResult {
  address: string
  point: GeoPoint | null
  error?: unknown
}

/**
 * 由地址解析坐标点
 */
export declare function useBMapGeocoder(map?: unknown): {
  data: Ref<GeoPoint | null>
  location: Ref<GeoPoint | null>
  point: Ref<GeoPoint | null>
  result: Ref<GeoPoint | null>
  error: Ref<unknown>
  isError: Ref<boolean>
  isEmpty: Ref<boolean>
  status: Ref<'idle' | 'loading' | 'success' | 'error'>
  isLoading: Ref<boolean>
  get: (address: string, city: string) => Promise<GeoPoint | null>
  getBatch: (addresses: string[], city: string) => Promise<GeocodeItemResult[]>
  cancel: (reason?: unknown) => void
  reset: () => void
}
```
