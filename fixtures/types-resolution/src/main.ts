import type { Vue3BaiduMapGlOptions } from 'vue3-baidu-map-gl'
import { usePoint, useDefaultMarkerIcons, BMap } from 'vue3-baidu-map-gl'

// bundler 解析:类型可找到
export const opts: Vue3BaiduMapGlOptions = { ak: 'x' }
export const p = usePoint()
export const counter = { component: BMap }
export const icons = useDefaultMarkerIcons()
