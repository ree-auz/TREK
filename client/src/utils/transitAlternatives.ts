export interface AlternativeTransitLeg {
  mode?: string
  line?: string | null
  line_color?: string | null
  line_text_color?: string | null
  duration?: number
  stops?: number
  headsign?: string | null
  alternativeGroup?: string
  alternative_group?: string
  from?: { name?: string; lat?: number; lng?: number; time?: string | null; track?: string | null }
  to?: { name?: string; lat?: number; lng?: number; time?: string | null; track?: string | null }
}

export function compactTransitLine(value?: string | null) {
  const base = value?.split(/[（(]/, 1)[0].trim() || ''
  if (!base) return ''
  if (/轨道交通|地铁|号线/i.test(base)) {
    const number = base.match(/\d+/)?.[0]
    return number ? `${number}号线` : base
  }
  return base.replace(/路(?=区间$|$)/, '')
}

function samePoint(a?: AlternativeTransitLeg['from'], b?: AlternativeTransitLeg['from']) {
  const coordinates = [a?.lat, a?.lng, b?.lat, b?.lng]
  if (coordinates.every(value => Number.isFinite(value))) {
    return Math.abs(Number(a!.lat) - Number(b!.lat)) < 0.00002
      && Math.abs(Number(a!.lng) - Number(b!.lng)) < 0.00002
  }
  return Boolean(a?.name && b?.name && a.name.trim() === b.name.trim())
}

function areParallelAlternatives(a: AlternativeTransitLeg, b: AlternativeTransitLeg) {
  if (a.mode === 'WALK' || b.mode === 'WALK' || a.mode !== b.mode) return false
  const aGroup = a.alternativeGroup || a.alternative_group
  const bGroup = b.alternativeGroup || b.alternative_group
  if (aGroup || bGroup) return Boolean(aGroup && bGroup && aGroup === bGroup)
  return samePoint(a.from, b.from) && samePoint(a.to, b.to)
    && a.from?.time === b.from?.time
}

export function transitAlternativeKey(leg: AlternativeTransitLeg) {
  const explicitGroup = leg.alternativeGroup || leg.alternative_group
  if (explicitGroup) return `${leg.mode || ''}:group:${explicitGroup}`
  const point = (value?: AlternativeTransitLeg['from']) => Number.isFinite(value?.lat) && Number.isFinite(value?.lng)
    ? `${Number(value!.lat).toFixed(5)},${Number(value!.lng).toFixed(5)}` : value?.name?.trim() || ''
  return `${leg.mode || ''}:${point(leg.from)}>${point(leg.to)}`
}

export function selectTransitAlternatives<T extends AlternativeTransitLeg>(legs: T[], selected: Record<string, string> = {}): T[] {
  const result: T[] = []
  for (let index = 0; index < legs.length; index++) {
    const group = [legs[index]]
    while (index + 1 < legs.length && areParallelAlternatives(group[0], legs[index + 1])) group.push(legs[++index])
    if (group.length === 1) { result.push(group[0]); continue }
    const wanted = selected[transitAlternativeKey(group[0])]
    result.push(group.find(leg => compactTransitLine(leg.line) === wanted || leg.line === wanted) || group[0])
  }
  return result
}

export function transitAlternativeGroups<T extends AlternativeTransitLeg>(legs: T[]) {
  return legs.reduce<T[][]>((groups, leg) => {
    const current = groups[groups.length - 1]
    if (current && areParallelAlternatives(current[0], leg)) current.push(leg)
    else groups.push([leg])
    return groups
  }, [])
}

/** Collapse consecutive AMap parallel services into one “任选其一” display leg. */
export function groupAlternativeTransitLegs<T extends AlternativeTransitLeg>(legs: T[]): T[] {
  const grouped: T[] = []
  for (const leg of legs) {
    const previous = grouped[grouped.length - 1]
    if (!previous || !areParallelAlternatives(previous, leg)) {
      grouped.push({ ...leg })
      continue
    }
    const labels = `${previous.line || ''}/${leg.line || ''}`.split('/').map(compactTransitLine).filter(Boolean)
    previous.line = [...new Set(labels)].join('/')
    ;(previous as T & { alternatives?: string[] }).alternatives = [...new Set(labels)]
  }
  return grouped
}

export function inferredTransferCount(legs: AlternativeTransitLeg[]) {
  return Math.max(0, groupAlternativeTransitLegs(legs).filter(leg => leg.mode !== 'WALK').length - 1)
}

export function correctedTransferCount(legs: AlternativeTransitLeg[], reported?: number) {
  const rawCount = legs.filter(leg => leg.mode !== 'WALK').length
  const groupedCount = groupAlternativeTransitLegs(legs).filter(leg => leg.mode !== 'WALK').length
  return groupedCount < rawCount ? Math.max(0, groupedCount - 1) : Math.max(0, reported ?? groupedCount - 1)
}
