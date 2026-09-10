/**
 * v3 包 ESM 构建(Vite library mode + vite-plugin-dts)
 *
 * 主要产出:
 * - dist/*.mjs(ESM,external vue,单入口独立 chunk)
 * - dist/*.d.ts(vite-plugin-dts,基于 vue-tsc 2,rollupTypes 打包消除 .vue 引用)
 *
 * 声明与产物结构对齐(node16 ESM 可解析):
 * - dist/index.mjs      ↔ dist/index.d.ts
 * - dist/components.mjs ↔ dist/components.d.ts
 * - 子 chunk 的声明随源码结构输出(消费端用 resolvers 指向聚合入口)
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)

/**
 * 从类型边界文件源码中提取会被打包内联的 `declare global` augmentation 块。
 *
 * 上游 unplugin-dts 用 `s.slice(node.pos, node.end + 1)` 收集该块，只会额外带上
 * `}` 后的一个字符（LF 文件是 `\n`，CRLF 文件是 `\r`），所以这里必须 `trimEnd()`
 * 去掉末尾换行，才能同时匹配 LF 与 CRLF 源文件。
 */
export function extractJsapiV4Augmentation(source: string): string {
  const start = source.lastIndexOf('declare global {')
  return start === -1 ? '' : source.slice(start).trimEnd()
}

/** 从声明产物中剔除 augmentation 块；返回 `undefined` 表示无需修改。 */
export function stripJsapiV4Augmentation(
  content: string,
  augmentation: string,
): string | undefined {
  if (!augmentation || !content.includes(augmentation)) return undefined
  return `${content.replace(augmentation, '').trimEnd()}\n`
}

// 类型边界补丁只服务类型检查与 TS 声明 emit，必须保留在声明构建的 Program 中；
// 但 API Extractor 会把 Program 内的全局 augmentation 内联进每个公共 dist/*.d.ts，
// 因此在写入阶段从公共声明里剔除该 augmentation 块，避免向消费者泄漏 BMap.*。
const jsapiV4TypesReference = resolve(root, 'src/driver/jsapi-v4/types-reference.d.ts')
const jsapiV4Augmentation = extractJsapiV4Augmentation(readFileSync(jsapiV4TypesReference, 'utf8'))

export default defineConfig({
  plugins: [
    vue(),
    dts({
      // vue-tsc 引擎(2.x,专用 devDep)
      tsconfigPath: resolve(root, 'tsconfig.build.json'),
      // 声明输出到 dist 顶层(与 *.mjs 对齐)
      outDir: resolve(root, 'dist'),
      entryRoot: resolve(root, 'src'),
      // bundleTypes:打包声明为单文件,消除跨文件相对引用(node16 可解析)
      bundleTypes: {
        bundledPackages: ['mitt'],
      },
      // 不生成多余 .test.d.ts。类型边界 augmentation 保留在编译输入中，
      // 仅在写入阶段移除：跳过其独立声明，并从被打包内联的公共声明里剔除。
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      beforeWriteFile: (filePath, content) => {
        if (filePath.endsWith('driver/jsapi-v4/types-reference.d.ts')) return false
        const stripped = stripJsapiV4Augmentation(content, jsapiV4Augmentation)
        if (stripped !== undefined) return { content: stripped }
      },
      // 保留声明与源码结构对应,便于调试
      copyDtsFiles: true,
      insertTypesEntry: true,
      cleanVueFileName: true,
      afterBuild: () => {
        // no-op
      },
    }),
  ],
  define: {
    __DEV__: 'false',
    __VERSION__: JSON.stringify('3.0.0-beta.0'),
  },
  build: {
    lib: {
      entry: {
        index: resolve(root, 'src/index.ts'),
        components: resolve(root, 'src/components/index.ts'),
        composables: resolve(root, 'src/composables/index.ts'),
        plugins: resolve(root, 'src/plugins/index.ts'),
        resolver: resolve(root, 'src/resolver/index.ts'),
        core: resolve(root, 'src/core/index.ts'),
        advanced: resolve(root, 'src/advanced.ts'),
      },
      formats: ['es'],
    },
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      external: ['vue'],
      output: {
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
      },
    },
  },
})
