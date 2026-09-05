import { shallowRef } from 'vue'
import { BMap, BMarker } from 'vue3-baidu-map-gl'

const center = shallowRef({ lng: 116.4, lat: 39.9 })

// 按需导入 smoke
export const App = {
  setup() {
    return () => null
  },
  components: { BMap, BMarker },
}
