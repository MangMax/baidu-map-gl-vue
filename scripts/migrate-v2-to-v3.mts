#!/usr/bin/env node
/**
 * M7-03: v2 → v3 最小 codemod / 迁移脚本
 *
 * 处理(方案 §18.3):
 * 1. `@initd` → `@ready`(Vue 模板事件)
 * 2. `getScriptAsync` / `usePubSub` 从主入口 import → 提示改用 legacy/context
 * 3. 深路径 import `baidu-map-gl-vue/es/...` → 根入口(明确子路径提示)
 * 4. 旧 `app.use(Vue3BaiduMapGl, { ... })` → `createBMapPlugin({ ... })`
 *
 * 用法:
 *   node --experimental-strip-types scripts/migrate-v2-to-v3.mts <files...> [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))

interface MigrationResult {
  out: string
  replacements: number
  warnings: string[]
}

function migrate(source: string): MigrationResult {
  let out = source
  let replacements = 0
  const warnings: string[] = []

  // 1. @initd → @ready(模板事件)
  const initdRe = /@initd\b/g
  const initdCount = (out.match(initdRe) || []).length
  if (initdCount > 0) {
    out = out.replace(initdRe, '@ready')
    replacements += initdCount
  }

  // 2. 深路径 import es/... → 根入口
  const deepPathRe = /from 'baidu-map-gl-vue\/[^']*'/g
  const deepCount = (out.match(deepPathRe) || []).length
  if (deepCount > 0) {
    out = out.replace(deepPathRe, `from 'baidu-map-gl-vue'`)
    replacements += deepCount
    warnings.push('深路径 import 已归一为根入口;请按需改用 /components 或 /composables 子路径')
  }

  // 3. usePubSub 提示
  if (/usePubSub/.test(out)) {
    warnings.push('usePubSub 已从主入口移除,请改用 map context / whenReady')
  }

  // 4. getScriptAsync 提示
  if (/getScriptAsync/.test(out)) {
    warnings.push('getScriptAsync 遗留于 legacy,推荐 Provider/loader API')
  }

  // 5. app.use(Vue3BaiduMapGl, { ... }) → createBMapPlugin({ ... })
  const useRe = /app\.use\(\s*Vue3BaiduMapGl\s*,\s*\{([\s\S]*?)\}\s*\)/g
  if (useRe.test(out)) {
    out = out.replace(useRe, `app.use(createBMapPlugin({ $1 }))`)
    replacements++
    warnings.push('app.use(Vue3BaiduMapGl, {...}) → app.use(createBMapPlugin({...}));需导入 createBMapPlugin')
  }

  return { out, replacements, warnings }
}

let totalReplacements = 0
let totalWarnings = 0

for (const file of files) {
  const abs = resolve(root, file)
  let src: string
  try {
    src = readFileSync(abs, 'utf-8')
  } catch {
    console.warn(`[migrate] skip (not found): ${file}`)
    continue
  }
  const res = migrate(src)
  totalReplacements += res.replacements
  totalWarnings += res.warnings.length
  if (res.replacements > 0) {
    console.log(`[migrate] ${file}: ${res.replacements} replacements`)
    for (const w of res.warnings) console.log(`  ⚠ ${w}`)
    if (!dryRun) writeFileSync(abs, res.out)
  } else if (res.warnings.length > 0) {
    console.log(`[migrate] ${file}: no replacements, ${res.warnings.length} warnings`)
    for (const w of res.warnings) console.log(`  ⚠ ${w}`)
  } else {
    console.log(`[migrate] ${file}: no change`)
  }
}

console.log(`\n[migrate] done. ${totalReplacements} replacements, ${totalWarnings} warnings${dryRun ? ' (dry-run)' : ''}`)
