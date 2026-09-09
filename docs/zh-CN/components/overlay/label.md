# BLabel 文本标注

在地图上显示文本标注

```ts
import { BLabel } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 在地图上添加动态更新的，试试改变文本输入框内容 class="p-top"
overlay/label
:::

## 动态组件 Props

| 属性            | 说明                                      | 类型                                                                                          | 默认值     | 版本                               |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| content         | 设置文本标注的内容                        | `string `                                                                                     | `required` | -                                  |
| offset          | 文本标注的像素偏移                        | `{x: number, y: number } `                                                                    | -          | -                                  |
| enableMassClear | 是否在调用 map.clearOverlays 清除此覆盖物 | `boolean `                                                                                    | `true `    | -                                  |
| style           | 设置文本标注的样式                        | [`CSSStyleDeclaration`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleDeclaration) | -          | -                                  |
| position        | 文本标注的坐标                            | `{ lng: number, lat: number} `                                                                | `required` | -                                  |
| zIndex          | 显示层级                                  | `number`                                                                                      | -          | <Badge type="tip" text="^2.2.0" /> |
| visible         | 是否显示                                  | `boolean`                                                                                     | `true`     | <Badge type="tip" text="^2.2.0" /> |

::: tip 提示
style 可以是任何符合规范的 css 样式，样式属性需使用驼峰命名法
:::

## 组件事件

v3 子组件没有 `initd/unload` 事件；以下为实际发出的 typed emits（载荷为 SDK 原生事件）：

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 鼠标左键单击事件的回调函数 | `(e: unknown) => void` |
| dblclick | 鼠标左键双击事件的回调函数 | `(e: unknown) => void` |

