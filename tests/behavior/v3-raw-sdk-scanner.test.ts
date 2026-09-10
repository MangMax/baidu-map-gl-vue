/**
 * raw SDK 扫描门禁自测
 *
 * 覆盖词法歧义回归（AST 解析应从根因上消除）:
 * - 正向:正则字面量/控制语句后的真实 SDK 访问必须被拦截,含 `.vue` SFC 与 `window["BMapGL"]`
 * - 负向:注释、正则、普通字符串中的 BMapGL 不得误报,干净目录必须放行
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/check-raw-sdk.mts");

interface ScanResult {
  code: number;
  output: string;
}

function scanDir(dir: string): ScanResult {
  try {
    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, "--dir", dir],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "raw-sdk-scan-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("check-raw-sdk scanner", () => {
  it("正则字面量后的真实 SDK 访问被拦截(PR #47 首轮审查样例)", () => {
    const dir = makeFixture({
      "repro.ts": "const punctuation = /[/*]/;\nconst sdk = window.BMapGL;\n",
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("window.BMapGL");
  });

  it("`/[//]/` 同行之后的 SDK 访问被拦截", () => {
    const dir = makeFixture({
      "inline.ts": "const re = /[//]+/; const sdk = window.BMapGL;\n",
    });
    expect(scanDir(dir).code).toBe(1);
  });

  it("if/while/for 条件后的正则不再吞掉后续 SDK 访问(PR #47 复审样例)", () => {
    const dir = makeFixture({
      "ifcase.ts": 'if (true) /[/*]/.test("x");\nconst sdk = window.BMapGL;\n',
      "ifinline.ts": 'if (true) /[//]+/.test("x"); const sdk = window.BMapGL;\n',
      "whilecase.ts": 'while (false) /[/*]/.test("x");\nconst sdk = globalThis.BMapGL;\n',
      "forcase.ts": "for (let i = 0; i < 1; i++) /[/*]/.test(\"x\");\nconst sdk = new BMapGL.Map();\n",
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("ifcase.ts:2");
    expect(r.output).toContain("ifinline.ts:1");
    expect(r.output).toContain("whilecase.ts:2");
    expect(r.output).toContain("forcase.ts:2");
  });

  it(".vue 的 <script setup> 中控制语句后的 SDK 访问被拦截(行号映射回源文件)", () => {
    const dir = makeFixture({
      "Comp.vue": [
        '<script setup lang="ts">',
        'if (true) /[/*]/.test("x");',
        "const sdk = window.BMapGL;",
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Comp\.vue:3/);
  });

  it("结束标签带空白(`</script >` / 标签名后换行)仍能提取脚本并拦截(PR #47 三审样例)", () => {
    const dir = makeFixture({
      "EndSpace.vue": [
        '<script setup lang="ts">',
        "const sdk = window.BMapGL;",
        "</script >",
        "<template><div/></template>",
      ].join("\n"),
      "EndNewline.vue": [
        '<script setup lang="ts">',
        "const sdk = window.BMapGL;",
        "</script",
        ">",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/EndSpace\.vue:2/);
    expect(r.output).toMatch(/EndNewline\.vue:2/);
  });

  it("起始标签 generic 属性值内的 `>` 不再截断脚本内容(同行脚本仍被拦截)", () => {
    const dir = makeFixture({
      "Generic.vue": [
        '<script setup lang="ts" generic="T extends Record<string, unknown>">const sdk = window.BMapGL;',
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Generic\.vue:1/);
  });

  it("HTML 注释中的脚本示例不误报(官方 SFC 解析忽略注释)", () => {
    const dir = makeFixture({
      "Comment.vue": [
        '<script setup lang="ts">',
        "const ok = 1;",
        "</script>",
        "<template>",
        "  <!-- <script>const sdk = window.BMapGL;</script> -->",
        "  <div/>",
        "</template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("scan OK");
  });

  it("无法解析的 SFC 明确报错退出,不按无违规静默放行", () => {
    const dir = makeFixture({
      "Unclosed.vue": '<script setup lang="ts">\nconst sdk = 1\n',
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("unparsable input");
    expect(r.output).toContain("Unclosed.vue");
  });

  it("window['BMapGL'] 动态访问按越界拦截", () => {
    const dir = makeFixture({ "dynamic.ts": 'const sdk = window["BMapGL"];\n' });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('window["BMapGL"]');
  });

  it("注释、正则与普通字符串中的 BMapGL 不误报,干净代码放行", () => {
    const dir = makeFixture({
      "clean.ts": [
        "// 文档注释提及 window.BMapGL",
        "/* 块注释里的 BMapGL */",
        'const msg = "resolving global BMapGL fallback";',
        "const re = /[/*]+/;",
        'if (true) /[//]+/.test("x");',
        "const half = total / 2;",
        "const word = a / b;",
        "export const x = 1;",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("scan OK");
  });

  it("报错行号与源文件行号一致(不因解析偏移漂移)", () => {
    const dir = makeFixture({
      "lines.ts": [
        "/*",
        " * 跨行块注释",
        " */",
        "const ok = /[/*]/;",
        "",
        "const leak = window.BMapGL;",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/lines\.ts:6/);
  });
});
