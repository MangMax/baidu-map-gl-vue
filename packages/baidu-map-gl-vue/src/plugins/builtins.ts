/**
 * 内置插件 definitions
 *
 * 将 v2 的字符串插件配置迁移为 typed plugin definitions。
 *
 * 每个内置插件:
 * - 锁定明确版本 URL,不使用浮动 unpkg latest
 * - 加载后就绪,可被 whenPlugin(name) 取到
 */
import type { BMapPluginDefinition } from "../core/plugins/PluginRegistry";

export interface PluginLoader {
  (src: string, exportName: string): Promise<unknown>;
}

/** 从 URL 加载脚本并返回全局导出 */
export function urlPluginDefinition<T>(
  name: string,
  url: string,
  exportGetter: () => unknown,
  options: { required?: boolean; scope?: "global" | "map"; dependencies?: readonly string[] } = {},
): BMapPluginDefinition<T> {
  return {
    name,
    scope: options.scope ?? "global",
    required: options.required ?? false,
    dependencies: options.dependencies,
    async load(_context, signal) {
      if (signal?.aborted) {
        throw new Error(`plugin "${name}" aborted`);
      }
      // 简单 script 加载(生产应经 ScriptLoader 实现 timeout/SRI)
      const exported = await loadScriptWithExport(url, exportGetter, signal);
      return exported as T;
    },
  };
}

function loadScriptWithExport(
  url: string,
  exportGetter: () => unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("plugin load requires a browser environment"));
      return;
    }
    if (signal?.aborted) {
      reject(new Error("plugin aborted"));
      return;
    }
    const existing = exportGetter();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    // MapVGL bundles inject Baidu analytics scripts, which can be blocked by browser extensions.
    (window as any)._disable_hmt = true;
    script.async = true;
    script.onload = () => {
      const exported = exportGetter();
      if (exported) resolve(exported);
      else reject(new Error(`plugin did not expose export: ${url}`));
    };
    script.onerror = () => reject(new Error(`failed to load plugin: ${url}`));
    if (url.includes("mapvgl")) {
      fetch(url)
        .then((response) => response.text())
        .then((source) => {
          // MapVGL injects analytics on load; extensions commonly block that request.
          script.textContent = source.replace(
            /window\._disable_hmt\|\|\(window\._hmt[\s\S]*?\}\(\)\);?/g,
            "",
          );
          document.body.appendChild(script);
          const exported = exportGetter();
          if (exported) resolve(exported);
          else reject(new Error(`plugin did not expose export: ${url}`));
        })
        .catch(() => reject(new Error(`failed to load plugin: ${url}`)));
    } else {
      script.src = url;
      document.body.appendChild(script);
    }
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          script.remove();
          reject(new Error("plugin aborted"));
        },
        { once: true },
      );
    }
  });
}

// 内置插件 URL(锁定版本,不用 latest)
export const BUILTIN_PLUGIN_URLS = {
  trackAnimation:
    "https://mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js",
  drawingManager:
    "https://mapopen.bj.bcebos.com/github/BMapGLLib/DrawingManager/src/DrawingManager.min.js",
  geoUtils: "https://mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js",
  mapvgl: "https://unpkg.com/mapvgl@1.0.0-beta.188/dist/mapvgl.min.js",
} as const;

/** TrackAnimation 插件:暴露 window.BMapGLLib.TrackAnimation */
export function trackAnimationPlugin(): BMapPluginDefinition<unknown> {
  return urlPluginDefinition(
    "TrackAnimation",
    BUILTIN_PLUGIN_URLS.trackAnimation,
    () => (window as any).BMapGLLib?.TrackAnimation,
    { required: true },
  );
}

/** Mapvgl 插件:暴露 window.mapvgl */
export function mapVglPlugin(): BMapPluginDefinition<unknown> {
  return urlPluginDefinition("Mapvgl", BUILTIN_PLUGIN_URLS.mapvgl, () => (window as any).mapvgl, {
    required: false,
  });
}

/** DrawingManager 插件:暴露 window.BMapGLLib.DrawingManager */
export function drawingManagerPlugin(): BMapPluginDefinition<unknown> {
  return urlPluginDefinition(
    "DrawingManager",
    BUILTIN_PLUGIN_URLS.drawingManager,
    () => (window as any).BMapGLLib?.DrawingManager,
    { required: false },
  );
}

/** 兼容旧 plugins: string[] 配置 → plugin definitions */
export function stringToPluginDefinitions(names: string[]): BMapPluginDefinition<unknown>[] {
  return names.map((name) => {
    const map: Record<string, () => BMapPluginDefinition<unknown>> = {
      TrackAnimation: trackAnimationPlugin,
      Mapvgl: mapVglPlugin,
      DrawingManager: drawingManagerPlugin,
    };
    if (map[name]) return map[name]();
    // 未知插件:optional,避免阻断
    return { name, required: false, load: async () => undefined } as BMapPluginDefinition<unknown>;
  });
}
