/**
 * M3: createBMapPlugin —— v3 安装 API
 *
 * 通过 app.use() 提供全局默认 Client definition(AK/版本/Provider),BMap 组件从
 * app 级 config 与 definition 读取默认 provider(而非直接访问 window,符合依赖规则)。
 *
 * M3A1-CLIENT（issue #18）的调整：
 * - **组件注册改由 Manifest 生成的 `components/index.ts` 驱动**（单一事实源），不再维护
 *   一份手写数组——两处清单漂移会导致 `app.use` 少注册组件；
 * - 默认版本改用 `DEFAULT_VERSION`（JSAPI 4.0 基线），不再硬编码 `1.0`；插件自身报告的
 *   库版本改用 `LIBRARY_VERSION`，与 `package.json` 单一事实源对齐；
 * - 默认 Client definition 经迁移期归一（`withMigrationDriver`）：按**加载结果的
 *   engine** 分派 Driver，因此 `provider: baiduJsapiV4Provider()` 不会被破坏；
 * - 旧 `globalProperties` 映射保留，但只作为迁移期兼容并给出明确的 beta 警告。
 *
 * M3A3-CUTOVER（issue #25）的调整：**默认 Provider 换成 JSAPI 4.0 CDN 家族**
 * （`baiduJsapiV4Provider()`），因此「不传 provider 的默认入口」现在加载
 * `https://api.map.baidu.com/api?v=4.0&ak=...` 并读取 `globalThis.BMap`。
 * `allowExistingGlobal` 也随之指向 `existingGlobalV4Provider()`（不再探测迁移期 `BMapGL`）。
 * 注意「默认」指的是**未显式传 provider**这条路径；显式传入的 Provider 仍按加载结果的
 * engine 分派（legacy 能力与 Fake 双跑随 #26 一并删除）。
 */
import type { App, Component } from "vue";
import { DEFAULT_VERSION, type BMapLoadOptions } from "../core/loader/url";
import { logger } from "../core/logger";
import { bmapConfigKey, type BMapPluginConfig } from "../core/context/pluginConfig";
import { defaultClientDefinitionKey } from "../core/context/client";
import { baiduJsapiV4Provider, existingGlobalV4Provider } from "../core/loader/providers";
import { withMigrationDriver } from "../client/migration";
import type { AnyBMapProviderLike, CreateBMapClientOptions } from "../client/types";
import { LIBRARY_VERSION } from "../version";
import * as manifestComponents from "../components/index";

export interface CreateBMapPluginOptions {
  /**
   * 默认 SDK Provider。缺省是 JSAPI 4.0 的 CDN Provider（`baiduJsapiV4Provider()`）。
   *
   * 类型是**跨引擎**的 `AnyBMapProviderLike`：默认的 v4 家族
   * （`baiduJsapiV4Provider()` / `existingGlobalV4Provider()` / `customScriptV4Provider()`）
   * 返回 `LoadedJsapiV4`；迁移期 legacy Provider 返回 `LoadedLegacySdk`，两者都合法
   * （具体用哪个 Driver 由 `withMigrationDriver` 按加载结果的 engine 分派，随 #26 收敛）。
   */
  provider?: AnyBMapProviderLike;
  ak?: string;
  apiUrl?: string;
  version?: string;
  plugins?: string[];
  defaults?: Partial<BMapLoadOptions>;
  /**
   * 显式 opt-in 才允许复用页面里**已经存在**的 JSAPI 4.0 全局（`globalThis.BMap`）。
   * 只在未显式传 `provider` 时生效；缺省仍走 CDN。
   */
  allowExistingGlobal?: boolean;
  client?: CreateBMapClientOptions;
}

export { bmapConfigKey } from "../core/context/pluginConfig";
export type { BMapPluginConfig } from "../core/context/pluginConfig";
export { defaultClientDefinitionKey } from "../core/context/client";

