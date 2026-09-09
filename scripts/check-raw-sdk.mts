/**
 * 静态扫描门禁：禁止组件/业务 composable/Runtime 直接访问 raw SDK。
 *
 * 以下目录禁止直接出现 `window.BMapGL`、`new BMapGL.*`、
 * `globalThis.BMapGL`（含 `(window as any).BMapGL` 别名）：
 *   - packages/baidu-map-gl-vue/src/components
 *   - packages/baidu-map-gl-vue/src/composables
 *   - packages/baidu-map-gl-vue/src/core/runtime
 *
 * raw SDK 只允许出现在 src/driver、src/client、src/loader、src/plugins/adapters。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = join(ROOT, "packages/baidu-map-gl-vue/src");
const SCAN_DIRS = ["components", "composables", join("core", "runtime")];

const FORBIDDEN_PATTERNS: RegExp[] = [
  /window\.BMapGL/,
  /new BMapGL\./,
  /globalThis\.BMapGL/,
  /\(window\s*as[^)]*\)\s*\.BMapGL/,
];

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(ts|vue|mts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const violations: Array<{ file: string; line: number; text: string; pattern: RegExp }> = [];

for (const dir of SCAN_DIRS) {
  for (const file of collectFiles(join(PKG, dir))) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(lines[i])) {
          violations.push({ file: file.slice(ROOT.length + 1), line: i + 1, text: lines[i].trim(), pattern });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("raw SDK static scan FAILED:");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} -> ${v.text}`);
  }
  process.exit(1);
}

console.log("raw SDK static scan OK: components/composables/core-runtime are clean.");
