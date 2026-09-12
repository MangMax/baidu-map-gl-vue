# 离线地图

离线地图需要自建百度地图 api，并将自建的 api 地址通过 [`apiUrl`](../guide/config) 配置传给组件库。

除此之外，还有一个很重要的处理，需要全局初始化一个回调函数，用于通知地图初始化。

自 4.0 起，全局命名空间是 **`BMap`**（在线入口自己也会把 `BMapGL` 作为**同一对象的别名**挂上，
自建入口照做即可，否则 SDK 内部引用 `BMapGL` 的代码会找不到对象）：

```js
window.BMap.apiLoad = function () {
  delete window.BMap.apiLoad
  if (typeof window._initBMap_ == 'function') {
    window._initBMap_()
  }
}
```

下面是一个离线地图 api 加载入口文件示例，是根据原版在线 api（`v=4.0`）的改动的：在线入口的
引导脚本做的正是「建 `BMap`/`BMapGL` 别名 → 定义 `apiLoad` → 插入真正的 SDK 脚本」这几步，
其中真正的 SDK 脚本就是地图 api，这个资源地址需要自建。

```js
// getApiScripts.js
;(function () {
  var offmapcfg = (window.offmapcfg = {})
  var JS__FILE__ = document.currentScript
    ? document.currentScript.src
    : document.scripts[document.scripts.length - 1].src
  offmapcfg.home = JS__FILE__.substr(0, JS__FILE__.lastIndexOf('/') + 1) //地图API主目录

  window.BMap_loadScriptTime = new Date().getTime()
  window.BMap = window.BMapGL = window.BMap || window.BMapGL || {}
  window.BMap.apiLoad = function () {
    delete window.BMap.apiLoad
    if (typeof window._initBMap_ == 'function') {
      window._initBMap_()
    }
  }

  var s = document.createElement('script')
  var link = document.createElement('link')

  s.src = offmapcfg.home + '/bmap.min.js'
  link.setAttribute('rel', 'stylesheet')
  link.setAttribute('type', 'text/css')
  link.setAttribute('href', offmapcfg.home + '/css/bmap.css')
  document.body.appendChild(s)
  document.getElementsByTagName('head')[0].appendChild(link)
})()
```

```vue
<script setup lang="ts">
  import { BMap, BMarker } from 'baidu-map-gl-vue'
</script>

<template>
  <BMap
    :center="{ lng: 106.53637853629937, lat: 29.464275891815767 }"
    enableScrollWheelZoom
    apiUrl="自建地址/getApiScripts.js"
  >
    <BMarker :position="{ lng: 121.56847909, lat: 29.8100979777 }"></BMarker>
  </BMap>
</template>
```

::: tip v3 推荐写法
`apiUrl` prop 仍可用；更明确的方式是用 `customScriptV4Provider(scriptSrc, { mode })` 构造
Provider（`mode` 缺省 `load`，入口支持 `callback` 时传 `jsonp`），经 `createBMapPlugin({ provider })` 或
Client 定义传入，见[配置](../guide/config#更换插件资源链接)。
:::
