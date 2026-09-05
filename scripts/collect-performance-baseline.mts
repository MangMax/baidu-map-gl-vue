#!/usr/bin/env node
/**
 * M0-07: 记录性能基线
 *
 * 用 fake BMapGL 通过 vitest 驱动的基准用例测量:
 * - 100 次 Map mount/unmount 耗时
 * - 100 个 BMarker 创建/更新/销毁 的 SDK 调用与耗时
 * - mousemove 高频事件发射次数(验证未来 RAF 合并的价值)
 *
 * 输出 JSON 到 scripts/performance-baseline.v2.json。
 * 相对 v3 重建后可比较;不作绝对值门禁(受环境波动影响)。
 *
 * 用法:
 *   npx vitest run tests/performance/ -t "baseline" --json
 *   node scripts/collect-performance-baseline.mts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'scripts/performance-baseline.v2.json')
const VITEST_JSON = resolve(root, 'test-results.json')

if (!existsSync(VITEST_JSON)) {
  console.error('[performance-baseline] run `npx vitest run tests/performance/ --json > test-results.json` first')
  process.exit(1)
}

const report = JSON.parse(readFileSync(VITEST_JSON, 'utf-8'))
const tests = report.testResults.flatMap((tr: any) =>
  tr.assertionResults.map((a: any) => ({ title: a.title, duration: a.duration, status: a.status })),
)

const baseline = {
  version: '2.6.5',
  collectedAt: new Date().toISOString(),
  tests: tests.map((t: any) => ({ name: t.title, ms: Math.round(t.duration ?? 0), status: t.status })),
}

writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n')
console.log(`[performance-baseline] wrote ${OUT} (${tests.length} cases)`)
for (const t of baseline.tests) console.log(`  ${t.name}: ${t.ms}ms [${t.status}]`)
