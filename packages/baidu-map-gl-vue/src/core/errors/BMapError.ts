/**
 * M2-01: 错误模型
 *
 * 所有运行时错误都以稳定 code 表达,携带 mapId/component/plugin 等上下文。
 * 日志输出不得包含完整 AK(见方案 §7.6)。
 */

export type BMapErrorCode =
  | "BMAP_SDK_LOAD_FAILED"
  | "BMAP_SDK_LOAD_TIMEOUT"
  | "BMAP_SDK_CONFIG_CONFLICT"
  | "BMAP_PROVIDER_ABORTED"
  | "BMAP_RUNTIME_DISPOSED"
  | "BMAP_PARENT_CONTEXT_MISSING"
  | "BMAP_RESOURCE_CREATE_FAILED"
  | "BMAP_PLUGIN_LOAD_FAILED"
  | "BMAP_INVALID_POINT";

export interface BMapErrorOptions {
  cause?: unknown;
  mapId?: symbol | string;
  component?: string;
  plugin?: string;
}

export class BMapError extends Error {
  readonly code: BMapErrorCode;
  readonly mapId?: symbol | string;
  readonly component?: string;
  readonly plugin?: string;

  constructor(code: BMapErrorCode, message: string, options?: BMapErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = "BMapError";
    this.code = code;
    this.mapId = options?.mapId;
    this.component = options?.component;
    this.plugin = options?.plugin;
  }

  /** 结构化错误上下文,便于错误报告面板/日志 */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause,
      mapId: this.mapId != null ? String(this.mapId) : undefined,
      component: this.component,
      plugin: this.plugin,
    };
  }

  /** 是否可重试(加载/配置类错误可重试,资源/上下文类不可) */
  get retryable(): boolean {
    return (
      this.code === "BMAP_SDK_LOAD_FAILED" ||
      this.code === "BMAP_SDK_LOAD_TIMEOUT" ||
      this.code === "BMAP_PROVIDER_ABORTED" ||
      this.code === "BMAP_PLUGIN_LOAD_FAILED"
    );
  }

  static readonly codes = {
    SDK_LOAD_FAILED: "BMAP_SDK_LOAD_FAILED" as const,
    SDK_LOAD_TIMEOUT: "BMAP_SDK_LOAD_TIMEOUT" as const,
    SDK_CONFIG_CONFLICT: "BMAP_SDK_CONFIG_CONFLICT" as const,
    PROVIDER_ABORTED: "BMAP_PROVIDER_ABORTED" as const,
    RUNTIME_DISPOSED: "BMAP_RUNTIME_DISPOSED" as const,
    PARENT_CONTEXT_MISSING: "BMAP_PARENT_CONTEXT_MISSING" as const,
    RESOURCE_CREATE_FAILED: "BMAP_RESOURCE_CREATE_FAILED" as const,
    PLUGIN_LOAD_FAILED: "BMAP_PLUGIN_LOAD_FAILED" as const,
    INVALID_POINT: "BMAP_INVALID_POINT" as const,
  };
}
