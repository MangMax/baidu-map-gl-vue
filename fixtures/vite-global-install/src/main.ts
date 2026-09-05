import { createApp } from 'vue'
import Vue3BaiduMapGl from 'vue3-baidu-map-gl'

// app.use() 全量安装 smoke
export function setupApp() {
  const app = createApp({ template: '<div />' })
  app.use(Vue3BaiduMapGl, {
    ak: 'test-ak',
  })
  return app
}
