/**
 * `typecheck:v3` CI 门禁回归（M3A0-BOUNDARY 衍生 / issue #50）
 *
 * `typecheck:v3` 曾因上游类型包的大小写引用缺陷被移出 CI（PR #49 只在原位留了 NOTE 注释），
 * 本次随补丁恢复（见 `v3-upstream-types-case-patch.test.ts` 与 ADR 2026-09-13）。
 *
 * 断言落在**真正的 step** 上：`expect(workflow).toContain("pnpm typecheck:v3")` 会被那段
 * NOTE 注释满足，等于空转；因此这里先切出 `quality` job 段（`v3` job 里也有 build，
 * 跨 job 取首个匹配会把顺序断言弄错），再逐行解析。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(
  resolve(import.meta.dirname, "../../.github/workflows/quality.yml"),
  "utf8",
);

/** 按缩进切出某个 job 的原文（从 `  <name>:` 到下一个同级 key 之前）。 */
function jobSection(name: string): { text: string; lines: string[] } {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return { text: "", lines: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end);
  return { text: section.join("\n"), lines: section };
}

const quality = jobSection("quality");

function stepLineIndex(lines: string[], command: string): number {
  return lines.findIndex((line) => new RegExp(`^\\s*run:\\s*${command}\\s*$`).test(line));
}

describe("quality job 的 typecheck:v3 门禁（issue #50）", () => {
  it("能定位到 quality job 段（否则后面的断言都是空转）", () => {
    expect(quality.lines.length, "quality.yml 里找不到 quality job").toBeGreaterThan(0);
  });

  it("以可执行 step 的形式恢复了 typecheck:v3", () => {
    expect(
      stepLineIndex(quality.lines, "pnpm typecheck:v3"),
      "quality job 里没有 `run: pnpm typecheck:v3` 这个 step（注释里提到不算）",
    ).toBeGreaterThan(-1);
  });

  it("该 step 没有被 if / continue-on-error 之类开关架空", () => {
    const index = stepLineIndex(quality.lines, "pnpm typecheck:v3");
    expect(index).toBeGreaterThan(-1);
    // step 块（run 行往前两行含 `- name:`，往后两行收住多行 run）
    const stepBlock = quality.lines.slice(Math.max(0, index - 2), index + 3).join("\n");
    expect(stepBlock, "typecheck:v3 的 step 被条件或容错开关架空").not.toMatch(
      /(^|\s)(if|continue-on-error):/m,
    );
  });

  it("typecheck:v3 排在 build:v3 之前（它在 dist 里 emit 声明，放在 build 之后会得到假失败）", () => {
    const typecheckIndex = stepLineIndex(quality.lines, "pnpm typecheck:v3");
    const buildIndex = stepLineIndex(
      quality.lines,
      "node --experimental-strip-types scripts/build-v3\\.mts",
    );
    expect(typecheckIndex).toBeGreaterThan(-1);
    expect(buildIndex, "quality job 里找不到 build:v3 步骤").toBeGreaterThan(-1);
    expect(typecheckIndex).toBeLessThan(buildIndex);
  });
});
