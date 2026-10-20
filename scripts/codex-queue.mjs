import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const issueKeys = ['number', 'state', 'labels', 'ownerApproved', 'priority', 'blockers', 'productionDeploy', 'productionDataWrites']
const prKeys = ['number', 'state', 'draft', 'issueNumber']
const activeLabels = ['codex-in-progress', 'codex-review']
const blockedLabels = ['owner-decision', 'codex-blocked', 'codex-done']

function record(value, keys, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`)
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${context} has an unknown field; reconcile the snapshot before planning`)
  }
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function uniqueNumbers(items, context) {
  if (new Set(items.map((item) => item.number)).size !== items.length) {
    throw new Error(`${context} contains duplicate numbers`)
  }
}

// Explicit approval and explicit false production flags must come from current,
// verified human evidence. The planner does not infer approval from a ready label.
export function validateSnapshot(snapshot) {
  record(snapshot, ['issues', 'pullRequests'], 'snapshot')
  if (!Array.isArray(snapshot.issues) || !Array.isArray(snapshot.pullRequests)) {
    throw new Error('snapshot requires issues and pullRequests arrays')
  }
  for (const issue of snapshot.issues) {
    record(issue, issueKeys, 'issue')
    if (!positiveInteger(issue.number) || !['open', 'closed'].includes(issue.state)) {
      throw new Error('issue requires a positive integer number and open/closed state')
    }
    if (!Array.isArray(issue.labels) || !issue.labels.every((label) => typeof label === 'string')) {
      throw new Error('issue labels must be strings')
    }
    if (typeof issue.ownerApproved !== 'boolean'
      || typeof issue.productionDeploy !== 'boolean'
      || typeof issue.productionDataWrites !== 'boolean') {
      throw new Error('issue approval and both production flags must be explicit booleans')
    }
    if (issue.priority !== null && (!Number.isSafeInteger(issue.priority) || issue.priority < 0)) {
      throw new Error('issue priority must be a nonnegative integer or null')
    }
    if (issue.blockers !== undefined
      && (!Array.isArray(issue.blockers) || !issue.blockers.every((blocker) => typeof blocker === 'string'))) {
      throw new Error('issue blockers must be an array of strings')
    }
  }
  for (const pr of snapshot.pullRequests) {
    record(pr, prKeys, 'pull request')
    if (!positiveInteger(pr.number) || !['open', 'closed', 'merged'].includes(pr.state)
      || typeof pr.draft !== 'boolean'
      || (pr.issueNumber !== null && !positiveInteger(pr.issueNumber))) {
      throw new Error('pull request requires number, state, draft, and issueNumber (positive integer or null)')
    }
  }
  uniqueNumbers(snapshot.issues, 'issues')
  uniqueNumbers(snapshot.pullRequests, 'pullRequests')
  return snapshot
}

function ineligibleReason(issue) {
  if (issue.state !== 'open') return 'closed'
  if (issue.labels.some((label) => blockedLabels.includes(label))) return 'blocking-status'
  if (!issue.ownerApproved) return 'missing-owner-approval'
  if (issue.productionDeploy || issue.productionDataWrites) return 'protected-production-action'
  if (issue.blockers?.length) return 'unresolved-blocker'
  return null
}

function orderIssues(left, right) {
  return (left.priority ?? Infinity) - (right.priority ?? Infinity) || left.number - right.number
}

