# MapVGL 可视化

MapVGL，是一款基于 WebGL 的地理信息可视化库，可以用来展示大量基于 3D 的地理信息点线面数据。设计初衷主要是为了解决大数据量的三维地理数据展示问题及一些炫酷的三维效果。

本章节演示通过插件形式加载 MapVGL 资源，并展示几个官方图层示例。

## 结合方式：

使用 MapVGL 只需要注册 `Mapvgl` 插件：

### 1。通过组件库提供的插件形式 (内部以 cdn 方式加载)

全局配置插件：

```ts
// ...
app.use(baiduMap, {
  plugins: ['Mapvgl']
})
```

或者通过组件配置插件：

```vue
<template>
  <BMap :plugins="['Mapvgl']"></BMap>
</template>
```

因为资源是通过异步方式加载，所以需要监听 pluginReady 事件：

```vue
<template>
  <BMap :plugins="['Mapvgl']" @pluginReady="handlePluginReady"></BMap>
</template>
<script lang="ts" setup>
  function handlePluginReady() {
    // ...
  }
</script>
```

:::warning 注意
MapVGL 使用 UMD 格式打包，通过插件形式加载可以避免手动管理脚本资源。
:::

## 示例

> 以下示例均来自 MapVGL 官方文档：https://mapv.baidu.com/gl/docs/index.html

### PointLayer 基础点层图

> https://mapv.baidu.com/gl/docs/PointLayer.html

:::demo
expand/mapvgl/pointLayer
:::

### HeatGridLayer 柱状热力图

> https://mapv.baidu.com/gl/docs/HeatGridLayer.html

:::demo
expand/mapvgl/heatGridLayer
:::

### LineLayer 动画线图层

> https://mapv.baidu.com/gl/docs/LineLayer.html

:::demo MapVGL 动画线图层
expand/mapvgl/lineLayer
:::
