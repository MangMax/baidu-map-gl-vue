import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // playground 直接引用 v3 源码(clean checkout 免预构建)
      'baidu-map-gl-vue': resolve(import.meta.dirname, '../../packages/baidu-map-gl-vue/src/index.ts'),
      // 只别名到 fake 的**具体模块**，不要指向 test-utils 的桶文件：桶文件会拉进
      // driver-matrix.ts，而它 import "vitest"，浏览器里加载不了。
      '@test-utils-v4': resolve(import.meta.dirname, '../../packages/test-utils/fake-bmap-v4/index.ts'),
    },
  },
})
