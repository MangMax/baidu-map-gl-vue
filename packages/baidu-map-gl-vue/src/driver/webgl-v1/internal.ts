/**
 * webgl-v1 内部工具：SDK 构造器访问与调用错误归一化。
 *
 * raw SDK 只通过 `rawSdk` 参数进入，禁止访问 window.BMapGL。
 */
import { BMapError } from "../../core/errors/BMapError";

export type SdkCtor = new (...args: unknown[]) => unknown;

export function sdkCtor(rawSdk: unknown, name: string): SdkCtor {
  const ctor = (rawSdk as Record<string, unknown> | null | undefined)?.[name];
  if (typeof ctor !== "function") {
    throw new BMapError("BMAP_SDK_CALL_FAILED", `BMapGL.${name} is not available`);
  }
  return ctor as SdkCtor;
}

export function sdkCall<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new BMapError(
      "BMAP_SDK_CALL_FAILED",
      `${label} failed: ${(error as Error)?.message ?? String(error)}`,
      { cause: error },
    );
  }
}

/** 可选方法调用：方法不存在时静默返回 undefined（不归类为版本不支持） */
export function callOptional(instance: unknown, method: string, ...args: unknown[]): unknown {
  const fn = (instance as Record<string, unknown> | null | undefined)?.[method];
  if (typeof fn === "function") {
    return (fn as (...a: unknown[]) => unknown).apply(instance, args);
  }
  return undefined;
}

export function hasMember(rawSdk: unknown, member: string): boolean {
  const sdk = rawSdk as Record<string, unknown> | null | undefined;
  if (!sdk) return false;
  if (typeof sdk[member] !== "undefined") return true;
  const mapProto = (sdk.Map as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  return typeof mapProto?.[member] === "function";
}
