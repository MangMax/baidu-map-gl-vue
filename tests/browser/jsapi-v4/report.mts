/**
 * v4 浏览器 smoke 的结果结构（零依赖）
 *
 * 与 `packages/test-utils/facet-probes.ts` 同样的分工：这里只有**记录**，不 import vitest、
 * 不 import Vue，因此同一份结构既能被浏览器写进 `window.__SMOKE__`，也能被 Node 侧的
 * runner（`run.mts`）读出来打印与判退。断言写在探针里（`assertSmoke`），期望值按
 * `fixture` / `live` 两档给——真实环境只要求「结算且形状自洽」，把「真实环境必须成功」
 * 写死只会得到不稳定门禁。
 */

export type SmokeMode = "fixture" | "live";

export interface SmokeProbeResult {
  name: string;
  ok: boolean;
  /** 失败原因码；成功时省略。`BMAP_*` 前缀提示库回归，`SERVICE_*` / `TIMEOUT` 提示外部波动。 */
  code?: string;
  /** 通过时也可用的观察值，用于排障与「区分外部波动与库回归」。 */
  detail?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * 未处理异常条目。
 *
 * `thirdParty` 把「跨域脚本抛的错」与「本库抛的错」分开：
 * - 由 Vite 同源提供的本库模块 → 有 `source`，且 `source` 以页面 origin 开头；
 * - 百度 SDK / BMapGLLib 插件这类跨域脚本 → 浏览器只给 `"Script error."`（无 `source`、无堆栈），
 *   无法归属，也就无法据此判断是不是库回归。**记录但不算门禁**，否则一个插件脚本的噪声
 *   会让 nightly 永久变红、掩盖真正的回归。
 */
export interface SmokeUnhandledEntry {
  kind: "error" | "rejection";
  message: string;
  source: string;
  thirdParty: boolean;
}

export interface SmokeReport {
  mode: SmokeMode;
  ok: boolean;
  okCount: number;
  failCount: number;
  probes: SmokeProbeResult[];
  /** **本库相关**的未处理异常（这部分非空即 `ok=false`，验收标准要求为 0）。 */
  unhandled: SmokeUnhandledEntry[];
  /** 跨域第三方脚本的未处理异常（只记录，见 `SmokeUnhandledEntry`）。 */
  thirdPartyUnhandled: SmokeUnhandledEntry[];
  env: Record<string, unknown>;
  durationMs: number;
  finishedAt: string;
}

/** 探针失败：带可机读原因码，而不是把一切失败都记成字符串。 */
export class SmokeFailure extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "SmokeFailure";
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code: string, message: string, detail?: unknown): never {
  throw new SmokeFailure(code, message, detail);
}

/** 断言 + 显式原因码。条件不成立时立即失败，避免后续步骤在脏状态上继续跑。 */
export function assertSmoke(
  condition: unknown,
  code: string,
  message: string,
  detail?: unknown,
): void {
  if (!condition) fail(code, message, detail);
}

/** 把「等不到条件」变成带 `TIMEOUT` 码的失败，而不是让整轮 smoke 挂死。 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  code = "TIMEOUT",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SmokeFailure(code, `${label} 在 ${ms}ms 内没有结算`, { label, ms })),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 探针收集器。
 *
 * 每个探针独立 `try/catch`：一步失败不中断整轮——否则「第一个失败」会掩盖后面所有结论，
 * 排障时无法判断是一个问题还是五个。
 */
export class SmokeRun {
  readonly probes: SmokeProbeResult[] = [];
  readonly env: Record<string, unknown>;
  readonly mode: SmokeMode;
  private readonly startedAt = performance.now();

  constructor(mode: SmokeMode, env: Record<string, unknown> = {}) {
    this.mode = mode;
    this.env = env;
  }

  async probe(name: string, run: () => Promise<unknown> | unknown): Promise<SmokeProbeResult> {
    const startedAt = performance.now();
    const base = { name, durationMs: 0 } as SmokeProbeResult;
    try {
      const detail = await run();
      const result: SmokeProbeResult = {
        ...base,
        ok: true,
        durationMs: Math.round(performance.now() - startedAt),
      };
      if (detail !== undefined) result.detail = detail;
      this.probes.push(result);
      return result;
    } catch (error) {
      const isKnown = error instanceof SmokeFailure;
      const result: SmokeProbeResult = {
        ...base,
        ok: false,
        code: isKnown ? error.code : "UNEXPECTED",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      };
      if (isKnown && error.detail !== undefined) result.detail = error.detail;
      this.probes.push(result);
      return result;
    }
  }

  /** 允许失败的重试：同一个探针名重复登记时以最后一次为准（用于「重挂载后再断言」）。 */
  replace(result: SmokeProbeResult): void {
    const index = this.probes.findIndex((entry) => entry.name === result.name);
    if (index >= 0) this.probes.splice(index, 1, result);
    else this.probes.push(result);
  }

  report(entries: SmokeUnhandledEntry[]): SmokeReport {
    const unhandled = entries.filter((entry) => !entry.thirdParty);
    const thirdPartyUnhandled = entries.filter((entry) => entry.thirdParty);
    const failCount = this.probes.filter((entry) => !entry.ok).length;
    return {
      mode: this.mode,
      ok: failCount === 0 && unhandled.length === 0,
      okCount: this.probes.length - failCount,
      failCount: failCount + unhandled.length,
      probes: this.probes,
      unhandled,
      thirdPartyUnhandled,
      env: this.env,
      durationMs: Math.round(performance.now() - this.startedAt),
      finishedAt: new Date().toISOString(),
    };
  }
}

/** 把报告渲染成人类可读文本（页面 `<pre>` 与 runner stdout 共用）。 */
export function formatReport(report: SmokeReport): string {
  const lines = [
    `mode=${report.mode} ok=${report.ok} passed=${report.okCount} failed=${report.failCount} in ${report.durationMs}ms`,
    `env=${JSON.stringify(report.env)}`,
  ];
  for (const probe of report.probes) {
    const status = probe.ok ? "PASS" : "FAIL";
    const code = probe.ok ? "" : ` [${probe.code}]`;
    const error = probe.ok ? "" : ` ${probe.error}`;
    lines.push(`${status} ${probe.name}${code}${error} (${probe.durationMs}ms)`);
    if (probe.detail !== undefined) {
      lines.push(`     detail=${safeJson(probe.detail)}`);
    }
  }
  if (report.unhandled.length > 0) {
    lines.push(`FAIL unhandled-exceptions [UNHANDLED] 本库相关 ${report.unhandled.length} 条`);
    for (const entry of report.unhandled) lines.push(`     ${formatUnhandled(entry)}`);
  } else {
    lines.push("PASS unhandled-exceptions (本库相关 0 条)");
  }
  if (report.thirdPartyUnhandled.length > 0) {
    lines.push(
      `INFO third-party-exceptions ${report.thirdPartyUnhandled.length} 条（跨域脚本，不计入门禁）`,
    );
    for (const entry of report.thirdPartyUnhandled) lines.push(`     ${formatUnhandled(entry)}`);
  }
  return lines.join("\n");
}

function formatUnhandled(entry: SmokeUnhandledEntry): string {
  return `${entry.kind}: ${entry.message}${entry.source ? ` @ ${entry.source}` : ""}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
