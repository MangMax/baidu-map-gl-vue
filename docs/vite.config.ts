import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig(() => {
  return {
    optimizeDeps: {
      exclude: ['@vueuse/core', 'vitepress']
    },
    server: {
      fs: {
        allow: ['..']
      }
    },
    resolve: {
      alias: {
        // docs 是 v2 站点:vue3-baidu-map-gl 解析到 v2 源码(根已为 workspace root)
        'vue3-baidu-map-gl': resolve(import.meta.dirname, '../packages/index.ts'),
      },
    },
  }
})
