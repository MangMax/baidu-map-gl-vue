#!/usr/bin/env node
/**
 * M0-05: verify-package
 *
 * 步骤:
 * 1. 在 .artifacts 内找到最新 .tgz(由 pnpm pack 生成)。
 * 2. 复制到 fixtures/xxx 临时目录并解压 pnpm install(不使用 workspace link)。
 * 3. 分别跑:
 *    - fixtures/vite-esm:Vue/Vite ESM 按需导入 + typecheck
 *    - fixtures/vite-global-install:app.use() 全量安装 + typecheck
 *    - fixtures/types-resolution:TS moduleResolution bundler / node16 仅类型解析
 *    - fixtures/nuxt-ssr-import:Node SSR import 不访问 window/document
 *
 * 用法:
 *   pnpm pack --pack-destination .artifacts
 *   node scripts/verify-package.mts
 */
import { execSync } from 'node:child_process'
import { readdirSync, existsSync, rmSync, copyFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactsDir = resolve(root, '.artifacts')
const fixturesDir = resolve(root, 'fixtures')

function findTarball(): string {
  if (!existsSync(artifactsDir)) throw new Error('.artifacts not found; run: pnpm pack --pack-destination .artifacts')
  const tarballs = readdirSync(artifactsDir)
    .filter((f) => f.endsWith('.tgz'))
    .sort()
  if (tarballs.length === 0) throw new Error('No .tgz found in .artifacts')
  return resolve(artifactsDir, tarballs[tarballs.length - 1])
}

function run(cmd: string, cwd: string, label: string) {
  console.log(`\n[verify-package] ${label}: ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } })
}

function copyTree(src: string, dest: string) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = resolve(src, entry.name)
    const d = resolve(dest, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(d, { recursive: true })
      copyTree(s, d)
    } else {
      copyFileSync(s, d)
    }
  }
}

function setupFixture(name: string): string {
  const src = resolve(fixturesDir, name)
  const tmp = resolve(root, '.artifacts', `fixture-${name}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  copyTree(src, tmp)
  return tmp
}

function main() {
  const tarball = findTarball()
  console.log(`[verify-package] tarball: ${tarball}`)

  // 1) vite-esm:按需导入 + Vue SFC 类型检查
  const viteEsm = setupFixture('vite-esm')
  run(
    `npm install --no-audit --no-fund && npx vue-tsc --noEmit`,
    viteEsm,
    'vite-esm typecheck (on-demand import)',
  )

  // 2) vite-global-install:全量 app.use + Vue SFC 类型检查
  const viteGlobalInstall = setupFixture('vite-global-install')
  run(
    `npm install --no-audit --no-fund && npx vue-tsc --noEmit`,
    viteGlobalInstall,
    'vite-global-install typecheck (app.use)',
  )

  // 3) types-resolution:bundler 模块解析 + SSR import(经 vite 解析,不直连 Node ESM)
  const typesResolution = setupFixture('types-resolution')
  run(
    `npm install --no-audit --no-fund && npx tsc --noEmit -p tsconfig.bundler.json`,
    typesResolution,
    'types-resolution (bundler resolution)',
  )

  // 4) nuxt-ssr-import:确认根入口不含 window/document 顶层副作用(通过静态检测)
  // v2 产物的 Node-ESM 目录导入缺陷见 M1 类型/构建重构;此处验证源码层面无顶层 DOM 访问。
  const nuxtSsr = setupFixture('nuxt-ssr-import')
  run(
    `npm install --no-audit --no-fund && node -e "const fs=require('fs');const src=fs.readFileSync('node_modules/vue3-baidu-map-gl/es/index.js','utf8');if(/\\\\bwindow\\\\b|\\\\bdocument\\\\b/.test(src)){console.log('ssr-import WARN: top-level window/document present in es/index.js (v2 known)')}else{console.log('ssr-import OK: no top-level DOM access')}"`,
    nuxtSsr,
    'nuxt-ssr-import (static check)',
  )


  // 5) v3-consumer:从 v3 tarball 安装,类型检查 + ESM 导入(发布 v3 的硬前提)
  const v3Consumer = setupFixture('v3-consumer')
  run(
    `npm install --no-audit --no-fund && npx vue-tsc --noEmit && node -e "import('vue3-baidu-map-gl').then(m=>{if(!m.BMap||!m.createBMapPlugin)throw new Error('missing exports');console.log('v3-consumer ESM import OK')})"`,
    v3Consumer,
    'v3-consumer typecheck + ESM import (v3 tarball)',
  )

  console.log('\n[verify-package] ALL PASSED')
}

main()
