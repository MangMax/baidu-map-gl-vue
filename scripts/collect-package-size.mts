#!/usr/bin/env node
/**
 * M0-06: 记录包体积基线
 *
 * 扫描发布产物(es + dist),统计各入口文件体积,输出 JSON 到
 * scripts/package-size-baseline.v2.json。
 * CI 用它对比 v3 重建后的体积,防止无界膨胀。
 *
 * 用法:
 *   node scripts/collect-package-size.mts
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'scripts/package-size-baseline.v2.json')

function walk(dir: string): { file: string; bytes: number }[] {
  let out: { file: string; bytes: number }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out = out.concat(walk(p))
    else if (entry.isFile()) out.push({ file: p, bytes: statSync(p).size })
  }
  return out
}

function summarize(dir: string) {
  const files = walk(resolve(root, dir))
  const total = files.reduce((acc, f) => acc + f.bytes, 0)
  const gzipEstimate = Math.round(total / 4) // 粗估,实际 gzip 由 CI 算
  return { entries: files.length, bytes: total, gzipEstimate }
}

const result = {
  version: '2.6.5',
  collectedAt: new Date().toISOString(),
  es: summarize('es'),
  dist: summarize('dist'),
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(`[package-size] wrote ${OUT}`)
console.log(`  es:   ${result.es.entries} files, ${(result.es.bytes / 1024).toFixed(1)} KB`)
console.log(`  dist: ${result.dist.entries} files, ${(result.dist.bytes / 1024).toFixed(1)} KB`)
