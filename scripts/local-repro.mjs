#!/usr/bin/env node
// Local twin of .github/workflows/d1-repro.yml: the same SQL in the same order,
// with --local and a fresh --persist-to directory per wrangler version. Never
// talks to Cloudflare (every d1/r2 call carries --local).
//
//   node scripts/local-repro.mjs <wrangler version>    e.g. 3.99.0 or 4.149.0
//
// Steps: apply 0001 only -> migrations list -> migrations apply (0002, 0003)
// -> both seeds via d1 execute --file -> re-import (idempotent) -> row counts
// against the manifests -> r2 put/get/sha256/delete for the objects present.
// State lives in <tmp>/ci-sandbox-local-<version>, deleted before each run.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: local-repro.mjs <wrangler version, e.g. 3.99.0>')
  process.exit(1)
}

const NAME = 'ci-sandbox-local'
const DB_ID = '00000000-0000-4000-8000-000000000000' // local only, never a real database
const work = join(tmpdir(), `ci-sandbox-local-${version}`)
const persist = join(work, 'persist')
rmSync(work, { recursive: true, force: true })
mkdirSync(join(work, 'migrations-stage1'), { recursive: true })
copyFileSync(join(ROOT, 'migrations', '0001_lab.sql'), join(work, 'migrations-stage1', '0001_lab.sql'))

const slash = (p) => p.replace(/\\/g, '/')
const template = readFileSync(join(ROOT, 'wrangler.template.toml'), 'utf8')
const writeConfig = (file, migrationsDir) => {
  const text = template
    .replace('__NAME__', NAME)
    .replace('__DB_NAME__', NAME)
    .replace('__DB_ID__', DB_ID)
    .replace('__MIGRATIONS_DIR__', slash(migrationsDir))
  writeFileSync(join(work, file), text)
  return join(work, file)
}
const config = writeConfig('wrangler.toml', join(ROOT, 'migrations'))
const stage1 = writeConfig('wrangler.stage1.toml', join(work, 'migrations-stage1'))

const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', WRANGLER_LOG: 'log' }
const quote = (a) => `"${String(a).replace(/"/g, '\\"')}"`
/** Runs `npx wrangler@<version> ...args --local --persist-to <state>`; returns stdout. */
function wr(label, args, { json = false } = {}) {
  const all = [...args, '--local', '--persist-to', persist]
  console.log(`\n== [${version}] ${label}\n$ wrangler ${all.join(' ')}`)
  // shell: npx is npx.cmd on Windows. Every argument is a constant or a path
  // built above, and each is quoted.
  // (`npx` itself stays unquoted: a quoted batch name breaks npx.cmd's %~dp0.)
  const r = spawnSync(['npx', ...['--yes', `wrangler@${version}`, ...all].map(quote)].join(' '), {
    cwd: ROOT,
    env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (!json) process.stdout.write(r.stdout ?? '')
  process.stderr.write(r.stderr ?? '')
  if (r.status !== 0) {
    console.error(`FAILED (${r.status}): ${label}`)
    process.exit(1)
  }
  return r.stdout
}

wr('apply 0001 only (simulate production)', ['d1', 'migrations', 'apply', NAME, '--config', stage1])
wr('migrations list (0002, 0003 pending)', ['d1', 'migrations', 'list', NAME, '--config', config])
wr('migrations apply (0002, 0003)', ['d1', 'migrations', 'apply', NAME, '--config', config])
for (const scene of ['watermelon-test', 'endless-runner']) {
  wr(`seed ${scene}`, ['d1', 'execute', NAME, '--yes', '--file', `seed/${scene}/seed.sql`, '--config', config])
}
wr('re-import watermelon-test (INSERT OR IGNORE, no change)', ['d1', 'execute', NAME, '--yes', '--file', 'seed/watermelon-test/seed.sql', '--config', config])

const manifests = ['watermelon-test', 'endless-runner'].map((s) => JSON.parse(readFileSync(join(ROOT, 'seed', s, 'manifest.json'), 'utf8')))
const want = {
  runs: new Set(manifests.flatMap((m) => m.runs.map((r) => r.run_id))).size,
  results: new Set(manifests.flatMap((m) => m.runs.map((r) => r.result_id))).size,
  migrations: '0001_lab.sql,0002_html_artifact.sql,0003_html_frames.sql',
}
const sql = "SELECT (SELECT COUNT(*) FROM lab_runs) AS runs, (SELECT COUNT(*) FROM lab_results) AS results, (SELECT GROUP_CONCAT(name, ',') FROM (SELECT name FROM d1_migrations ORDER BY id)) AS migrations"
const out = wr('row counts (read-only)', ['d1', 'execute', NAME, '--json', '--command', sql, '--config', config], { json: true })
// 3.99 may print a warning (e.g. proxy detected) on stdout before the JSON.
const got = JSON.parse(out.slice(out.search(/^\[\s*(\{|\]|$)/m)))[0].results[0]
console.log(`got:  ${JSON.stringify(got)}\nwant: ${JSON.stringify(want)}`)
if (got.runs !== want.runs || got.results !== want.results || got.migrations !== want.migrations) {
  console.error('FAILED: row counts or migrations differ')
  process.exit(1)
}

let objects = 0
for (const m of manifests) {
  for (const o of m.objects) {
    const file = join('seed', m.scene, o.file)
    if (!existsSync(join(ROOT, file))) continue
    const back = join(work, 'got.bin')
    wr(`r2 put ${o.key}`, ['r2', 'object', 'put', `${NAME}/${o.key}`, '--file', file, '--content-type', o.content_type, '--config', config])
    wr(`r2 get ${o.key}`, ['r2', 'object', 'get', `${NAME}/${o.key}`, '--file', back, '--config', config])
    const sha = createHash('sha256').update(readFileSync(back)).digest('hex')
    console.log(`sha256 want=${o.sha256} got=${sha}`)
    if (sha !== o.sha256) {
      console.error(`FAILED: sha256 mismatch for ${o.key}`)
      process.exit(1)
    }
    wr(`r2 delete ${o.key}`, ['r2', 'object', 'delete', `${NAME}/${o.key}`, '--config', config])
    objects++
  }
}
if (!objects) {
  console.error('FAILED: no seed objects present')
  process.exit(1)
}

console.log(`\nOK [wrangler ${version}] 0001 -> 0002/0003 -> 2 seeds -> ${got.runs} runs / ${got.results} results; ${objects} r2 objects round-tripped`)
rmSync(work, { recursive: true, force: true })
