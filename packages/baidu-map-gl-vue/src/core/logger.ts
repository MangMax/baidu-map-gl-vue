/**
 * M2-01: 日志与 AK 脱敏
 *
 * 方案 §7.6:日志中不得输出完整 AK。最多输出 hash、后四位或 provider ID。
 */

/** 将字符串中的疑似 AK 脱敏为后四位 */
export function redactAk(input: string, ak?: string | null): string {
  if (!input) return input;
  if (!ak) {
    // 没有已知 ak 时,尝试匹配形如 ak=<36位或长串> 的模式
    return input.replace(/ak=([A-Za-z0-9]{6,})/gi, (_m, v: string) => `ak=***${v.slice(-4)}`);
  }
  // 用已知 ak 替换
  return input.split(ak).join(`***${ak.slice(-4)}`);
}

export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

type LoggerLevel = "debug" | "warn" | "error";

function makeLogger(knowsAk?: () => string | null | undefined): Logger {
  const emit = (level: LoggerLevel, message: string, context?: Record<string, unknown>) => {
    const redacted = redactAk(message, knowsAk?.());
    const line = `[baidu-map-gl-vue] ${redacted}`;
    if (level === "error") console.error(line, context ?? "");
    else if (level === "warn") console.warn(line, context ?? "");
    else console.debug(line, context ?? "");
  };
  return {
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    debug: (m, c) => emit("debug", m, c),
  };
}

let akProvider: (() => string | null | undefined) | null = null;

export function setAkForLogger(getter: () => string | null | undefined): void {
  akProvider = getter;
}

export const logger: Logger = {
  warn: (m, c) => makeLogger(akProvider ? () => akProvider!() : undefined).warn(m, c),
  error: (m, c) => makeLogger(akProvider ? () => akProvider!() : undefined).error(m, c),
  debug: (m, c) => makeLogger(akProvider ? () => akProvider!() : undefined).debug(m, c),
};
