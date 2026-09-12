/**
 * v4 浏览器 smoke 的进程编排（Node 侧）
 *
 * 一个命令跑完「起页面 → 起浏览器 → 读结论 → 判退」：
 *
 * ```bash
 * node --experimental-strip-types tests/browser/jsapi-v4/run.mts --mode=fixture   # PR 门禁，无 AK/无网络
 * BAIDU_MAP_AK=xxx node --experimental-strip-types tests/browser/jsapi-v4/run.mts --mode=live
 * ```
 *
 * 为什么不用 `--dump-dom --virtual-time-budget`：真实瓦片持续加载时它**会挂死**（实测 2 分钟
 * 不退出、产物 0 字节）。CDP 是唯一可靠的读数通道。为什么用 `--remote-debugging-port=0`：
 * 端口写在 `<user-data-dir>/DevToolsActivePort` 里，不会和本地其它调试实例抢端口。
 *
 * AK 只经查询参数传给页面，**不落盘**（页面默认「复用既有全局」分支时根本不发请求）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";
import { formatReport, type SmokeMode, type SmokeReport } from "./report.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/* ------------------------------------------------------------------ 参数 */

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const MODE: SmokeMode = readArg("mode") === "live" ? "live" : "fixture";
const AK = readArg("ak") ?? process.env.BAIDU_MAP_AK ?? "";
/** 页面内 `<BMap>` ready 的等待预算（透传给页面）；排障时可压到几秒。 */
const READY_MS = readArg("ready-ms");
const TIMEOUT_MS = Number(readArg("timeout") ?? (MODE === "live" ? 180_000 : 90_000));

if (MODE === "live" && !AK) {
  console.error(
    "[smoke] live 模式需要 AK：`--ak=...` 或环境变量 BAIDU_MAP_AK。\n" +
      "        AK 只经 URL 查询参数传给页面，不会写入任何文件。",
  );
  process.exit(2);
}

/**
 * fixture 档阻断外部请求。
 *
 * 目的有二：① 保证 PR 门禁**真的**不依赖网络；② 让「插件加载失败不阻塞基础 Map ready」
 * 有一条确定性路径——内置插件脚本来自 `mapopen.bj.bcebos.com`，被阻断后必然以
 * `plugin-error` 结算。本地 dev server 是 `127.0.0.1`，不在阻断列表里。
 */
const BLOCKED_URLS = ["*mapopen.bj.bcebos.com*", "*unpkg.com*", "*api.map.baidu.com*"];

/* -------------------------------------------------------------- 浏览器解析 */

/**
 * 找一个可用的 Chromium。
 *
 * 优先级：`SMOKE_BROWSER` → Playwright 缓存（本机与 CI 的 `playwright install chromium` 都落在
 * 这里）→ 系统 Chrome/Chromium。刻意**不**依赖仓库内新增 npm 依赖：smoke 是可选门禁，把
 * 浏览器安装耦合进 `pnpm install` 会让所有人替它付代价。
 */
function resolveBrowser(): string {
  const explicit = process.env.SMOKE_BROWSER;
  if (explicit && existsSync(explicit)) return explicit;

  const candidates: string[] = [];
  const roots = [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? "",
  ].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const base = join(root, dir);
      if (!statSync(base).isDirectory()) continue;
      candidates.push(
        join(base, "chrome-headless-shell-mac-arm64/chrome-headless-shell"),
        join(base, "chrome-headless-shell-mac-x64/chrome-headless-shell"),
        join(base, "chrome-linux/chrome-headless-shell"),
        join(base, "chrome-linux/chrome"),
        join(base, "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"),
        join(base, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
      );
    }
  }

  candidates.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "找不到 Chromium：设置 SMOKE_BROWSER 指向可执行文件，或 `npx playwright install chromium`。",
  );
}

function browserFlags(binary: string): string[] {
  const flags = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    // 真实 4.0 需要 WebGL；无 GPU 环境靠 SwiftShader
    "--enable-unsafe-swiftshader",
    "--disable-gpu",
  ];
  // chrome-headless-shell 本身就是 headless；完整 Chrome 必须显式指定
  if (!binary.includes("chrome-headless-shell")) flags.push("--headless=new");
  return flags;
}

/* ---------------------------------------------------------------- CDP 客户端 */

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: Record<string, any>;
  error?: { message: string };
}

class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Map<string, Set<(params: any) => void>>();
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => this.onMessage(JSON.parse(String(event.data)) as CdpMessage));
  }

  static connect(url: string): Promise<CdpSession> {
    return new Promise((resolveSession, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error(`CDP 连接超时：${url}`)), 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolveSession(new CdpSession(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`CDP 连接失败：${url}`));
      });
    });
  }

  private onMessage(message: CdpMessage): void {
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method) {
      for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
    }
  }

  send<T = Record<string, any>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend as (v: any) => void, reject: rejectSend });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, handler: (params: any) => void): void {
    let set = this.listeners.get(method);
    if (!set) this.listeners.set(method, (set = new Set()));
    set.add(handler);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* 已经断开 */
    }
  }
}

