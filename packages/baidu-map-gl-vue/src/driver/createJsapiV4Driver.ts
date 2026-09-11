/**
 * JSAPI 4.0 Facet Driver 工厂（默认注入点）
 *
 * M3A1-CLIENT（issue #18）在这里落默认 driver 工厂：`createBMapClient` 缺省注入本函数，
 * 因此默认路径只接受 `LoadedJsapiV4`。
 *
 * 文件刻意放在 `driver/` 根而不是 `driver/jsapi-v4/`：后者是**类型边界目录**（官方声明
 * augmentation），按 ADR 2026-09-10-bmap-raw-sdk-boundary 不得进入发布声明产物
 * （见 `scripts/check-public-dts.mts` 的 boundary-file-published 规则）。
 *
 * **Driver 本体属于 M3A.2（#19~#23）**：本函数当前只保留契约与明确的失败信号，不给出
 * 「看似可用」的 driver。M3A.3（#25）完成默认 cutover 后组件默认路径也会切到这里。
 */
import { BMapError } from "../core/errors/BMapError";
import type { Capability } from "./capability/catalog";
import type { UnsupportedBehavior } from "./capability/unsupported";
import type { BMapDriver } from "./types/bmap";

export interface CreateJsapiV4DriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  /** `LoadedJsapiV4.version`（Provider 声明的 SDK 运行时版本）。 */
  version: string;
  unsupported: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

export function createJsapiV4Driver(input: CreateJsapiV4DriverInput): BMapDriver {
  throw new BMapError(
    "BMAP_CAPABILITY_UNSUPPORTED",
    "JSAPI 4.0 Facet Driver 尚未实现（M3A.2 / #19~#23）；" +
      "迁移期请在 createBMapClient 中注入 driver 工厂，或显式使用 createLegacyBMapClient()",
    { engine: "jsapi-v4", version: input.version },
  );
}
