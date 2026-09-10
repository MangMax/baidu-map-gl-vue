import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  extractJsapiV4Augmentation,
  stripJsapiV4Augmentation,
} from "../../packages/baidu-map-gl-vue/vite.config.build";

const boundaryPath = resolve(
  import.meta.dirname,
  "../../packages/baidu-map-gl-vue/src/driver/jsapi-v4/types-reference.d.ts",
);

/**
 * 复刻 unplugin-dts 收集全局 augmentation 的方式：
 * `declareModules.push(s.slice(node.pos, node.end + 1))`，即块末尾只多带一个字符
 * （LF 文件为 `\n`，CRLF 文件为 `\r`）。
 */
function collectInlinedAugmentation(source: string, newline: "\n" | "\r\n"): string {
  const normalized = newline === "\n" ? source : source.replace(/\r?\n/g, "\r\n");
  const ast = ts.createSourceFile("types-reference.d.ts", normalized, ts.ScriptTarget.Latest, true);
  let collected = "";
  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) {
      if (ts.isIdentifier(node.name) && node.name.escapedText === "global") {
        collected += normalized.slice(node.pos, node.end + 1);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(ast, visit);
  return collected;
}

describe("jsapi-v4 declaration augmentation filtering", () => {
  const lfSource = readFileSync(boundaryPath, "utf8");

  for (const [label, newline] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ] as const) {
    it(`removes the augmentation inlined from a ${label} boundary file`, () => {
      const source = newline === "\n" ? lfSource : lfSource.replace(/\r?\n/g, "\r\n");
      const augmentation = extractJsapiV4Augmentation(source);
      expect(augmentation).toContain("namespace BMap");
      expect(augmentation.endsWith("}")).toBe(true);

      const inlined = collectInlinedAugmentation(lfSource, newline);
      expect(inlined).toContain("namespace BMap");

      const publicDts = `export declare const version: string\n${inlined}`;
      const stripped = stripJsapiV4Augmentation(publicDts, augmentation);

      expect(stripped).toBeDefined();
      expect(stripped).not.toContain("namespace BMap");
      expect(stripped).not.toContain("declare global");
      expect(stripped).toBe("export declare const version: string\n");
    });
  }

  it("leaves declaration output untouched when the augmentation is absent", () => {
    expect(stripJsapiV4Augmentation("export declare const x: number\n", "")).toBeUndefined();
    expect(
      stripJsapiV4Augmentation("export declare const x: number\n", "declare global {}"),
    ).toBeUndefined();
  });
});