/* ------------------------------------------------------------------- 主流程 */

let viteServer: Awaited<ReturnType<typeof createServer>> | undefined;
let chrome: ChildProcess | undefined;
let session: CdpSession | undefined;
const profileDir = mkdtempSync(join(tmpdir(), "bmap-v4-smoke-"));
const browserErrors: string[] = [];

async function main(): Promise<number> {
  viteServer = await createServer({
    configFile: join(HERE, "vite.config.mts"),
    logLevel: "warn",
  });
  await viteServer.listen();
  const origin = viteServer.resolvedUrls?.local?.[0];
  if (!origin) throw new Error("Vite dev server 没有给出可访问地址");
  const pageParams = new URLSearchParams({ mode: MODE });
  if (MODE === "live") pageParams.set("ak", AK);
  if (READY_MS) pageParams.set("readyMs", READY_MS);
  const pageUrl = `${origin}?${pageParams.toString()}`;
  // 日志里一律掩掉 AK：CI 日志是公开可读的
  const displayUrl = pageUrl.replace(/([?&]ak=)[^&]*/, "$1***");

  const binary = resolveBrowser();
  chrome = spawn(binary, [
    ...browserFlags(binary),
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ]);
  chrome.stderr?.on("data", () => {
    /* Chrome 的 stderr 噪声很大，读数只看 CDP */
  });

  const devtoolsPort = await waitForDevToolsPort();
  session = await CdpSession.connect(await pageTargetUrl(devtoolsPort));

  session.on("Runtime.exceptionThrown", (params) => {
    const details = params?.exceptionDetails;
    browserErrors.push(details?.exception?.description ?? details?.text ?? "unknown exception");
  });

  await session.send("Runtime.enable");
  await session.send("Page.enable");
  await session.send("Network.enable");
  if (MODE === "fixture") {
    await session.send("Network.setBlockedURLs", { urls: BLOCKED_URLS });
  }
  await session.send("Page.navigate", { url: pageUrl });

  const report = await waitForReport();
  if (!report) {
    console.error(`[smoke] 页面在 ${TIMEOUT_MS}ms 内没有产出结果（__SMOKE__ 为空）`);
    console.error(`        page=${displayUrl}`);
    console.error(`        浏览器异常：${browserErrors.join(" | ") || "无"}`);
    return 1;
  }

  console.log(formatReport(report));
  console.log(`page=${displayUrl}`);
  // 可选落盘：CI 里把报告存成 artifact 便于归因（本地一般不需要，stdout 已经够看）
  const logPath = readArg("log");
  if (logPath) {
    await writeFile(resolve(logPath), `${formatReport(report)}\npage=${displayUrl}\n`, "utf8");
  }
  if (browserErrors.length > 0) {
    // 只报告不判退：第三方脚本（SDK / 插件）自身的异常不应把库门禁染红。
    console.log(`browser-exceptions=${browserErrors.length}`);
    for (const entry of browserErrors) console.log(`  ${entry}`);
  }
  return report.ok ? 0 : 1;
}

/** 轮询 `<user-data-dir>/DevToolsActivePort`：第一行是端口，第二行是浏览器级 ws 路径。 */
async function waitForDevToolsPort(): Promise<number> {
  const file = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, "utf8").split("\n");
      if (port && Number(port) > 0) return Number(port);
    }
    await delay(150);
  }
  throw new Error(`浏览器没有写出 DevToolsActivePort（${file}）`);
}

async function pageTargetUrl(port: number): Promise<string> {
  const deadline = Date.now() + 20_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = (await response.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (error) {
      lastError = String(error);
    }
    await delay(150);
  }
  throw new Error(`没有找到可调试的页面 target：${lastError}`);
}

async function waitForReport(): Promise<SmokeReport | null> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const result = await session!.send<{ result: { value?: string | null } }>("Runtime.evaluate", {
        expression: "window.__SMOKE__ ? JSON.stringify(window.__SMOKE__) : null",
        returnByValue: true,
      });
      const value = result.result?.value;
      if (typeof value === "string" && value.length > 0) return JSON.parse(value) as SmokeReport;
    } catch {
      /* 导航过程中执行上下文会被替换，重试即可 */
    }
    await delay(250);
  }
  return null;
}

async function cleanup(): Promise<void> {
  session?.close();
  chrome?.kill("SIGKILL");
  await viteServer?.close().catch(() => {});
}

main()
  .then(async (code) => {
    await cleanup();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error(`[smoke] 编排失败：${error instanceof Error ? error.stack : String(error)}`);
    await cleanup();
    process.exit(1);
  });
