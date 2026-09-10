/**
 * raw SDK 扫描门禁自测
 *
 * 覆盖两类回归:
 * - 正向:正则字面量(含 `/*` 的 `/[/*]/`)之后的真实 SDK 访问必须被拦截
 * - 负向:注释/字符串/正则中的 BMapGL 不得触发误报,干净目录必须放行
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

describe("check-raw-sdk scanner", () => {
  let dir: string;
  let cleaned = false;

  function makeFixture(files: Record<string, string>): string {
    if (dir && cleaned) rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "raw-sdk-scan-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  it("正则字面量内的 /* 不得吞掉其后的真实 SDK 访问(回归:PR #47 审查样例)", () => {
    const d = makeFixture({
      "repro.ts": "const punctuation = /[/*]/;\nconst sdk = window.BMapGL;\n",
    });
    const r = scanDir(d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("window.BMapGL");
  });

  it("`/[//]/` 正则同一行之后的 SDK 访问同样被拦截", () => {
    const d = makeFixture({
      "inline.ts": "const re = /[//]+/; const sdk = window.BMapGL;\n",
    });
    const r = scanDir(d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("window.BMapGL");
  });

  it("注释与正则中的 BMapGL 不误报,干净代码放行", () => {
    const d = makeFixture({
      "clean.ts": [
        "// 提及 window.BMapGL 的文档注释",
        "/* 块注释里的 BMapGL */",
        "const re = /[/*]+/;",
        "const half = total / 2;",
        "const word = a / b;",
        "export const x = 1;",
      ].join("\n"),
    });
    const r = scanDir(d);
    expect(r.code).toBe(0);
    expect(r.output).toContain("scan OK");
  });

  it("字符串字面量中的 BMapGL 仍按越界拦截(覆盖 window['BMapGL'] 动态访问)", () => {
    const d = makeFixture({
      "string.ts": 'const msg = "resolving global BMapGL fallback";\n',
    });
    const r = scanDir(d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("BMapGL");
  });

  it("报错行号与源文件行号一致(不因注释剥离漂移)", () => {
    const d = makeFixture({
      "lines.ts": [
        "/*",
        " * 跨行块注释",
        " */",
        "const ok = /[/*]/;",
        "",
        "const leak = window.BMapGL;",
      ].join("\n"),
    });
    const r = scanDir(d);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/lines\.ts:6 -> /);
  });
});
