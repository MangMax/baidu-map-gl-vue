/**
 * 静态扫描门禁：禁止组件/业务 composable/Runtime 直接访问 raw SDK。
 *
 * 以下目录禁止出现任何 `BMapGL` 引用（含 `window.BMapGL`、`new BMapGL.*`、
 * `globalThis.BMapGL`、`(window as unknown as { BMapGL?: unknown }).BMapGL`
 * 等任意别名/双转型写法，以及 `BMapGL` 类型引用）：
 *   - packages/baidu-map-gl-vue/src/components
 *   - packages/baidu-map-gl-vue/src/composables
 *   - packages/baidu-map-gl-vue/src/core/runtime
 *
 * raw SDK 只允许出现在 src/driver、src/client、src/loader、src/plugins/adapters
 * 与 packages/test-utils（Fake 边界）。全局探测统一走
 * `core/loader/Provider.ts` 的 `hasExistingGlobalSdk()`。
 *
 * 实现注意：使用 TypeScript `createSourceFile()` 解析为 AST 后遍历，
 * 只识别真正的标识符 / `window["BMapGL"]` 字符串键节点。注释、正则字面量、
 * 普通字符串与词法歧义（`/[/*]/`、`if (x) /re/` 等）天然不参与匹配，
 * 不会出现“正则被误判为注释而吞掉后续代码”的漏报。
 * `.vue` 文件用 `vue/compiler-sfc` 的官方解析器提取 `<script>`/`<script setup>`
 * 区块（正确处理 `</script >`、属性值内的 `>`、HTML 注释等），再把区块内容
 * 交给同一 AST 检查，并按 `block.loc.start.offset` 映射回源文件。
 * SFC 解析失败时明确报错退出,绝不静默放行。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as ts from "typescript";
import { parse as parseSfc, type SFCBlock } from "vue/compiler-sfc";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = join(ROOT, "packages/baidu-map-gl-vue/src");
const SCAN_DIRS = ["components", "composables", join("core", "runtime")];
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts)$/;
const SDK_IDENTIFIER = "BMapGL";

interface Violation {
  file: string;
  line: number;
  column: number;
  text: string;
}

/** 遍历 AST，匹配真正的 `BMapGL` 标识符与 `"BMapGL"` 字符串键节点 */
function collectFromAst(
  ast: ts.SourceFile,
  file: string,
  fullText: string,
  offset: number,
  violations: Violation[],
): void {
  const fullLines = fullText.split("\n");
  const lineStarts = (() => {
    const starts = [0];
    for (let i = 0; i < fullText.length; i++) {
      if (fullText[i] === "\n") starts.push(i + 1);
    }
    return starts;
  })();

  const report = (node: ts.Node): void => {
    const abs = offset + node.getStart(ast);
    // 用行起始表换算绝对位置所在行，避免逐字符扫描
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= abs) lo = mid;
      else hi = mid - 1;
    }
    const line = lo + 1;
    const column = abs - lineStarts[lo] + 1;
    violations.push({
      file,
      line,
      column,
      text: (fullLines[lo] ?? "").trim(),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === SDK_IDENTIFIER) {
      report(node);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === SDK_IDENTIFIER
    ) {
      // 覆盖 window["BMapGL"] 动态访问；仅精确匹配整串，日志文案不受影响
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

function scanTypeScript(file: string, text: string, violations: Violation[]): void {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  collectFromAst(ast, file, text, 0, violations);
}

function scanVue(file: string, text: string, violations: Violation[], failures: string[]): void {
  let descriptor;
  let errors;
  try {
    ({ descriptor, errors } = parseSfc(text, { filename: file }));
  } catch (error) {
    failures.push(`${file}: SFC parse threw: ${(error as Error)?.message ?? String(error)}`);
    return;
  }
  if (errors.length > 0 || !descriptor) {
    const message = errors
      .map((e) => ("message" in e ? e.message : String(e)))
      .filter(Boolean)
      .join("; ");
    failures.push(`${file}: SFC parse failed${message ? `: ${message}` : ""}`);
    return;
  }
  const blocks: SFCBlock[] = [descriptor.script, descriptor.scriptSetup].filter(
    (b): b is SFCBlock => Boolean(b),
  );
  for (const block of blocks) {
    const kind =
      block.lang === "tsx"
        ? ts.ScriptKind.TSX
        : block.lang === "jsx"
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.TS;
    const ast = ts.createSourceFile(file, block.content, ts.ScriptTarget.Latest, true, kind);
    // block.loc.start.offset 指向脚本内容起点,直接映射回源文件行列
    collectFromAst(ast, file, text, block.loc.start.offset, violations);
  }
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

const violations: Violation[] = [];
const failures: string[] = [];

const dirs =
  process.argv[2] === "--dir"
    ? [process.argv[3]]
    : SCAN_DIRS.map((d) => join(PKG, d));

for (const dir of dirs) {
  for (const file of collectFiles(dir)) {
    const rel = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
    const text = readFileSync(file, "utf8");
    if (file.endsWith(".vue")) {
      scanVue(rel, text, violations, failures);
    } else {
      scanTypeScript(rel, text, violations);
    }
  }
}

if (violations.length > 0) {
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  console.error("raw SDK static scan FAILED:");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.column} -> ${v.text}`);
  }
  console.error(
    "Access the SDK only via Driver/Loader boundaries; probe the global via hasExistingGlobalSdk() (core/loader/Provider.ts).",
  );
  process.exit(1);
}

if (failures.length > 0) {
  console.error("raw SDK static scan FAILED (unparsable input; refusing to pass silently):");
  for (const f of failures) {
    console.error(`  ${f}`);
  }
  process.exit(1);
}

console.log("raw SDK static scan OK: components/composables/core-runtime are clean.");
