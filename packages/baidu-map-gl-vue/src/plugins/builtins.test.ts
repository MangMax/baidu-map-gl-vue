import { describe, it, expect } from "vitest";
import { stringToPluginDefinitions, trackAnimationPlugin, urlPluginDefinition } from "./builtins";

describe("plugin definitions", () => {
  it("converts legacy string[] config to plugin definitions", () => {
    const defs = stringToPluginDefinitions(["TrackAnimation", "Mapvgl", "UnknownPlugin"]);
    expect(defs[0].name).toBe("TrackAnimation");
    expect(defs[0].required).toBe(true);
    expect(defs[1].name).toBe("Mapvgl");
    // 未知插件 optional,不阻断
    expect(defs[2].name).toBe("UnknownPlugin");
    expect(defs[2].required).toBe(false);
  });

  it("trackAnimationPlugin exposes name and required true", () => {
    const def = trackAnimationPlugin();
    expect(def.name).toBe("TrackAnimation");
    expect(def.required).toBe(true);
  });

  it("urlPluginDefinition resolves existing global export without loading script", async () => {
    // 预置全局导出,避免真正请求网络
    (window as any).__fakePlugin = { v: 1 };
    const def = urlPluginDefinition(
      "Fake",
      "https://example.com/x.js",
      () => (window as any).__fakePlugin,
    );
    const res = await def.load({ api: {}, map: {}, client: null } as any);
    expect(res).toEqual({ v: 1 });
    delete (window as any).__fakePlugin;
  });

  it("urlPluginDefinition rejects when export missing after (mock) load", async () => {
    const def = urlPluginDefinition("Missing", "https://example.com/x.js", () => undefined);
    // 无全局导出且无 script 环境,应 reject
    await expect(def.load({ api: {}, map: {}, client: null } as any)).rejects.toThrow();
  });
});
