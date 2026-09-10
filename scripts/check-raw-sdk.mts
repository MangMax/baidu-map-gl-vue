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
 *
 * 实现注意：注释剥离是词法级的——识别字符串、模板串与正则字面量，
 * 避免 `/[/*]/` 之类正则内的 `/*` 被误判为块注释而吞掉后续真实代码。
 * 剥离时按原样保留换行，报错行号与源文件一致。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = join(ROOT, "packages/baidu-map-gl-vue/src");
const SCAN_DIRS = ["components", "composables", join("core", "runtime")];
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts)$/;

/** 这些关键字/结尾符之后，`/` 是正则字面量开始而不是除号 */
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "do", "else", "case", "yield", "await", "throw",
]);

/**
 * 词法级去除注释(保留字符串/模板串/正则字面量原样)。
 * 块注释内的换行按数量保留,行注释止于换行前;其余字符替换为空格,
 * 保证输出行号与源文件一致且不合并相邻标识符。
 */
function stripComments(source: string, vue = false): string {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  let prevSignificant = "";
  let prevWasWord = false;

  const regexAllowed = (): boolean => {
    if (prevSignificant === "") return true;
    if (prevWasWord) return REGEX_KEYWORDS.has(prevSignificant);
    // 词、数字、右括号/右中括号/右花括号/点之后是除号;其余(操作符、开头)是正则
    if (/[0-9A-Za-z_$)\].]/.test(prevSignificant)) return false;
    return true;
  };

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // .vue 模板的 HTML 注释
    if (vue && ch === "<" && next === "!" && source.slice(i, i + 4) === "<!--") {
      const end = source.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      for (let k = i; k < stop; k++) out.push(source[k] === "\n" ? "\n" : " ");
      i = stop;
      continue;
    }

    // 字符串/模板字面量:整段原样复制
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out.push(ch);
      i += 1;
      while (i < n) {
        const c = source[i];
        out.push(c);
        if (c === "\\" && i + 1 < n) {
          out.push(source[i + 1]);
          i += 2;
          continue;
        }
        i += 1;
        if (c === quote) break;
      }
      prevSignificant = quote;
      prevWasWord = false;
      continue;
    }

    // 行注释:保留换行
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }

    // 块注释:按内部换行数量保留行结构
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out.push(source[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      i += 2;
      out.push(" ");
      continue;
    }

    // 正则字面量:整段原样复制(内部 `/*` 不得触发注释逻辑)
    if (ch === "/" && regexAllowed()) {
      out.push(ch);
      i += 1;
      let inClass = false;
      let terminated = false;
      while (i < n) {
        const c = source[i];
        if (c === "\\") {
          out.push(c, source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === "\n") break; // 未终结:当作除号路径已失败,按原样输出避免行号漂移
        out.push(c);
        i += 1;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          terminated = true;
          break;
        }
      }
      if (terminated) {
        // 复制 flags
        while (i < n && /[a-z]/.test(source[i])) {
          out.push(source[i]);
          i += 1;
        }
        prevSignificant = "/";
        prevWasWord = false;
        continue;
      }
      // 非正则(未终结):回退按普通字符处理
      continue;
    }

    if (/\s/.test(ch)) {
      out.push(ch);
      i += 1;
      continue;
    }

    // 标识符/数字:记录完整词,供正则判定与关键词判断
    if (/[0-9A-Za-z_$]/.test(ch)) {
      let word = "";
      while (i < n && /[0-9A-Za-z_$]/.test(source[i])) {
        word += source[i];
        out.push(source[i]);
        i += 1;
      }
      prevSignificant = word;
      prevWasWord = true;
      continue;
    }

    out.push(ch);
    prevSignificant = ch;
    prevWasWord = false;
    i += 1;
  }
  return out.join("");
}

function isVueFile(file: string): boolean {
  return file.endsWith(".vue");
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

const dirs =
  process.argv[2] === "--dir" ? [process.argv[3]] : SCAN_DIRS.map((d) => join(PKG, d));

for (const dir of dirs) {
  for (const file of collectFiles(dir)) {
    const stripped = stripComments(readFileSync(file, "utf8"), isVueFile(file));
    const rel = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
    const lines = stripped.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (FORBIDDEN_PATTERN.test(lines[i])) {
        violations.push({ file: rel, line: i + 1, text: lines[i].trim() });
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
