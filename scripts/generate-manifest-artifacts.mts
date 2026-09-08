#!/usr/bin/env node
/**
 * M7-01: 从 manifest 生成公开人工产物
 *
 * 生成:
 * - packages/baidu-map-gl-vue/src/components/index.ts(确保与 manifest 一致)
 * - packages/baidu-map-gl-vue/volar.d.ts(Volar GlobalComponents)
 * - docs/.vitepress/component-index.json(文档组件索引)
 *
 * 生成文件顶部带 "Generated file. Do not edit directly."
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestSrc = resolve(root, 'packages/baidu-map-gl-vue/src/manifest.ts')

// 动态加载 manifest(纯数据 .ts,node --experimental-strip-types 可解析;
// 避免正则对 oxfmt 格式化后的多行/双引号格式敏感)
const { componentManifest } = (await import(manifestSrc + '?t=' + Date.now())) as {
  componentManifest: { name: string; exportName: string }[]
}
const names = componentManifest.map((c) => ({ name: c.name, exportName: c.exportName }))

// 1) components/index.ts
const componentsIndex = [
  '// Generated file. Do not edit directly.',
  ...names.map((c) => `export { default as ${c.exportName} } from './${toPath(c.exportName)}'`),
  '',
].join('\n')
writeFileSync(resolve(root, 'packages/baidu-map-gl-vue/src/components/index.ts'), componentsIndex)

// 2) volar.d.ts(精确类型:Volar 通过 typeof import 解析组件真实 props/emits)
//    vue-tsc 2(新 Volar)读 module 'vue';v2 时代读 '@vue/runtime-core';双声明兼容
const componentsLines = names.map((c) => `    ${c.name}: typeof import('baidu-map-gl-vue')['${c.name}']`)
const volarDts = [
  '// Generated file. Do not edit directly.',
  'declare module \'vue\' {',
  '  export interface GlobalComponents {',
  ...componentsLines,
  '  }',
  '}',
  'declare module \'@vue/runtime-core\' {',
  '  export interface GlobalComponents {',
  ...componentsLines,
  '  }',
  '}',
  'export {}',
  '',
].join('\n')
writeFileSync(resolve(root, 'packages/baidu-map-gl-vue/volar.d.ts'), volarDts)

// 3) component index json
const json = { version: '3.0.0-beta.0', generatedAt: new Date().toISOString(), components: names.map((c) => c.name) }
writeFileSync(resolve(root, 'docs/.vitepress/component-index.json'), JSON.stringify(json, null, 2) + '\n')

console.log(`[generate-manifest] ${names.length} components`)
console.log(`  wrote src/components/index.ts`)
console.log(`  wrote volar.d.ts`)
console.log(`  wrote docs/.vitepress/component-index.json`)
console.log('  CHECK MODE: run with --check to verify no drift')

// --check 模式
if (process.argv.includes('--check')) {
  const current = readFileSync(resolve(root, 'packages/baidu-map-gl-vue/src/components/index.ts'), 'utf-8')
  if (current !== componentsIndex) {
    console.error('[generate-manifest] DRIFT in components/index.ts')
    process.exit(1)
  }
  const currentDts = existsSync(resolve(root, 'packages/baidu-map-gl-vue/volar.d.ts'))
    ? readFileSync(resolve(root, 'packages/baidu-map-gl-vue/volar.d.ts'), 'utf-8')
    : ''
  if (currentDts !== volarDts) {
    console.error('[generate-manifest] DRIFT in volar.d.ts')
    process.exit(1)
  }
  console.log('[generate-manifest] OK, no drift.')
}

function toPath(exportName: string): string {
  const map: Record<string, string> = {
    BMap: 'map/BMap.vue',
    BMarker: 'overlays/BMarker.vue',
    BInfoWindow: 'overlays/BInfoWindow.vue',
    BCircle: 'overlays/BCircle.vue',
    BPolyline: 'overlays/BPolyline.vue',
    BPolygon: 'overlays/BPolygon.vue',
    BLabel: 'overlays/BLabel.vue',
    BContextMenu: 'overlays/BContextMenu.vue',
    BPrism: 'overlays/BPrism.vue',
    BGroundOverlay: 'overlays/BGroundOverlay.vue',
    BBezierCurve: 'overlays/BBezierCurve.vue',
    BMapMask: 'overlays/BMapMask.vue',
    BMarker3d: 'overlays/BMarker3d.vue',
    BAutoComplete: 'autocomplete/BAutoComplete.vue',
    BPanoramaControl: 'controls/BPanoramaControl.vue',
    BControl: 'controls/BControl.vue',
    BPointLayer: 'data/BPointLayer.vue',
    BMarkerList: 'data/BMarkerList.vue',
    BMarkerCluster: 'data/BMarkerCluster.vue',
    BZoom: 'controls/BZoom.vue',
    BScale: 'controls/BScale.vue',
    BCityList: 'controls/BCityList.vue',
    BLocation: 'controls/BLocation.vue',
    BNavigation3d: 'controls/BNavigation3d.vue',
    BCopyright: 'controls/BCopyright.vue',
    BDistrictLayer: 'layers/BDistrictLayer.vue',
    BPanoramaCoverageLayer: 'layers/BPanoramaCoverageLayer.vue',
  }
  return map[exportName] ?? exportName
}
