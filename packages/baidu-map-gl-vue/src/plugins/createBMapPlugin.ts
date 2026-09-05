/**
 * M3: createBMapPlugin —— v3 安装 API
 *
 * 通过 app.use() 提供全局默认 Provider(AK/版本),BMap 组件从
 * app 级 config 读取默认 provider(而非直接访问 window,符合依赖规则)。
 * 同时兼容旧 `app.use(Vue3BaiduMapGl, { ak, plugins })`。
 */
import type { App } from "vue";
import { baiduCdnProvider, type BMapProvider } from "../core/loader/Provider";
import type { BMapLoadOptions } from "../core/loader/url";
import { bmapConfigKey, type BMapPluginConfig } from "../core/context/pluginConfig";
import BMap from "../components/map/BMap.vue";
import BMarker from "../components/overlays/BMarker.vue";
import BInfoWindow from "../components/overlays/BInfoWindow.vue";
import BCircle from "../components/overlays/BCircle.vue";
import BPolyline from "../components/overlays/BPolyline.vue";
import BPolygon from "../components/overlays/BPolygon.vue";
import BLabel from "../components/overlays/BLabel.vue";
import BContextMenu from "../components/overlays/BContextMenu.vue";
import BPrism from "../components/overlays/BPrism.vue";
import BGroundOverlay from "../components/overlays/BGroundOverlay.vue";
import BBezierCurve from "../components/overlays/BBezierCurve.vue";
import BMapMask from "../components/overlays/BMapMask.vue";
import BMarker3d from "../components/overlays/BMarker3d.vue";
import BAutoComplete from "../components/autocomplete/BAutoComplete.vue";
import BPanoramaControl from "../components/controls/BPanoramaControl.vue";
import BControl from "../components/controls/BControl.vue";
import BPointLayer from "../components/data/BPointLayer.vue";
import BMarkerCluster from "../components/data/BMarkerCluster.vue";
import BZoom from "../components/controls/BZoom.vue";
import BScale from "../components/controls/BScale.vue";
import BCityList from "../components/controls/BCityList.vue";
import BLocation from "../components/controls/BLocation.vue";
import BNavigation3d from "../components/controls/BNavigation3d.vue";
import BCopyright from "../components/controls/BCopyright.vue";
import BDistrictLayer from "../components/layers/BDistrictLayer.vue";
import BPanoramaCoverageLayer from "../components/layers/BPanoramaCoverageLayer.vue";

export interface CreateBMapPluginOptions {
  provider?: BMapProvider;
  ak?: string;
  apiUrl?: string;
  version?: string;
  plugins?: string[];
  defaults?: Partial<BMapLoadOptions>;
}

export { bmapConfigKey } from "../core/context/pluginConfig";
export type { BMapPluginConfig } from "../core/context/pluginConfig";

export function createBMapPlugin(options: CreateBMapPluginOptions = {}) {
  const provider = options.provider ?? baiduCdnProvider();
  const defaults: BMapLoadOptions = {
    ak: options.ak,
    apiUrl: options.apiUrl,
    version: options.version ?? "1.0",
    ...options.defaults,
  };
  const config: BMapPluginConfig = { provider, defaults };

  return {
    install(app: App) {
      app.provide(bmapConfigKey, config);
      // 注册全局组件(与 v2 app.use 行为保持兼容)
      for (const component of installableComponents) {
        if (!component) continue;
        const name = component.name ?? (component as any).__name;
        if (name) app.component(name, component);
      }
      // 兼容旧 globalProperties 映射,便于迁移期 v2 组件读取
      const appProp = app.config.globalProperties as Record<string, unknown>;
      if (options.ak) appProp.$baiduMapAk = options.ak;
      if (options.apiUrl) appProp.$baiduMapApiUrl = options.apiUrl;
    },
    version: "3.0.0",
    /** 供按需导入使用 */
    config,
  };
}

/** v3 组件清单:用于 app.use 全局注册 */
const installableComponents = [
  BMap,
  BMarker,
  BInfoWindow,
  BCircle,
  BPolyline,
  BPolygon,
  BLabel,
  BContextMenu,
  BPrism,
  BGroundOverlay,
  BBezierCurve,
  BMapMask,
  BMarker3d,
  BAutoComplete,
  BPanoramaControl,
  BControl,
  BPointLayer,
  BMarkerCluster,
  BZoom,
  BScale,
  BCityList,
  BLocation,
  BNavigation3d,
  BCopyright,
  BDistrictLayer,
  BPanoramaCoverageLayer,
];
