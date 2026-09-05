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
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)

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
      // 不生成多余 .test.d.ts
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
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
