# BAutoComplete 自动填充 <Badge type="tip" text="^2.1.3" />

地址检索关键词提示

```ts
import { BAutoComplete } from 'baidu-map-gl-vue'
```

:::tip
目前这个组件所使用的百度地图 api 还不稳定 (在写这个组件时候深有体会)
:::

## 组件示例

:::demo
autoComplete/index
:::

## 动态组件 Props

| 属性     | 说明                                 | 类型                            | 可选值 | 默认值       |
| -------- | ------------------------------------ | ------------------------------- | ------ | ------------ |
| location | 设定返回结果的所属范围。例如“北京市” | `string \| Point \| BMapGL.Map` | -      | `BMapGL.Map` |
| types    | 返回数据类型                         | `string[]`                      | -      |

## 组件事件

v3 子组件没有 `initd/unload` 事件。如需地图实例，请在 `<BMap>` 子树内用 `useBMap()` + `whenReady()`。

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| searchComplete | 输入字符发起列表检索完成后触发 | `(e: unknown) => void` |
| highlight | 键盘或鼠标移动使某条记录高亮后触发 | `(e: unknown) => void` |
| confirm | 鼠标点击或回车选中某条记录后触发 | `(e: unknown) => void` |

