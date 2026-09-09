# BContextMenu 上下文菜单 <Badge type="tip" text="^0.0.29" />

在地图上添加自定义内容的右键菜单

```ts
import { BContextMenu } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 添加地图和 `Marker` 上下文菜单，鼠标右击地图或 `Marker` 试试
context-menu/index
:::

## 静态组件 Props

| 属性  | 说明              | 类型     | 默认值 |
| ----- | ----------------- | -------- | ------ |
| width | 菜单宽度(单位 px) | `number` | `100`  |

## 动态组件 Props

| 属性      | 说明                  | 类型                                                | 可选值 | 默认值 | 版本                               |
| --------- | --------------------- | --------------------------------------------------- | ------ | ------ | ---------------------------------- |
| menuItems | 菜单项，`-`添加分割线 | ([`ContextMenuItem`](#contextmenuitem) \| `-`) `[]` | -      | -      | -                                  |
| visible   | 是否显示              | `boolean`                                           | -      | `true` | <Badge type="tip" text="^2.2.0" /> |

## ContextMenuItem

| 属性     | 说明                     | 类型                                            | 可选值  | 默认值     |
| -------- | ------------------------ | ----------------------------------------------- | ------- | ---------- |
| text     | 菜单项文字               | `string`                                        | -       | `required` |
| callback | 菜单项点击触发的回调函数 | `({point, pixel, map, target}) => void`（`map` 为 `MapHandle`） | -       | `required` |
| disabled | 是否禁用该菜单项         | `boolean`                                       | `false` | -          |

## 组件事件

v3 子组件没有 `initd/unload` 事件。如需地图实例，请在 `<BMap>` 子树内用 `useBMap()` + `whenReady()`。

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| open | 右键菜单真正展开时触发（对应 SDK open 事件，不对应挂载/卸载） | `() => void` |
| close | 右键菜单关闭时触发（对应 SDK close 事件） | `() => void` |

## v3 target 切换

`BContextMenu` 会把菜单挂载到最近的父覆盖物；没有父覆盖物时挂载到地图。target 发生变化时，组件会先从旧 target 移除，再挂载到新 target，不会同时残留在两个对象上。

- `visible=false` 时菜单从当前 target 移除，恢复为 `true` 后重新挂载。
- `menuItems` 变化时会重建菜单并重新挂载。
- `open` / `close` 只表示 SDK 菜单真正打开或关闭，不表示菜单的挂载和移除。
- 组件卸载时会从当前 target 移除菜单。
