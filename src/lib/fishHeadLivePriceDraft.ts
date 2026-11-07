import { MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG } from './purchasing'

/**
 * Current-device provisional fish-head price edits, scoped to the authenticated
 * operator and source session. Never a server Master price or finalized receipt.
 */
export type FishHeadLivePriceDraft = Record<string, number | null>
const PREFIX = 'ccm:fish-head-live-price:v1:'

function key(ownerId: string, sessionId: string): string | null {
  return ownerId.trim() && sessionId.trim()
    ? `${PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(sessionId)}`
    : null
}

function valid(prices: unknown): prices is FishHeadLivePriceDraft {
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return false
  const records = Object.entries(prices)
  return records.length <= 150 && records.every(([identity, price]) =>
    identity.startsWith('head:') && identity.length <= 200
    && (price === null || (Number.isSafeInteger(price) && Number(price) > 0
      && Number(price) <= MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG)))
}

export function readFishHeadLivePriceDraft(
  ownerId: string, sessionId: string, storage?: Pick<Storage, 'getItem'>,
): FishHeadLivePriceDraft {
  const name = key(ownerId, sessionId)
  if (!name) return {}
  try {
    const source = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
    const raw = source?.getItem(name)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return valid(parsed) ? { ...parsed } : {}
  } catch { return {} }
}

/** false means this browser could not durably cache the draft; do not claim it persisted. */
export function saveFishHeadLivePriceDraft(
  ownerId: string, sessionId: string, prices: FishHeadLivePriceDraft,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  const name = key(ownerId, sessionId)
  if (!name || !valid(prices)) return false
  try {
    const destination = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
    if (!destination) return false
    destination.setItem(name, JSON.stringify(prices))
    return true
  } catch { return false }
}
