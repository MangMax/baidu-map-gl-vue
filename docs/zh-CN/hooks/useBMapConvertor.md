# useBMapConvertor 坐标点转换

用于将其他坐标系的坐标转换为百度坐标。

```ts
import { useBMapConvertor } from 'baidu-map-gl-vue'
```

## 示例

:::demo 将谷歌坐标转换为百度坐标
hooks/useBMapConvertor
:::

## 用法

```ts
const { result, convert, isLoading, isError, status } = useBMapConvertor(map)
```

:::tip
该 hooks 需要地图 ready 后才能执行转换；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数 | 描述                                         | 类型      | 默认值 |
| ---- | -------------------------------------------- | --------- | ------ |
| map  | `Map`地图组件实例或 `ref`（可省略，用注入值） | `unknown` | -      |

### 返回值

| 返回值    | 描述                                                     | 类型                                                                                                                                                |
| --------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| data      | 目标坐标点数组（`result` 为其别名）                      | `Ref<{ lng: number; lat: number }[] \| null>`                                                                                                       |
| result    | 目标坐标点数组                                           | `Ref<{ lng: number; lat: number }[] \| null>`                                                                                                       |
| error     | 错误信息                                                 | `Ref<unknown>`                                                                                                                                      |
| isError   | 是否出错                                                 | `boolean`                                                                                                                                           |
| isEmpty   | 结果是否为空                                             | `boolean`                                                                                                                                           |
| isLoading | 是否加载中                                               | `boolean`                                                                                                                                           |
| status    | 当前状态                                                 | `Ref<'idle' \| 'loading' \| 'success' \| 'error'>`                                                                                                  |
| convert   | 点坐标转换方法，需要在`Map`组件`ready`后才可调用         | `(points: Point[], `[`from: CoordinatesFromType`](#coordinatesfromtype)`, `[`to: CoordinatesToType`](#coordinatestotype)`) => Promise<Point[]>`      |
| get       | `convert` 别名                                           | 同上                                                                                                                                                |
| cancel    | 取消 pending 请求                                        | `() => void`                                                                                                                                        |
| reset     | 清空 data/error                                          | `() => void`                                                                                                                                        |

### CoordinatesFromType

原坐标类型

```ts
export enum CoordinatesFromType {
  /**
   *  WGS84坐标（GPS标准坐标）
   */
  'COORDINATES_WGS84' = 1,
  /**
   *  WGS84的平面墨卡托坐标（搜狗地图坐标）
   */
  'COORDINATES_WGS84_MC' = 2,
  /**
   * GCJ02坐标(火星坐标)，即高德地图、腾讯地图、谷歌坐标和MapABC等地图使用的坐标；
   */
  'COORDINATES_GCJ02' = 3,
  /**
   *  GCJ02的平面墨卡托坐标（火星坐标对应的墨卡托平面坐标）
   */
  'COORDINATES_GCJ02_MC' = 4,
  /**
   *  百度地图采用的经纬度坐标（bd09ll）
   */
  'COORDINATES_BD09' = 5,
  /**
   * 百度地图采用的墨卡托平面坐标（bd09mc）
   */
  'COORDINATES_BD09_MC' = 6,
  /**
   * 图吧地图坐标
   */
  'COORDINATES_MAPBAR' = 7,
  /**
   * 51地图坐标
   */
  'COORDINATES_51' = 8
}
```

### CoordinatesToType

目标坐标类型

```ts
export enum CoordinatesToType {
  /**
   * GCJ02坐标(火星坐标)，即高德地图、腾讯地图、谷歌坐标和MapABC等地图使用的坐标；
   */
  'COORDINATES_GCJ02' = 3,
  /**
   * 百度地图采用的经纬度坐标（bd09ll）
   */
  'COORDINATES_BD09' = 5,
  /**
   * 百度地图采用的墨卡托平面坐标（bd09mc）
   */
  'COORDINATES_BD09_MC' = 6
}
```

### UsePointConvertorStatus

:::warning 警告
当转换不被允许的坐标系，如：X→GPS，可能不会响应返回以下错误 code，会拒绝响应，浏览器直接报跨域请求
:::

| code | 描述                                                                       |
| ---- | -------------------------------------------------------------------------- |
| 0    | ok 正常 服务请求正常召回                                                   |
| 1    | 内部错误                                                                   |
| 4    | 转换失败 X→GPS 时必现，根据法律规定，不支持将任何类型的坐标转换为 GPS 坐标 |
| 21   | from 非法                                                                  |
| 22   | to 非法                                                                    |
| 24   | coords 格式非法                                                            |
| 25   | coords 个数非法，超过限制                                                  |
| 26   | 参数错误                                                                   |

## 代码示例

<!-- prettier-ignore -->
```html
<BMap @ready="handleReady"></BMap>

<script setup lang="ts">
  import { useBMapConvertor, CoordinatesFromType, CoordinatesToType } from 'baidu-map-gl-vue'

  const { convert, result } = useBMapConvertor()

  async function handleReady() {
    await convert(
      [{ lng: 116.297611, lat: 40.047363 }],
      CoordinatesFromType.COORDINATES_GCJ02,
      CoordinatesToType.COORDINATES_BD09
    )
    console.log(result.value)
  }
</script>
```

## TS 类型定义参考

```ts
import { Ref } from 'vue'
/**
 * 地图经纬度点
 */
export declare type GeoPoint = {
  lng: number
  lat: number
}
/**
 * 坐标转换
 */
export declare function useBMapConvertor(map?: unknown): {
  data: Ref<GeoPoint[] | null>
  result: Ref<GeoPoint[] | null>
  error: Ref<unknown>
  isError: Ref<boolean>
  isEmpty: Ref<boolean>
  status: Ref<'idle' | 'loading' | 'success' | 'error'>
  isLoading: Ref<boolean>
  convert: (
    points: GeoPoint[],
    from: CoordinatesFromType,
    to: CoordinatesToType
  ) => Promise<GeoPoint[] | null>
  get: (
    points: GeoPoint[],
    from: CoordinatesFromType,
    to: CoordinatesToType
  ) => Promise<GeoPoint[] | null>
  cancel: (reason?: unknown) => void
  reset: () => void
}
```
