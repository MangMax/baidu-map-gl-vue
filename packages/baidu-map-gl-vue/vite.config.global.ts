/**
 * v3 包 CDN/global 构建(方案 §6.3 / M7-08)
 *
 * 独立单入口 iife 构建:
 * - dist/index.global.js(window.Vue3BaiduMapGl)
 * - Vue 完全 external,消费 window.Vue
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)

export default defineConfig({
  plugins: [vue()],
  define: {
    __DEV__: 'false',
    __VERSION__: JSON.stringify('3.0.0-beta.0'),
  },
  build: {
    lib: {
      entry: resolve(root, 'src/index.ts'),
      name: 'Vue3BaiduMapGl',
      formats: ['iife'],
      fileName: () => 'index.global.js',
    },
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
})
