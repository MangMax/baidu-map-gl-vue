/**
 * v3 公开入口(packages/baidu-map-gl-vue)
 *
 * 仅导出稳定公共 API。core 内部件按方案 §3.3 不直接暴露所有实现。
 */
// 组件
export * from "./components/index";
// 业务层 composables
export * from "./composables/index";
// 插件/安装
export { createBMapPlugin, bmapConfigKey } from "./plugins/createBMapPlugin";
export type { BMapPluginConfig, CreateBMapPluginOptions } from "./plugins/createBMapPlugin";
// 内置插件 definitions(§9)
export {
  trackAnimationPlugin,
  mapVglPlugin,
  drawingManagerPlugin,
  stringToPluginDefinitions,
  urlPluginDefinition,
  BUILTIN_PLUGIN_URLS,
} from "./plugins/builtins";
// Provider(公开 factory)
export {
  baiduCdnProvider,
  customScriptProvider,
  existingGlobalProvider,
} from "./core/loader/Provider";
export type { BMapProvider } from "./core/loader/Provider";
// Resolver
export { Vue3BaiduMapGlResolver, componentTypeNames } from "./resolver/index";
// 公开类型(与组件 props 对齐,单一来源 src/types/components.ts)
export type {
  BMapProps,
  BMarkerProps,
  BInfoWindowProps,
  BCircleProps,
  BPolylineProps,
} from "./types/components";
// core 领域类型(供业务使用)
export type { MapContext, MapReadyContext, MapRuntimeStatus } from "./core/context/types";
export { useBMapContext, useMapReady, useBMap } from "./composables/useBMap";

// 组件公开类型(与 SFC 内 export 对齐,供类型使用)
export type { ContextMenuItem, ContextMenuSeparator } from "./components/overlays/BContextMenu.vue";
export type { MarkerIcon, MarkerIconName, MarkerCustomIcon } from "./types/components";

// 运行时枚举(供模板/脚本使用)
export { DistrictType } from "./types/components";
export type { DistrictTypeValue } from "./types/components";

export type { PointLike, SizeLike, XYLike } from "./core/utils/geometry";
export type { MapMaskShowRegion } from "./types/components";
