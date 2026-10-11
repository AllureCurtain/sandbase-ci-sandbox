#!/usr/bin/env node
// Parses every workflow and checks the shape d1-repro.yml relies on: manual
// trigger only, both inputs, no `${{ }}` inside run scripts, cleanup always runs.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')
let failed = false
const fail = (msg) => {
  console.error(`FAIL ${msg}`)
  failed = true
}

for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const doc = parse(readFileSync(join(dir, name), 'utf8'), { prettyErrors: true, strict: true })
  console.log(`parsed ${name}`)
  if (name !== 'd1-repro.yml') continue
  if (JSON.stringify(Object.keys(doc.on)) !== '["workflow_dispatch"]') fail('trigger must be workflow_dispatch only')
  const inputs = doc.on.workflow_dispatch.inputs
  if (inputs.wrangler_version?.default !== '3.99.0') fail('wrangler_version must default to 3.99.0')
  if (inputs.test_r2?.type !== 'boolean' || inputs.test_r2.default !== false) fail('test_r2 must be a boolean defaulting to false')
  const steps = doc.jobs.repro.steps
  for (const s of steps) {
    if (typeof s.run === 'string' && s.run.includes('${{')) fail(`step "${s.name}" inlines an expression in run`)
    if (typeof s.run === 'string' && /--remote/.test(s.run) && /\bnpx\b/.test(s.run)) fail(`step "${s.name}" bypasses the wr wrapper`)
  }
  const cleanup = steps.find((s) => s.name === 'Delete temporary resources')
  if (!cleanup || cleanup.if !== 'always()') fail('cleanup step must run with if: always()')
  if (JSON.stringify(doc.permissions) !== '{"contents":"read"}') fail('permissions must be contents: read')
  const text = readFileSync(join(dir, name), 'utf8')
  if (/aa4816e0|sandbase-lab-artifacts|\bsandbase-lab\b(?!\/)/.test(text.replace(/sandbase-lab\/pelican-test/g, ''))) fail('production resource name or id found')
}

const template = readFileSync(join(dir, '..', '..', 'wrangler.template.toml'), 'utf8')
if (/aa4816e0|sandbase-lab/.test(template)) fail('wrangler.template.toml names a production resource')

if (failed) process.exit(1)
console.log('workflow checks passed')
