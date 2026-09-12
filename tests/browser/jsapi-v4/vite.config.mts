/**
 * 浏览器 smoke 的 Vite 配置（由 `run.mts` 用程序化 API 启动）
 *
 * `root` 指向本目录，因此页面直接驱动组件库**源码**（`@pkg`）；Fake v4 经 `@fake-v4`
 * 单独指向 `packages/test-utils/fake-bmap-v4`——**不能**别名到 `packages/test-utils/index.ts`，
 * 那条桶文件会连带拉进 `driver-matrix.ts`，而它 `import "vitest"`，浏览器里加载不了
 * （同一坑见 `packages/test-utils/facet-probes.ts` 的模块注释）。
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue()],
  resolve: {
    alias: {
      "@pkg": resolve(repoRoot, "packages/baidu-map-gl-vue/src"),
      "@fake-v4": resolve(repoRoot, "packages/test-utils/fake-bmap-v4/index.ts"),
    },
  },
  server: {
    // 用 `localhost` 而不是 `127.0.0.1`：百度 AK 的 Referer 白名单按主机名匹配，
    // 本机 AK 放行的是 `localhost`（实测两者不等价）。
    host: "localhost",
    // 端口交给内核分配：`resolvedUrls` 里拿到真实端口，避免与本地 dev server 抢 5199
    port: 0,
    strictPort: false,
  },
  logLevel: "warn",
});
