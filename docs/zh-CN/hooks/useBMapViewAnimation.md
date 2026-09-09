# useBMapViewAnimation <Badge type="tip" text="^0.0.30" />

该 hooks 用于展示地图的 3D 动画，您可以自定义从地图上某一地点切换到另一地点的 3D 过渡动画效果。

```ts
import { useBMapViewAnimation } from 'baidu-map-gl-vue'
```

:::warning 注意

- 由于在渲染动画时，数据资源是随着当前方位和坐标的改变而实时加载的，刚开始播放动画时画面可能会卡顿，属于正常现象；此外，为了减少加载数据资源的性能损耗，在播放动画时隐藏了地图上的 POI 点。
- 其次，在定义关键帧时相邻两个关键帧的坐标点不宜距离太远，否则会导致当前帧的资源还未加载完毕，就已经进入下一帧的播放，出现视野中看不到地图的现象。

:::

## 示例

:::demo class="p-bottom"
hooks/useBMapViewAnimation
:::

## 用法

```ts
const { viewAnimation, setKeyFrames, start, cancel, stop, proceed, status, ready } = useBMapViewAnimation(options, map)
```

:::tip
该 hooks 需要地图 ready（`BMapClient` 就绪）后才能创建动画实例；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数    | 描述                   | 类型                                            | 默认值 |
| ------- | ---------------------- | ----------------------------------------------- | ------ |
| options | 地图视角动画的配置     | [`ViewAnimationOptions`](#viewanimationoptions) | -      |
| map     | `Map`地图组件`ref`引用 | `Ref<Map>`                                      | -      |

#### ViewAnimationOptions

| 属性            | 描述                                                             | 类型                   | 默认值 |
| --------------- | ---------------------------------------------------------------- | ---------------------- | ------ |
| duration        | 动画持续时常，单位 ms                                            | `number`               | `1000` |
| delay           | 动画开始延迟                                                     | `number`               | `0`    |
| loop            | 循环次数，参数类型为数字时循环固定次数，参数为'INFINITE'无限循环 | `number \| 'INFINITE'` | `1`    |
| disableDragging | 动画播放时禁止鼠标拖动                                           | `boolean`              | `true` |

### 返回值

| 返回值        | 描述                                                                     | 类型                                                                        |
| ------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| viewAnimation | 视角动画句柄（`Ref`，值为 `ServiceHandle`；raw 实例仅经 `./advanced` 获取） | `Ref<ServiceHandle<'service:view-animation'> \| null>`                      |
| setKeyFrames  | 设置动画关键帧函数，需要在`Map`组件`ready`事件触发后才可调用             | [`(path: ViewAnimationKeyFrames[]) => void`](#viewanimationkeyframes)       |
| start         | 开始动画函数，`setKeyFrames` 设置路径后且 `status` 为 `INITIAL` 才可调用 | `() => void`                                                                |
| stop          | 暂停动画函数                                                             | `() => void`                                                                |
| cancel        | 取消动画函数                                                             | `() => void`                                                                |
| proceed       | 继续播放动画函数                                                         | `() => void`                                                                |
| status        | 动画状态                                                                 | [`Ref<ViewAnimationStatus>`](#viewanimationstatus)                          |
| ready         | 地图 ready 后 resolve 的 `MapReadyContext`                               | `Promise<MapReadyContext>`                                                  |

#### ViewAnimationKeyFrames

```ts
type Point = { lng: number; lat: number }
interface ViewAnimationKeyFrames {
  /**
   * 	地图中心点
   */
  center: Point
  /**
   * 	地图缩放级别，默认值为地图当前状态缩放级别
   */
  zoom?: number
  /**
   * 	地图倾斜角度，默认值为地图当前状态倾斜角度
   */
  tilt?: number
  /**
   * 	地图旋转角度，默认值为地图当前旋转角度
   */
  heading?: number
  /**
   * 	表示当前关键帧处于动画过程的百分比，取值范围0~1
   */
  percentage: number
}
```

#### ViewAnimationStatus

```ts
// PLAYING 播放中
// STOPPING 暂停中
// INITIAL 默认状态
type ViewAnimationStatus = 'PLAYING' | 'STOPPING' | 'INITIAL'
```

### 事件监听

hooks 内部已把 `animationstart` / `animationend` / `animationcancel` 同步到 `status`，无需手动绑定。如需自定义监听，可在 `ready` 后通过 `client.driver.events` 绑定动画句柄：

```ts
const { ready } = useBMapViewAnimation()
const { client } = await ready
client.driver.events.on(viewAnimation.value!, 'animationiterations', () => {})
```

| 事件                | 参数 | 描述                                                                          |
| ------------------- | ---- | ----------------------------------------------------------------------------- |
| animationstart      | -    | 动画开始时触发，如果配置了 delay，则在 delay 后触发                           |
| animationiterations | -    | 当动画循环大于 1 次时，上一次结束既下一次开始时触发。最后一次循环结束时不触发 |
| animationend        | -    | 动画结束时触发，如果动画中途被终止，则不会触发                                |
| animationcancel     | -    | 动画中途被终止时触发                                                          |

## TS 类型定义参考

```ts
import { Ref } from 'vue'
type Point = { lng: number; lat: number }
export interface ViewAnimationKeyFrames {
  /**
   * 	地图中心点，默认值为地图当前状态中心点
   */
  center: Point
  /**
   * 	地图缩放级别，默认值为地图当前状态缩放级别
   */
  zoom?: number
  /**
   * 	地图倾斜角度，默认值为地图当前状态倾斜角度
   */
  tilt?: number
  /**
   * 	地图旋转角度，默认值为地图当前旋转角度
   */
  heading?: number
  /**
   * 	表示当前关键帧处于动画过程的百分比，取值范围0~1
   */
  percentage: number
}
export interface UseViewAnimationOptions {
  /**
   * 	动画开始延迟时间，单位ms，默认0
   */
  delay: number
  /**
   * 	动画持续时间，单位ms，默认1000
   */
  duration: number
  /**
   * 循环次数，参数类型为数字时循环固定次数，参数为'INFINITE'无限循环，默认为1
   */
  loop: number | 'INFINITE'
  /**
   * 动画播放时禁止鼠标拖动
   */
  disableDragging: boolean
}
export type ViewAnimationStatus = 'INITIAL' | 'PLAYING' | 'STOPPING'
export declare function useBMapViewAnimation(
  options?: UseViewAnimationOptions,
  map?: unknown
): {
  viewAnimation: Ref<unknown>
  start: () => void
  cancel: () => void
  stop: () => void
  proceed: () => void
  status: Ref<ViewAnimationStatus>
  setKeyFrames: (keyFrames: ViewAnimationKeyFrames[]) => void
  ready: Promise<MapReadyContext>
}
```