export function createBMapPlugin(options: CreateBMapPluginOptions = {}) {
  const provider = options.provider ?? defaultV4Provider(options.allowExistingGlobal);
  const defaults: BMapLoadOptions = {
    ak: options.ak,
    apiUrl: options.apiUrl,
    version: options.version ?? DEFAULT_VERSION,
    ...options.defaults,
  };
  const config: BMapPluginConfig = { provider, defaults };
  // 显式 `client` 也要归一（否则「只有默认 definition 被包装、显式 client 没被包装」会让
  // 同一份配置在 <BMap> 与 <BMapProvider> 上表现不一致）。
  // `withMigrationDriver` 幂等：已声明 driver 时保留，宽松 Provider 归一为结构化结果。
  const clientDefinition: CreateBMapClientOptions = withMigrationDriver(
    options.client ?? {
      provider,
      loadOptions: defaults,
    },
  );

  return {
    install(app: App) {
      app.provide(bmapConfigKey, config);
      // 新规范:app.use 只提供默认 Client Definition,可被 <BMapProvider> 覆盖
      app.provide(defaultClientDefinitionKey, clientDefinition);
      // 注册全局组件(与 v2 app.use 行为保持兼容)
      for (const [name, component] of installableComponents()) {
        if (component) app.component(name, component);
      }
      // 兼容旧 globalProperties 映射,便于迁移期 v2 组件读取
      const appProp = app.config.globalProperties as Record<string, unknown>;
      if (options.ak) appProp.$baiduMapAk = options.ak;
      if (options.apiUrl) appProp.$baiduMapApiUrl = options.apiUrl;
      if (options.ak || options.apiUrl) {
        warnLegacyGlobalProperties();
      }
    },
    version: LIBRARY_VERSION,
    /** 供按需导入使用 */
    config,
  };
}

/**
 * 默认 Provider（M3A3-CUTOVER / #25）：JSAPI 4.0 CDN 家族。
 *
 * - 普通情况：`baiduJsapiV4Provider()`——入口固定 `v=4.0`，就绪信号是 JSONP `callback`，
 *   读取并校验 `globalThis.BMap`；
 * - `allowExistingGlobal: true`：`existingGlobalV4Provider()`——只**复用**页面里已经就绪的
 *   `globalThis.BMap`（结构不完整即失败，不做降级）。
 *
 * 两者都返回结构化的 `LoadedJsapiV4`，因此组件默认路径会落到 v4 Driver 工厂。
 */
function defaultV4Provider(allowExistingGlobal?: boolean): AnyBMapProviderLike {
  return allowExistingGlobal ? existingGlobalV4Provider() : baiduJsapiV4Provider();
}

/**
 * v3 组件清单:来自 Manifest 生成的 `components/index.ts`(单一事实源)。
 *
 * 该文件由 `scripts/generate-manifest-artifacts.mts` 依据 `src/manifest.ts` 生成,
 * `pnpm generate:manifest:check` 会阻止漂移。注册名取 **manifest 的组件名**(导出名),
 * 与 resolver / volar.d.ts 使用同一命名,避免「两处清单漂移导致少注册组件」。
 */
function installableComponents(): readonly (readonly [string, Component])[] {
  return Object.entries(manifestComponents) as unknown as readonly (readonly [string, Component])[];
}

let legacyGlobalPropertiesWarned = false;

/**
 * `app.config.globalProperties.$baiduMapAk` / `$baiduMapApiUrl` 是 v2 → v3-beta 的
 * 迁移期兼容映射，不是 v3 公共契约：它绕过了 Provider/Client 边界，让组件直接读全局
 * 配置。Stable 之前会移除，因此这里显式 warn。
 *
 * 进程内只提示一次：模块级标记足以覆盖「多 app / 多插件实例」的常见用法，既不会让
 * 迁移者错过，也不会因为重复安装而刷屏。
 */
function warnLegacyGlobalProperties(): void {
  if (legacyGlobalPropertiesWarned) return;
  legacyGlobalPropertiesWarned = true;
  logger.warn(
    "app.config.globalProperties.$baiduMapAk/$baiduMapApiUrl 是 v2 → v3-beta 的" +
      "迁移期兼容映射，将在 3.0.0 Stable 移除；" +
      "请改用 <BMapProvider> 或 app.use(createBMapPlugin({ ak })) 的默认 Client definition。",
  );
}

/** 测试用：重置迁移期警告的一次性标记。 */
export function resetLegacyGlobalPropertiesWarningForTests(): void {
  legacyGlobalPropertiesWarned = false;
}
