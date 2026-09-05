# v2 → v3 迁移指南

> 面向从 `baidu-map-gl-vue@2.x` 升级到 `3.0.0` 的使用者。
> 目标版本 `3.0.0-beta`(next) → `3.0.0`(stable)。

v3 的核心变化是**运行时架构**,不是组件 API 的推倒重来。绝大多数 v2 组件用法保持不变;
变化集中在「如何加载 SDK」「如何表达父子依赖」「如何承载大数据」。

---

## 1. 快速开始

### v2
```ts
import Vue3BaiduMapGl from 'baidu-map-gl-vue'
app.use(Vue3BaiduMapGl, { ak: 'YOUR_AK' })
```

### v3
```ts
import { createBMapPlugin, baiduCdnProvider } from 'baidu-map-gl-vue'
app.use(createBMapPlugin({
  provider: baiduCdnProvider({
    ak: import.meta.env.VITE_BAIDU_MAP_AK,
    version: '1.0',
  }),
}))
```

> 兼容:`app.use(Vue3BaiduMapGl, { ak })` 在 v3 仍可用(内部映射到 `createBMapPlugin`),
> 但推荐迁移到新 API。

---

## 2. v2 → v3 API 对照

| v2 API | v3 处理 | 迁移动作 |
|---|---|---|
| `app.use(Vue3BaiduMapGl, { ak })` | 保留,映射到 `createBMapPlugin` | 可选迁移 |
| 按需导入组件(`BMap` 等) | 保留组件名与根 named exports | 无需改动 |
| `@initd` | 保留并 **deprecate**,新增 `@ready` | 建议改为 `@ready` |
| `getMapInstance()` | 保留,新增 `whenReady()` | 可选迁移 |
| `apiUrl`(离线) | 保留为 CustomScriptProvider 兼容参数 | 推荐 Provider |
| `plugins: string[]` | 保留适配,推荐 plugin definitions | 可选迁移 |
| `v-model:show`(InfoWindow) | 保留 | 无需改动 |
| `modelValue`(InfoWindow) | beta 期保留 + warning | 改为 `open`/`v-model:open` |
| `usePubSub` | 从主入口移除;短期放入 `legacy` | 改用 context/whenReady |
| `getScriptAsync` | legacy 保留,推荐 Provider/loader | 可选迁移 |
| 任意 `package/*` 深路径 | 不再保证;提供明确 exports | 改用子路径 |

---

## 3. 组件迁移

### 3.1 BMap

```vue
<!-- v2 -->
<BMap ak="xxx" :center="center" :zoom="14" @initd="onInit">
  ...
</BMap>

<!-- v3(等价,initd→ready) -->
<BMap :provider="provider" :center="center" :zoom="14" @ready="onReady">
  ...
</BMap>
```

- `ready` 事件带 `{ map, api }`(api 为 SDK namespace)。
- `initd` 仍发出,内容与 `ready` 相同,标记 deprecated。

### 3.2 BMarker

```vue
<!-- v2 与 v3 用法一致 -->
<BMarker :position="{ lng: 116.4, lat: 39.9 }" @click="onClick" />
```

v3 修复:
- position 变为**字段级更新**(lng/lat 分开,不再 deep watch)。
- `visible` 切换幂等。
- 0 坐标有效(不再用 truthy 判断)。

> 大量点请勿堆叠独立 BMarker,改用 `BMarkerCluster` / `BPointLayer`(见 §5)。

### 3.3 BInfoWindow

```vue
<!-- 推荐 -->
<BInfoWindow v-model:open="open" :position="pos" title="北京">
  内容
</BInfoWindow>
```

v3 修复:
- 开放状态用明确状态机,prop 与 SDK 事件不再相互拉扯。
- `modelValue` 保留一个 beta 周期并给出 warning。
- 不再使用广域 MutationObserver(改用受控 ResizeObserver)。

---

## 4. 大数据(千级点)

v3 引入三档渲染模型(方案 §12.1):

| 场景 | 组件 | 说明 |
|---|---|---|
| 少量、逐点交互 | `BMarker` | 一 V 一组件 |
| 中等规模、需聚合 | `BMarkerCluster` | 数据组件 + 内置网格聚合 |
| 千级以上 | `BPointLayer` | 一个组件管理整批点 |

```vue
<BMarkerCluster :data="stations" item-key="id"
  :get-position="s => ({ lng: s.lng, lat: s.lat })"
  :min-cluster-size="3" />
```

> 这解决 v2 issue #131「上千 Marker 卡顿」。

---

## 5. 弃用(deprecation)

每条弃用都有稳定 code,文档列出替代 API,同实例只警告一次,production 默认不输出。

示例(控制台):
```
[baidu-map-gl-vue] `initd` is deprecated; use `ready`.
```

---

## 6. 在线迁移清单(简版)

1. 升级依赖到 `3.0.0-beta.x`。
2. 将 `app.use(...)` 换为 `createBMapPlugin(...)`(或保留旧调用)。
3. 替换 `@initd` → `@ready`(可选)。
4. 检查 BMarker:大列表迁移到 `BMarkerCluster` / `BPointLayer`。
5. 检查 BInfoWindow:用 `v-model:open` 替代 `modelValue`。
6. 移除对 `package/*` 深路径的依赖,改用子路径(`/components`、`/composables`、`/plugins`)。

---

## 7. 常见问题

**Q: SDK 加载失败后如何重试?**
v3 的 SdkRegistry 会在失败后移除缓存,允许下次重试。

**Q: 多个 BMap 会互相干扰吗?**
不会。每个 BMap 创建独立 MapRuntime,含独立 event bus / overlay registry。

**Q: 千级点卡顿还有吗?**
改用 `BPointLayer` 后,一个组件管理整批点,不再逐点建 Vue 实例。
