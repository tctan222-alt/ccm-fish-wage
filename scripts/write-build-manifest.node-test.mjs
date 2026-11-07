import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { test } from 'node:test'

test('release provenance hashes built files and rejects mismatched or dirty source', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-manifest-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'dist', 'assets'), { recursive: true })
    copyFileSync(fileURLToPath(new URL('./write-build-manifest.mjs', import.meta.url)), join(root, 'scripts', 'write-build-manifest.mjs'))
    writeFileSync(join(root, '.gitignore'), 'dist/\n')
    writeFileSync(join(root, 'source.txt'), 'reviewed source\n')
    git('init', '--quiet')
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture', '--quiet')
    const commit = git('rev-parse', 'HEAD'), contents = 'built application\n'
    writeFileSync(join(root, 'dist', 'assets', 'app.js'), contents)
    writeFileSync(join(root, 'dist', 'index.html'), '<script src="/assets/app.js"></script>')
    const run = expected => spawnSync(process.execPath, ['scripts/write-build-manifest.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CCM_RELEASE_COMMIT: expected },
    })
    assert.equal(run(commit).status, 0)
    const manifest = JSON.parse(readFileSync(join(root, 'dist', 'release.json'), 'utf8'))
    assert.equal(manifest.commit, commit)
    assert.equal(manifest.dirty, false)
    assert.deepEqual(manifest.files.map(file => file.path), ['assets/app.js', 'index.html'])
    assert.equal(manifest.files[0].sha256, createHash('sha256').update(contents).digest('hex'))
    assert.notEqual(run('0'.repeat(40)).status, 0)
    writeFileSync(join(root, 'untracked-source.txt'), 'unreviewed source')
    assert.notEqual(run(commit).status, 0)
    rmSync(join(root, 'untracked-source.txt'))
    writeFileSync(join(root, 'source.txt'), 'unreviewed edit')
    assert.notEqual(run(commit).status, 0)
    assert.equal(run('').status, 0)
    assert.equal(JSON.parse(readFileSync(join(root, 'dist', 'release.json'), 'utf8')).dirty, true)
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('ccm-manifest-'))
    rmSync(root, { recursive: true, force: true })
  }
})
