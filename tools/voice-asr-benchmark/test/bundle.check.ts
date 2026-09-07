import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { buildClient } from '../scripts/build-client.ts'

test('browser build excludes environment secrets and server provider/signing code', async () => {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'ccm-asr-bundle-test-'))
  const keys = ['OPENAI_API_KEY', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'ERP_FIRESTORE_TOKEN']
  const original = keys.map(key => process.env[key])
  const sentinels = keys.map((_, index) => `NEVER_SHIP_BROWSER_SENTINEL_${index}_6e8af4`)
  try {
    keys.forEach((key, index) => { process.env[key] = sentinels[index] })
    await buildClient(directory)
    const artifacts = await Promise.all(['app.js', 'index.html', 'style.css'].map(name => readFile(join(directory, name), 'utf8')))
    const output = artifacts.join('\n')
    assert.ok(artifacts[0].length > 1000, 'real browser bundle must be generated')
    for (const value of [...sentinels, ...keys, 'process.env', 'api.openai.com', 'asr.tencentcloudapi.com', 'firestore.googleapis.com', 'TC3-HMAC-SHA256', 'createHmac', 'node:crypto']) assert.equal(output.includes(value), false, `browser must exclude ${value}`)
    assert.match(output, /\/api\/benchmark/)
    assert.match(artifacts[1], /src="\/app\.js"/)
    assert.doesNotMatch(artifacts[1], /(?:src|href)="https?:\/\//)
  } finally {
    keys.forEach((key, index) => { if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index] })
    const resolved = resolve(directory)
    assert.ok(resolved.startsWith(base + sep) && resolved.slice(base.length + 1).startsWith('ccm-asr-bundle-test-'))
    await rm(resolved, { recursive: true, force: true })
  }
})
