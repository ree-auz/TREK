export type LabelDirection = 'top' | 'right' | 'bottom' | 'left' | 'center'
export type LabelCandidateName = 'bottom' | 'right' | 'left' | 'top' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

export interface LabelRect { x: number; y: number; width: number; height: number }
export interface LabelSize { width: number; height: number }
export interface LabelLayoutItem {
  id: string
  anchor: { x: number; y: number }
  iconRect: LabelRect
  size: LabelSize
  priority: number
  stableOrder: number
  previousCandidate?: LabelCandidateName
}
export interface LabelPlacement {
  id: string
  candidate: LabelCandidateName
  direction: LabelDirection
  offset: [number, number]
  rect: LabelRect
}
export interface LabelRejection {
  id: string
  candidate: LabelCandidateName
  rect: LabelRect
  reasons: string[]
}
export interface LabelLayoutResult {
  placements: Map<string, LabelPlacement>
  hidden: Set<string>
  rejections: LabelRejection[]
}

const GAP = 4
const CANDIDATES: LabelCandidateName[] = [
  'bottom', 'right', 'left', 'top',
  'bottom-right', 'bottom-left', 'top-right', 'top-left',
]

export function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y
}

function candidatePlacement(item: LabelLayoutItem, candidate: LabelCandidateName): LabelPlacement {
  const { anchor, iconRect, size } = item
  let rect: LabelRect
  let direction: LabelDirection
  let offset: [number, number]
  if (candidate === 'bottom') {
    rect = { x: anchor.x - size.width / 2, y: iconRect.y + iconRect.height + GAP, ...size }
    direction = 'bottom'; offset = [0, rect.y - anchor.y]
  } else if (candidate === 'top') {
    rect = { x: anchor.x - size.width / 2, y: iconRect.y - GAP - size.height, ...size }
    direction = 'top'; offset = [0, rect.y + size.height - anchor.y]
  } else if (candidate === 'right') {
    rect = { x: iconRect.x + iconRect.width + GAP, y: anchor.y - size.height / 2, ...size }
    direction = 'right'; offset = [rect.x - anchor.x, 0]
  } else if (candidate === 'left') {
    rect = { x: iconRect.x - GAP - size.width, y: anchor.y - size.height / 2, ...size }
    direction = 'left'; offset = [rect.x + size.width - anchor.x, 0]
  } else {
    const right = candidate.endsWith('right')
    const bottom = candidate.startsWith('bottom')
    rect = {
      x: right ? iconRect.x + iconRect.width + GAP : iconRect.x - GAP - size.width,
      y: bottom ? iconRect.y + iconRect.height + GAP : iconRect.y - GAP - size.height,
      ...size,
    }
    direction = 'center'
    offset = [rect.x + size.width / 2 - anchor.x, rect.y + size.height / 2 - anchor.y]
  }
  return { id: item.id, candidate, direction, offset, rect }
}

function candidateOrder(item: LabelLayoutItem): LabelCandidateName[] {
  // Bottom is reconsidered first after every settled viewport change. The old
  // candidate is only a tie-breaker for non-default alternatives, preventing
  // left/right flicker without making a displaced anchor permanent.
  if (!item.previousCandidate || item.previousCandidate === 'bottom') return CANDIDATES
  return ['bottom', item.previousCandidate, ...CANDIDATES.filter(c => c !== 'bottom' && c !== item.previousCandidate)]
}

export function layoutPlaceLabels(
  items: LabelLayoutItem[],
  viewport: LabelRect,
  obstacles: Array<{ id: string; rect: LabelRect }> = [],
): LabelLayoutResult {
  const placements = new Map<string, LabelPlacement>()
  const hidden = new Set<string>()
  const rejections: LabelRejection[] = []
  const byId = new Map(items.map(item => [item.id, item]))
  const ordered = [...items].sort((a, b) => b.priority - a.priority || a.stableOrder - b.stableOrder || a.id.localeCompare(b.id))

  const rejectionReasons = (item: LabelLayoutItem, placement: LabelPlacement, ignored = new Set<string>()): string[] => {
    const reasons: string[] = []
    const r = placement.rect
    if (r.x < viewport.x || r.y < viewport.y || r.x + r.width > viewport.x + viewport.width || r.y + r.height > viewport.y + viewport.height) reasons.push('viewport-edge')
    for (const other of items) if (other.id !== item.id && rectsOverlap(r, other.iconRect)) reasons.push(`icon:${other.id}`)
    for (const obstacle of obstacles) if (rectsOverlap(r, obstacle.rect)) reasons.push(`obstacle:${obstacle.id}`)
    for (const [id, accepted] of placements) if (!ignored.has(id) && rectsOverlap(r, accepted.rect)) reasons.push(`label:${id}`)
    return reasons
  }

  const placeFirstFit = (item: LabelLayoutItem, ignored = new Set<string>()): LabelPlacement | null => {
    for (const candidate of candidateOrder(item)) {
      const placement = candidatePlacement(item, candidate)
      const reasons = rejectionReasons(item, placement, ignored)
      if (!reasons.length) return placement
      rejections.push({ id: item.id, candidate, rect: placement.rect, reasons })
    }
    return null
  }

  for (const item of ordered) {
    const direct = placeFirstFit(item)
    if (direct) { placements.set(item.id, direct); continue }

    // Limited local repair: reserve a candidate for this label, then re-seat
    // up to two colliding neighbours. Failed attempts are fully rolled back.
    let repaired = false
    for (const candidate of candidateOrder(item)) {
      const proposed = candidatePlacement(item, candidate)
      const reasons = rejectionReasons(item, proposed)
      if (reasons.some(reason => !reason.startsWith('label:'))) continue
      const blockers = [...new Set(reasons.map(reason => reason.slice(6)))].slice(0, 2)
      if (!blockers.length || blockers.some(id => (byId.get(id)?.priority ?? 0) > item.priority)) continue
      const saved = blockers.map(id => [id, placements.get(id)!] as const)
      blockers.forEach(id => placements.delete(id))
      placements.set(item.id, proposed)
      const reseated: Array<[string, LabelPlacement]> = []
      let ok = true
      for (const id of blockers) {
        const neighbour = byId.get(id)
        const next = neighbour && placeFirstFit(neighbour)
        if (!next) { ok = false; break }
        placements.set(id, next); reseated.push([id, next])
      }
      if (ok) { repaired = true; break }
      placements.delete(item.id)
      reseated.forEach(([id]) => placements.delete(id))
      saved.forEach(([id, placement]) => placements.set(id, placement))
    }
    if (!repaired) hidden.add(item.id)
  }
  return { placements, hidden, rejections }
}

