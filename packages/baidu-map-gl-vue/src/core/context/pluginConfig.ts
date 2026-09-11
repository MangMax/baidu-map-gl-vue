/**
 * app 级 provider 配置注入 key 与类型(与 createBMapPlugin 解耦,避免循环依赖)
 *
 * `provider` 是**跨引擎**的 `AnyBMapProviderLike`（M3A1-CLIENT / #18）：JSAPI 4.0 的
 * Provider 家族返回 `LoadedJsapiV4`，与迁移期 legacy Provider 的 `LoadedLegacySdk`
 * 不兼容，因此这里不能用 legacy 专用的 `BMapProvider` 类型，否则
 * `createBMapPlugin({ provider: baiduJsapiV4Provider() })` 会在类型层被拒。
 */
import type { InjectionKey } from "vue";
import type { AnyBMapProviderLike } from "../../client/types";
import type { BMapLoadOptions } from "../loader/url";

export interface BMapPluginConfig {
  provider: AnyBMapProviderLike;
  defaults: BMapLoadOptions;
}

/** app 级 provider 配置注入 key */
export const bmapConfigKey: InjectionKey<BMapPluginConfig> = Symbol("baidu-map-gl-vue:config");
