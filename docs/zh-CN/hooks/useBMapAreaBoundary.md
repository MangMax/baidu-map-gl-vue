# useBMapAreaBoundary

通过该 hooks 可获取行政区域的边界。

```ts
import { useBMapAreaBoundary } from 'baidu-map-gl-vue'
```

## 示例

:::demo 结合 [`BPolygon`](../components/overlay/polygon) 组件获取行政区域边界
overlay/polygon/boundaries
:::

## 用法

```ts
const { isLoading, boundaries, get } = useBMapAreaBoundary(map)
```

:::tip
该 hooks 需要地图 ready 后才能执行查询；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数 | 描述                         | 类型                             | 默认值 |
| ---- | ---------------------------- | -------------------------------- | ------ |
| map  | 地图组件 ref，用于等待地图 SDK 初始化（可省略，用注入值） | `unknown` | - |

### 返回值

| 返回值     | 描述                                              | 类型                              |
| ---------- | ------------------------------------------------- | --------------------------------- |
| isLoading  | 是否加载中                                        | `Ref<boolean>`                    |
| boundaries | 区域边界数据，默认为空数组，`get`方法调用后才可用 | `Ref<string[]>`                   |
| get        | 获取指定区域边界方法                              | `(area: string) => Promise<void>` |

## 代码示例

<!-- prettier-ignore -->
```html
<BMap ref="map" @ready="handleInitd"></BMap>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useBMapAreaBoundary } from 'baidu-map-gl-vue'

  const map = ref()
  const { isLoading, boundaries, get } = useBMapAreaBoundary(map)

  function handleInitd() {
    get('北京市')
  }
</script>
```

## TS 类型定义参考

```ts
import { Ref } from 'vue'
export declare type AreaBoundary = string[]
/**
 * 获取地图区域边界
 * @param map 地图组件 ref
 * @returns { isLoading, boundaries, get }
 */
export declare function useBMapAreaBoundary(map?: unknown): {
  /**
   * 是否加载中
   */
  isLoading: Ref<boolean>
  /**
   * 区域边界数据
   */
  boundaries: Ref<string[]>
  /**
   * 获取指定区域边界
   * @param {string} area 区域名
   * @example get('北京市')
   */
  get: (area: string) => void
}
```