export function planQueue(input) {
  const snapshot = validateSnapshot(input)
  const ignored = snapshot.issues.flatMap((issue) => {
    const reason = ineligibleReason(issue)
    return reason ? [{ issueNumber: issue.number, reason }] : []
  })
  const result = (action, reason, issueNumber = null, prNumber = null) => ({
    action, reason, issueNumber, prNumber, ignored,
  })
  const active = snapshot.issues.filter((issue) => issue.state === 'open'
    && issue.labels.some((label) => activeLabels.includes(label)))
  if (active.length > 1) {
    return result('stop', 'Multiple active issues require triage; do not claim another task')
  }
  const staleMerged = snapshot.issues.some((issue) => !ineligibleReason(issue)
    && issue.labels.some((label) => [...activeLabels, 'codex-ready'].includes(label))
    && snapshot.pullRequests.some((pr) => pr.issueNumber === issue.number && pr.state === 'merged'))
  if (staleMerged) {
    return result('stop', 'An actionable issue already has a merged PR; reconcile its status before starting work')
  }
  const linkedPrs = (issue) => snapshot.pullRequests.filter((pr) =>
    pr.state === 'open' && pr.issueNumber === issue.number)
  if (active.length === 1) {
    const issue = active[0]
    const reason = ineligibleReason(issue)
    if (reason) return result('stop', `Active issue is blocked: ${reason}`)
    const prs = linkedPrs(issue)
    if (prs.length > 1) return result('stop', 'Active issue has multiple open PRs; reconcile them first')
    if (prs.length === 1) {
      return result('resume-pr', 'Continue the existing approved PR before claiming work', issue.number, prs[0].number)
    }
    return result('resume-issue', 'Resume the active issue checkpoint; do not create a duplicate task', issue.number)
  }
  const ready = snapshot.issues.filter((issue) => !ineligibleReason(issue)
    && issue.labels.includes('codex-ready')).sort(orderIssues)
  const existing = ready.filter((issue) => linkedPrs(issue).length > 0)
  if (existing.length > 1 || existing.some((issue) => linkedPrs(issue).length > 1)) {
    return result('stop', 'Multiple approved open PRs require triage; do not claim another task')
  }
  if (existing.length === 1) {
    const issue = existing[0]
    return result('resume-pr', 'Continue the existing approved PR before claiming work', issue.number, linkedPrs(issue)[0].number)
  }
  if (ready.length) return result('claim', 'Select one approved ready issue by priority, then issue number', ready[0].number)
  return result('audit', 'No approved actionable issue; read-only audit only, no backlog execution')
}

function validateRunId(runId) {
  if (typeof runId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(runId)) {
    throw new Error('runId must contain 1-128 letters, digits, dots, underscores, colons or hyphens')
  }
}

// Pass an explicit temporary path in tests. The CLI always uses Git's shared
// common directory, so the primary checkout and worktrees share one lock.
export function readLock(lockPath) {
  let text
  try {
    text = readFileSync(lockPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { locked: false }
    throw error
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Lock is malformed; retain it and investigate manually')
  }
  record(payload, ['runId', 'createdAt'], 'lock')
  validateRunId(payload.runId)
  if (typeof payload.createdAt !== 'string' || !Number.isFinite(Date.parse(payload.createdAt))) {
    throw new Error('Lock createdAt is invalid; retain it and investigate manually')
  }
  return { locked: true, ...payload }
}

export function acquireLock(lockPath, runId) {
  validateRunId(runId)
  let descriptor
  try {
    descriptor = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Dispatcher lock already exists; do not start overlapping work or remove it automatically')
    throw error
  }
  const payload = { runId, createdAt: new Date().toISOString() }
  try {
    writeFileSync(descriptor, `${JSON.stringify(payload)}\n`, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  return { locked: true, ...payload }
}

export function releaseLock(lockPath, runId) {
  validateRunId(runId)
  const current = readLock(lockPath)
  if (!current.locked) throw new Error('Dispatcher lock does not exist')
  if (current.runId !== runId) throw new Error('Dispatcher lock belongs to a different run; leave it intact')
  unlinkSync(lockPath)
  return { locked: false }
}

function commonLockPath() {
  const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (!commonDir) throw new Error('Cannot locate shared Git directory')
  return join(commonDir, 'codex-automation.lock')
}

function main(args) {
  const [command, argument, ...extra] = args
  if (extra.length || !['plan', 'acquire', 'status', 'release'].includes(command)
    || (command === 'status' ? argument !== undefined : argument === undefined)) {
    throw new Error('Usage: node scripts/codex-queue.mjs plan <snapshot.json> | acquire <runId> | status | release <runId>')
  }
  if (command === 'plan') return planQueue(JSON.parse(readFileSync(argument, 'utf8')))
  const lockPath = commonLockPath()
  if (command === 'acquire') return acquireLock(lockPath, argument)
  if (command === 'release') return releaseLock(lockPath, argument)
  return readLock(lockPath)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`)
    process.exitCode = 1
  }
}
