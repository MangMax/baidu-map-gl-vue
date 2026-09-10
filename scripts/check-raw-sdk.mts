/**
 * 静态扫描门禁：禁止组件/业务 composable/Runtime 直接访问 raw SDK。
 *
 * 以下目录禁止出现任何 `BMapGL` 引用（含 `window.BMapGL`、`new BMapGL.*`、
 * `globalThis.BMapGL`、`(window as unknown as { BMapGL?: unknown }).BMapGL`
 * 等任意别名与双转型写法；注释与测试文件除外）：
 *   - packages/baidu-map-gl-vue/src/components
 *   - packages/baidu-map-gl-vue/src/composables
 *   - packages/baidu-map-gl-vue/src/core/runtime
 *
 * raw SDK 只允许出现在 src/driver、src/client、src/loader、src/plugins/adapters
 * 与 packages/test-utils（Fake 边界）。全局探测统一走
 * `core/loader/Provider.ts` 的 `hasExistingGlobalSdk()`。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = join(ROOT, "packages/baidu-map-gl-vue/src");
const SCAN_DIRS = ["components", "composables", join("core", "runtime")];
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts)$/;

/** 去除注释（保留字符串字面量），避免文档/示例注释触发误报 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(ts|vue|mts)$/.test(entry) && !TEST_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// 任意 BMapGL 标识符（含双转型别名）在受管目录均属越界访问
const FORBIDDEN_PATTERN = /\bBMapGL\b/;

const violations: Array<{ file: string; line: number; text: string }> = [];

for (const dir of SCAN_DIRS) {
  for (const file of collectFiles(join(PKG, dir))) {
    const stripped = stripComments(readFileSync(file, "utf8"));
    const lines = stripped.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (FORBIDDEN_PATTERN.test(lines[i])) {
        violations.push({ file: file.slice(ROOT.length + 1), line: i + 1, text: lines[i].trim() });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("raw SDK static scan FAILED:");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} -> ${v.text}`);
  }
  console.error(
    "Access the SDK only via Driver/Loader boundaries; probe the global via hasExistingGlobalSdk() (core/loader/Provider.ts).",
  );
  process.exit(1);
}

console.log("raw SDK static scan OK: components/composables/core-runtime are clean.");
