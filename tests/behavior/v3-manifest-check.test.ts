/**
 * `generate-manifest-artifacts --check` 必须是只读校验
 *
 * 回归背景：此前 `--check` 会先把生成内容写盘，再读取刚写出的文件做比对，
 * 因此永远「无漂移」——是一道失效门禁，同时还会刷新
 * `docs/.vitepress/component-index.json` 的 `generatedAt`，污染工作树。
 *
 * 这里断言 `--check` 运行前后三个生成文件**逐字节不变**：旧行为会因为
 * 重写 `generatedAt` 而失败，因此本测试能钉住修复。
 * 漂移检出能力由脚本自身的只读比对保证（已在评审中人工注入漂移验证）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/generate-manifest-artifacts.mts");

const GENERATED_FILES = [
  "packages/baidu-map-gl-vue/src/components/index.ts",
  "packages/baidu-map-gl-vue/volar.d.ts",
  "docs/.vitepress/component-index.json",
] as const;

describe("generate-manifest-artifacts --check", () => {
  it("`--check` 通过时逐字节不改动生成文件（只读校验）", () => {
    const before = GENERATED_FILES.map((rel) => readFileSync(resolve(ROOT, rel), "utf8"));

    expect(() =>
      execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, "--check"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).not.toThrow();

    const after = GENERATED_FILES.map((rel) => readFileSync(resolve(ROOT, rel), "utf8"));
    for (const [i, rel] of GENERATED_FILES.entries()) {
      expect(after[i], `${rel} 不应被 --check 改写`).toBe(before[i]);
    }
  });
});
