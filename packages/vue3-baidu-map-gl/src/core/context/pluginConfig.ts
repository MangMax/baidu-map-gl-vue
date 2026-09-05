/**
 * app 级 provider 配置注入 key 与类型(与 createBMapPlugin 解耦,避免循环依赖)
 */
import type { InjectionKey } from "vue";
import type { BMapProvider } from "../loader/Provider";
import type { BMapLoadOptions } from "../loader/url";

export interface BMapPluginConfig {
  provider: BMapProvider;
  defaults: BMapLoadOptions;
}

/** app 级 provider 配置注入 key */
export const bmapConfigKey: InjectionKey<BMapPluginConfig> = Symbol("vue3-baidu-map-gl:config");
