# bmap-draw 鼠标测量与绘制

BMap Draw 是一个基于百度地图 JSAPI 的轻量级鼠标绘制库，提供了鼠标绘制、编辑、裁切、合并、复制黏贴、移动、测量等多种几何图形操作能力，助力开发者开箱即用式快速实现自己的几何图形编辑器。

> 使用方式请参考官方文档：https://lbsyun.baidu.com/bmap-draw/

:::warning 注意
该组件库中 SDK 是**异步加载**，而 `bmap-draw` 会在模块初始化时同步引用全局构造函数，所以只能
使用动态 `import()`：

```ts
import('bmap-draw').then(({ DrawScene }) => {
  // ...
})
```

另外，`bmap-draw` 依赖 GL 时代的绘制实现，**未在 JSAPI 4.0 上验证**（结论记 `未验证`，后续动作见
[#43](https://github.com/MangMax/baidu-map-gl-vue/issues/43)）。示例里的
`client.rawSdk` 是 `./advanced` 逃生口，普通业务请优先使用 `driver`。
:::

## 绘制

:::demo 绘制点、线、面、多边形、圆形等
expand/bmap-draw/draw
:::

## 测量

测量距离，面积，折线长度等

:::demo
expand/bmap-draw/meterage
:::

<style>
  .dark .BMapLabel{
    color: #333333;
  }
</style>
