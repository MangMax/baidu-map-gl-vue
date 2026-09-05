#!/usr/bin/env node
/**
 * M0-01: 冻结 v2 公共 API Manifest
 *
 * 自动扫描 packages/ 下的公开入口:
 * - 根入口 packages/index.ts 的导出
 * - 组件列表 packages/components/index.ts
 * - hooks 导出 packages/hooks/index.ts
 * - utils 导出 packages/utils/index.ts
 * - 深路径(组件子目录 index.ts / index.vue)
 *
 * 输出 JSON 到 scripts/api-manifest.v2.json,并在脚本中提供校验模式
 * (--check),CI 可用来检测公共 API 漂移。
 *
 * 用法:
 *   node scripts/collect-api-manifest.mts           # 生成 manifest
 *   node scripts/collect-api-manifest.mts --check   # 校验无漂移(CI)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'scripts/api-manifest.v2.json')

function read(file: string): string {
  return readFileSync(resolve(root, file), 'utf-8')
}

function listDir(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      out = out.concat(listDir(rel))
    } else {
      out.push(rel)
    }
  }
  return out
}

interface ApiEntry {
  file: string
  exports: string[]
  kind: 'component' | 'hook' | 'util' | 'config' | 'entry'
}

const manifest: ApiEntry[] = []

/** 从 TS 文件里提取 `export` 语句的符号名(启发式,足够冻结 v2 基线) */
function extractExports(source: string): string[] {
  const names = new Set<string>()
  const re =
    /export\s+(?:declare\s+)?(?:type|interface|enum|const|let|var|function|class|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) names.add(m[1])
  // export { a, b } 形式
  const braces = /export\s*\{([^}]+)\}/g
  while ((m = braces.exec(source))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) names.add(name)
    }
  }
  // export default X / export default function X
  const def = /export\s+default\s+(?:function\s+)?([A-Za-z_$][\w$]*)?/
  const dm = def.exec(source)
  if (dm && dm[1]) names.add(`default:${dm[1]}`)
  else if (/export\s+default/.test(source)) names.add('default')
  return [...names].sort()
}

function scanDirectory(dir: string, kind: ApiEntry['kind']) {
  for (const file of listDir(dir)) {
    if (!/\.(ts|vue)$/.test(file)) continue
    if (/\.d\.ts$/.test(file)) continue
    if (/index\.vue$/.test(file) && file.includes('/map/')) continue
    const rel = relative(root, file)
    const source = read(file)
    const exports = extractExports(source)
    if (exports.length > 0) {
      manifest.push({ file: rel, exports, kind })
    }
  }
}

// 1) 根入口
const rootSource = read('packages/index.ts')
manifest.push({
  file: 'packages/index.ts',
  exports: extractExports(rootSource),
  kind: 'entry'
})

// 2) 组件(按 components/index.ts 的导出链接)
const componentsIndex = read('packages/components/index.ts')
const componentFiles = [
  ...componentsIndex.matchAll(/export\s+\*\s+from\s+'([^']+)'/g),
].map((m) => m[1])
for (const compDir of componentFiles) {
  const indexTs = resolve(root, 'packages/components', compDir, 'index.ts')
  if (existsSync(indexTs)) {
    manifest.push({
      file: relative(root, indexTs),
      exports: extractExports(read(indexTs)),
      kind: 'component'
    })
  } else {
    // 可能直接是 .vue
    const vueFile = resolve(root, 'packages/components', compDir, 'index.vue')
    if (existsSync(vueFile)) {
      manifest.push({
        file: relative(root, vueFile),
        exports: extractExports(read(vueFile)),
        kind: 'component'
      })
    }
  }
}

// 3) hooks 与 utils
scanDirectory('packages/hooks', 'hook')
scanDirectory('packages/utils', 'util')

// 4) 深路径导出(组件子目录里直接 export 的 index.ts)
// 由 components/index.ts 展开而来的 componentFiles 已覆盖;再补全组件目录下
// 没有 index.ts 但有 index.vue 的(如 map、marker 目录的深层结构)
for (const sub of ['map', 'overlay/marker', 'overlay/infowindow']) {
  const vueFile = resolve(root, 'packages/components', sub, 'index.vue')
  if (existsSync(vueFile)) {
    const rel = relative(root, vueFile)
    if (!manifest.find((e) => e.file === rel)) {
      manifest.push({
        file: rel,
        exports: extractExports(read(vueFile)),
        kind: 'component'
      })
    }
  }
}

const sorted = [...manifest].sort((a, b) => a.file.localeCompare(b.file))
const out = {
  version: '2.6.5',
  collectedAt: new Date().toISOString(),
  entries: sorted,
}

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('[api-manifest] manifest missing; run without --check first')
    process.exit(1)
  }
  const prev = JSON.parse(readFileSync(OUT, 'utf-8'))
  const a = JSON.stringify(prev.entries)
  const b = JSON.stringify(sorted)
  if (a !== b) {
    console.error('[api-manifest] PUBLIC API DRIFT detected. Run "node scripts/collect-api-manifest.mts" and commit the update.')
    process.exit(1)
  }
  console.log('[api-manifest] OK, no drift.')
  process.exit(0)
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`[api-manifest] wrote ${OUT} (${sorted.length} entries)`)
