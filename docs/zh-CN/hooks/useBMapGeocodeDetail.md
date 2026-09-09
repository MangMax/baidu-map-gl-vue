# useBMapGeocodeDetail <Badge type="tip" text="^0.0.39" />

由坐标点解析地址信息

```ts
import { useBMapGeocodeDetail } from 'baidu-map-gl-vue'
```

## 单个坐标点解析

使用坐标点对象作为 `get` 方法参数解析单个坐标点
:::demo 鼠标点击地图选择坐标点解析
hooks/useBMapGeocodeDetail/index
:::

:::tip
`result` 为 `Ref<GeocodeDetailResult | null>`，可直接解构使用：

```ts
import { useBMapGeocodeDetail, type GeocodeDetailResult } from 'baidu-map-gl-vue'
const { result } = useBMapGeocodeDetail(map)
```

:::

## 批量解析坐标点

使用坐标点对象数组作为 `get` 方法参数批量解析坐标点
:::demo
hooks/useBMapGeocodeDetail/batch
:::

:::tip
批量解析使用 `getBatch`，逐项返回 `{ point, detail, error? }`：

```ts
import { useBMapGeocodeDetail, type GeocodeDetailResult } from 'baidu-map-gl-vue'
const { getBatch } = useBMapGeocodeDetail(map)
```

:::

## 用法

```ts
const { get, getBatch, result, isLoading, isEmpty } = useBMapGeocodeDetail(map)
```

:::tip
该 hooks 需要地图 ready 后才能执行解析；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数 | 描述                                         | 类型      | 默认值 |
| ---- | -------------------------------------------- | --------- | ------ |
| map  | `Map`地图组件实例或 `ref`（可省略，用注入值） | `unknown` | -      |

### 返回值

| 返回值    | 描述                                                          | 类型                                                   |
| --------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| data      | 解析结果（`result` 为其别名）                                 | `Ref<GeocodeDetailResult \| null>`                     |
| result    | 坐标点解析结果                                                | `Ref<GeocodeDetailResult \| null>`                     |
| error     | 错误信息                                                      | `Ref<unknown>`                                         |
| isError   | 是否出错                                                      | `boolean`                                              |
| isEmpty   | 是否有解析结果                                                | `boolean`                                              |
| isLoading | 是否在获取中                                                  | `boolean`                                              |
| status    | 异步状态                                                      | `Ref<'idle' \| 'loading' \| 'success' \| 'error'>`     |
| get       | 获取坐标点信息方法，需要在`Map`组件`ready`后才可调用          | `(point: Point) => Promise<GeocodeDetailResult>`       |
| getBatch  | 批量反查地址详情，逐项返回 `{ point, detail, error? }`        | `(points: Point[]) => Promise<BatchItem[]>`            |
| cancel    | 取消 pending 请求                                             | `() => void`                                           |
| reset     | 清空 data/error                                               | `() => void`                                           |

#### Point

```ts
type Point = { lng: number; lat: number }
```

#### GeocodeDetailResult

| 属性              | 描述                         | 类型                                    |
| ----------------- | ---------------------------- | --------------------------------------- |
| point             | 坐标点                       | `Point`                                 |
| address           | 地址描述                     | `string`                                |
| addressComponents | 结构化的地址描述             | [`AddressComponent`](#AddressComponent) |
| surroundingPois   | 附近的 POI 点（`title`+`point`） | `Array<{ title: string; point: Point }>` |
| business          | 商圈字段，代表此点所属的商圈 | `string`                                |

##### AddressComponent

| 属性         | 描述     | 类型     |
| ------------ | -------- | -------- |
| streetNumber | 门牌号码 | `string` |
| street       | 街道名称 | `string` |
| district     | 区县名称 | `string` |
| city         | 城市名称 | `string` |
| province     | 省份名称 | `string` |

## TS 类型定义参考

```ts
import { Ref } from 'vue'
import { Point } from 'baidu-map-gl-vue'
export interface GeocodeDetailResult {
  /**
   * 坐标点
   */
  point: Point
  /**
   * 地址描述
   */
  address: string
  /**
   * 结构化的地址描述
   */
  addressComponents: {
    city: string
    district: string
    province: string
    street: string
    streetNumber: string
  }
  /**
   * 附近的POI点
   */
  surroundingPois: Array<{ title: string; point: Point }>
  /**
   * 商圈字段，代表此点所属的商圈
   */
  business: string
}
/**
 * 由坐标点反查地址详情
 */
export declare function useBMapGeocodeDetail(map?: unknown): {
  data: Ref<GeocodeDetailResult | null>
  result: Ref<GeocodeDetailResult | null>
  error: Ref<unknown>
  isError: Ref<boolean>
  isEmpty: Ref<boolean>
  status: Ref<'idle' | 'loading' | 'success' | 'error'>
  isLoading: Ref<boolean>
  get: (point: Point) => Promise<GeocodeDetailResult | null>
  getBatch: (
    points: Point[]
  ) => Promise<Array<{ point: Point; detail: GeocodeDetailResult | null; error?: unknown }>>
  cancel: (reason?: unknown) => void
  reset: () => void
}
```
