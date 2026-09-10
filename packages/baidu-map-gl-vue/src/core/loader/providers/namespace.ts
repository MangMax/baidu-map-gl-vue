/**
 * JSAPI 4.0 全局命名空间边界
 *
 * 只允许在 Loader / Provider 边界内读取 `globalThis.BMap`。Provider 负责探测、校验与
 * 结构化封装；组件、业务 composable 与 runtime 一律经 Facade Driver 访问，禁止直接
 * 触碰全局（见 `scripts/raw-sdk-boundary.mts`）。
 *
 * 迁移期 legacy Provider 读的是 `BMap ?? BMapGL`（见 `core/loader/Provider.ts`），
 * 这里只认 v4 目标的 `BMap`：读到 `BMapGL` 不是 v4 就绪，必须走 legacy 路径。
 */
import { BMapError } from "../../errors/BMapError";
import { DEFAULT_VERSION, type BMapLoadOptions } from "../url";
import type { JsapiV4VersionSource } from "./types";

/** 所有 v4 Provider 共享的进程级冲突域名称。 */
export const JSAPI_V4_DOMAIN = "BMap";

/** v4 命名空间可用的最小成员集合。 */
export const JSAPI_V4_REQUIRED_MEMBERS = ["Map", "Point", "Marker"] as const;

/**
 * 全局对象上的版本探测键。
 *
 * 官方 `@baidumap/jsapi-v4-types@4.0.4` 未声明版本常量，因此这里是**尽力探测**：
 * 探测不到时回退到基线声明值，并由 `versionSource: "declared"` 如实标注。
 */
export const JSAPI_V4_VERSION_PROBE_KEYS = ["VERSION", "version"] as const;

/** 读取 v4 全局命名空间；未就绪返回 `undefined`。 */
export function readJsapiV4Global(): unknown {
  return (globalThis as { BMap?: unknown }).BMap;
}

/**
 * script 就绪后的命名空间读取：未就绪或结构不完整都抛 `BMAP_SDK_LOAD_FAILED`。
 *
 * 「脚本加载成功但全局命名空间缺失 / 不完整」是 v4 最常见的失败形态，统一在这里
 * 收敛，Provider 不必各写一份。
 */
export function requireJsapiV4Global(providerId: string): Record<string, unknown> {
  const value = readJsapiV4Global();
  if (value === undefined) {
    throw new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      `SDK script resolved but global BMap namespace is missing (provider: ${providerId})`,
      { engine: "jsapi-v4" },
    );
  }
  return assertJsapiV4Namespace(value, providerId);
}

/**
 * v4 Provider 的入口前置校验：显式声明的 `version` 必须属于 4.x。
 *
 * CDN 入口固定 `v=4.0`（见 ADR 2026-09-10），这里把「调用方要求别的版本」变成显式
 * 失败，而不是静默按 4.0 加载、或用非 4.0 的指纹污染冲突域。
 */
export function assertSupportedJsapiV4Version(
  options: Pick<BMapLoadOptions, "version">,
  providerId: string,
): void {
  if (options.version) assertJsapiV4Version(options.version, providerId);
}

/** 缺少的最小成员；空数组表示结构满足要求。 */
export function findMissingJsapiV4Members(value: unknown): string[] {
  if (value === null || value === undefined) return [...JSAPI_V4_REQUIRED_MEMBERS];
  if (typeof value !== "object" && typeof value !== "function") {
    return [...JSAPI_V4_REQUIRED_MEMBERS];
  }
  const namespace = value as Record<string, unknown>;
  return JSAPI_V4_REQUIRED_MEMBERS.filter(
    (member) => namespace[member] === undefined || namespace[member] === null,
  );
}

export function isJsapiV4Namespace(value: unknown): boolean {
  return findMissingJsapiV4Members(value).length === 0;
}

/**
 * 校验并返回命名空间。缺成员时抛 `BMAP_SDK_LOAD_FAILED`（可重试），消息里带上
 * provider 与缺失成员，便于定位「脚本加载成功但命名空间不完整」这一类问题。
 */
export function assertJsapiV4Namespace(
  value: unknown,
  providerId: string,
): Record<string, unknown> {
  const missing = findMissingJsapiV4Members(value);
  if (missing.length > 0) {
    throw new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      `JSAPI 4.0 namespace is incomplete (provider: ${providerId}); missing member(s): ${missing.join(", ")}`,
      { engine: "jsapi-v4" },
    );
  }
  return value as Record<string, unknown>;
}

/** 从全局对象尽力读取版本号字符串；读不到返回 `undefined`。 */
export function probeJsapiV4Version(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const namespace = value as Record<string, unknown>;
  for (const key of JSAPI_V4_VERSION_PROBE_KEYS) {
    const found = namespace[key];
    if (typeof found === "string" && found.length > 0) return found;
  }
  return undefined;
}

/**
 * 校验版本号确实属于 JSAPI 4.0（Stable 单引擎基线）。
 * 不匹配即失败——否则会把 `BMapGL` / 3.0 时代的全局当成 v4 使用。
 */
export function assertJsapiV4Version(version: string, providerId: string): string {
  if (!/^4(\.|$)/.test(version)) {
    throw new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      `SDK version "${version}" is not JSAPI 4.0 (provider: ${providerId})`,
      { engine: "jsapi-v4", version },
    );
  }
  return version;
}

/**
 * 解析「已存在全局」的版本来源。
 *
 * - 探测到版本 → 校验必须是 `4.x`，来源标注 `global`；
 * - 完全探测不到 → 回退调用方声明值（再退基线 `4.0`），标注 `declared`。
 */
export function resolveExistingJsapiV4Version(
  namespace: unknown,
  providerId: string,
  declaredVersion?: string,
): { version: string; source: JsapiV4VersionSource } {
  const probed = probeJsapiV4Version(namespace);
  if (!probed) return { version: declaredVersion ?? DEFAULT_VERSION, source: "declared" };
  return { version: assertJsapiV4Version(probed, providerId), source: "global" };
}
