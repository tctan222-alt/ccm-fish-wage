import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createPreviewHandler, createCertificateHandler } from './server.mjs'

/* global fetch */
let temporaryDirectory, server, baseUrl
before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'ccm-retail-preview-check-'))
  await mkdir(join(temporaryDirectory, 'assets'))
  await writeFile(join(temporaryDirectory, 'index.html'), '<h1>Local sample</h1>')
  await writeFile(join(temporaryDirectory, 'assets', 'app.js'), 'export const sample = true')
  await writeFile(join(temporaryDirectory, 'server.key'), 'never-public')
  server = createServer(createPreviewHandler(temporaryDirectory))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  if (temporaryDirectory) {
    assert.match(relative(tmpdir(), temporaryDirectory), /^ccm-retail-preview-check-[^/\\]+$/)
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('serves the built fixture at retail-sales and disables application network calls', async () => {
  const response = await fetch(`${baseUrl}/retail-sales`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Local sample/)
  assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/)
})
test('serves compiled assets with the correct MIME', async () => {
  const response = await fetch(`${baseUrl}/assets/app.js`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/javascript/)
})
test('does not expose source, private keys, arbitrary routes, or traversal', async () => {
  for (const path of ['/server.key', '/src/App.tsx', '/api/retail-sales', '/assets/%2e%2e%2fserver.key', '/assets/%5c..%5cserver.key']) {
    const response = await fetch(baseUrl + path)
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(await response.text(), /never-public/)
  }
})
test('rejects writes and supports HEAD without returning a body', async () => {
  assert.equal((await fetch(`${baseUrl}/retail-sales`, { method: 'POST' })).status, 405)
  const response = await fetch(`${baseUrl}/retail-sales`, { method: 'HEAD' })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '')
})
test('the bootstrap endpoint only serves the explicitly supplied public certificate', async () => {
  const certificateServer = createServer(createCertificateHandler('public-certificate-fixture'))
  await new Promise(resolve => certificateServer.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${certificateServer.address().port}`
    const response = await fetch(`${url}/ccm-retail-preview-ca.cer`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-x509-ca-cert')
    assert.equal(await response.text(), 'public-certificate-fixture')
    for (const path of ['/', '/server.key', '/retail-sales']) assert.equal((await fetch(url + path)).status, 404)
  } finally { await new Promise(resolve => certificateServer.close(resolve)) }
})
