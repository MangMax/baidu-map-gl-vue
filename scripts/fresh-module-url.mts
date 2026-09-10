/**
 * 模块 URL 工具（供需要按路径动态 import 的脚本使用）
 *
 * 为什么不能直接拼字符串：`await import(path + "?t=" + Date.now())` 在 Windows 上会
 * 得到 `C:\...\catalog.ts?t=...`，Node 的 ESM 加载器会以
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME (Received protocol 'c:')` 拒绝执行。
 *
 * `pathToFileURL()` 会先转成合法的 `file:` URL，再用 `searchParams` 追加 cache-bust
 * 查询参数；这样也能正确处理路径中的 `#`、`%`、空格等字符——直接拼接时它们会被
 * 误当成 URL 片段或转义序列。
 */
import { pathToFileURL } from "node:url";

/** 生成带 cache-bust 参数的 `file:` URL 字符串，可直接传给 `import()`。 */
export function freshModuleUrl(filePath: string, stamp: number | string = Date.now()): string {
  const url = pathToFileURL(filePath);
  url.searchParams.set("t", String(stamp));
  return url.href;
}
