import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

export const QUEUE_REPOSITORY = 'tctan222-alt/ccm-fish-wage'
const apiRoot = `https://api.github.com/repos/${QUEUE_REPOSITORY}`
const repositoryUrl = `https://github.com/${QUEUE_REPOSITORY}`
const queueLabels = new Set(['codex-ready', 'codex-in-progress', 'codex-review', 'owner-decision', 'codex-blocked', 'codex-done'])
const activeLabels = new Set(['codex-in-progress', 'codex-review'])
const heldPullRequests = new Set([32, 36])

class AuditError extends Error {}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const redact = (value, token) => token ? value.replaceAll(token, '[REDACTED]') : value

function readItem(item, token) {
  if (!isRecord(item) || !Number.isSafeInteger(item.number) || item.number < 1
    || typeof item.title !== 'string' || !Array.isArray(item.labels)
    || !item.labels.every(label => isRecord(label) && typeof label.name === 'string')) {
    throw new AuditError('GitHub returned an invalid queue item.')
  }
  return {
    number: item.number,
    title: redact(item.title, token),
    labels: item.labels.map(label => redact(label.name, token)),
    draft: item.draft === true,
  }
}

/** Fixed repository, GET-only inventory. It neither selects nor claims coding work. */
export async function fetchQueueInventory({ token, fetchImpl = globalThis.fetch, observedAt = new Date().toISOString() }) {
  if (typeof token !== 'string' || !token.trim()) throw new AuditError('A read-only GitHub token is required.')
  const list = async endpoint => {
    const items = []
    for (let page = 1; page <= 100; page += 1) {
      let response
      try {
        response = await fetchImpl(`${apiRoot}/${endpoint}?state=open&per_page=100&page=${page}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          redirect: 'error',
          signal: globalThis.AbortSignal.timeout(30_000),
        })
      } catch {
        throw new AuditError('GitHub queue read failed; check connectivity and read permission.')
      }
      if (!response.ok) throw new AuditError(`GitHub queue read failed (HTTP ${Number(response.status) || 0}).`)
      let body
      try { body = await response.json() } catch { throw new AuditError('GitHub returned invalid queue JSON.') }
      if (!Array.isArray(body)) throw new AuditError('GitHub returned an invalid queue page.')
      items.push(...body)
      if (body.length < 100) return items
    }
    throw new AuditError('Queue pagination exceeded the safety limit; inventory is incomplete.')
  }
  const [issues, pullRequests] = await Promise.all([list('issues'), list('pulls')])
  return {
    repository: QUEUE_REPOSITORY,
    observedAt,
    issues: issues.filter(item => !isRecord(item) || !item.pull_request).map(item => readItem(item, token)),
    pullRequests: pullRequests.map(item => readItem(item, token)),
  }
}

function markdownText(value) {
  return [...String(value)].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~]/g, '\\$&')
}

export function renderQueueSummary(inventory) {
  if (inventory.repository !== QUEUE_REPOSITORY) throw new AuditError('Unexpected inventory repository.')
  const issues = inventory.issues.filter(item => item.labels.some(label => queueLabels.has(label)))
  const active = issues.filter(item => item.labels.some(label => activeLabels.has(label)))
  const lines = [
    '# CCM cloud queue inventory', '',
    '**Read-only status check. No claim, code generation, paid model call, PR mutation, merge, or deployment.**', '',
    'An unattended cloud coding trigger is not configured by this workflow. A queue label is not proof of owner approval.', '',
    `Repository: [${QUEUE_REPOSITORY}](${repositoryUrl})`,
    `Observed: ${markdownText(inventory.observedAt)}`, '',
    '## Queue-labelled open issues', '',
    '| Issue | Labels | Ownership/checkpoint |', '| --- | --- | --- |',
  ]
  for (const item of issues) {
    const url = `${repositoryUrl}/issues/${item.number}`
    const checkpoint = item.labels.some(label => activeLabels.has(label))
      ? `[Inspect active ownership and checkpoint](${url}) — status not verified`
      : `[Inspect approval and blockers](${url})`
    lines.push(`| [#${item.number} ${markdownText(item.title)}](${url}) | ${item.labels.map(markdownText).join(', ')} | ${checkpoint} |`)
  }
  if (!issues.length) lines.push('| None | No queue-labelled open issue | No work selected |')
  lines.push('', '## Open pull requests', '', '| Pull request | State | Action |', '| --- | --- | --- |')
  for (const item of inventory.pullRequests) {
    const held = heldPullRequests.has(item.number)
    lines.push(`| [#${item.number} ${markdownText(item.title)}](${repositoryUrl}/pull/${item.number}) | ${held ? 'HELD' : item.draft ? 'Draft' : 'Open'} | ${held ? 'Do not resume, promote, or merge' : 'Inspect current-head CI/review; no action taken'} |`)
  }
  if (!inventory.pullRequests.length) lines.push('| None | — | No action taken |')
  lines.push('', '## Handover and concurrency', '',
    '- Legacy desktop `ccm-erp` stop status is not established by this inventory. Absence from an API response is not proof of shutdown.',
    '- Confirm schedule disabled, any active run stopped, and dirty/unpushed work preserved before enabling a cloud coding worker.',
    '- GitHub comments and checkout-local Git locks are checkpoints, not an atomic multi-host mutex.',
    `- Active-labelled issues observed: ${active.length}. ${active.length > 1 ? 'Multiple active issues require manual ownership triage.' : 'Re-read ownership before any separately authorized development.'}`,
    '- No Firebase production access or business-data operation is performed.', '')
  return lines.join('\n')
}

export function auditErrorMessage(error) {
  return error instanceof AuditError ? error.message : 'Queue audit failed unexpectedly; no queue changes were made.'
}

async function main() {
  try {
    const inventory = await fetchQueueInventory({ token: process.env.GITHUB_TOKEN })
    const summary = renderQueueSummary(inventory)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8')
    else process.stdout.write(summary)
  } catch (error) {
    process.stderr.write(`${auditErrorMessage(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
