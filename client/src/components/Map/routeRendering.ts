import type { Reservation } from '../../types'
import { getTransitMapSegments } from './transitGeometry'
import { compactTransitLine, selectTransitAlternatives } from '../../utils/transitAlternatives'

export type RouteSegmentKind = 'walking' | 'transit' | 'subway' | 'road' | 'direct'
export type RouteNodeKind = 'start' | 'end' | 'transit-stop' | 'transfer'

export interface RouteRenderSegment {
  id: string
  reservationId: number
  kind: RouteSegmentKind
  coordinates: [number, number][]
  label?: string | null
  color: string
}

export interface RouteRenderNode {
  id: string
  reservationId: number
  kind: RouteNodeKind
  coordinate: [number, number]
  title?: string | null
  color: string
  priority: 'endpoint' | 'key' | 'transfer'
  transfer?: { from: string; to: string } | null
}

export interface RouteRenderModel {
  id: string
  reservationId: number
  segments: RouteRenderSegment[]
  nodes: RouteRenderNode[]
  label?: { text: string; coordinate: [number, number] } | null
}

function orderedEndpoints(reservation: Reservation) {
  return (reservation.endpoints || [])
    .filter(endpoint => Number.isFinite(endpoint.lat) && Number.isFinite(endpoint.lng))
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

function routeLineLabel(value: string | null): string | null {
  return compactTransitLine(value) || null
}

interface TransitStop {
  coordinate: [number, number]
  title?: string | null
  color: string
  priority: 'key' | 'transfer'
  transfer?: { from: string; to: string } | null
}

function routeColor(mode: unknown) {
  return /SUBWAY|METRO/i.test(String(mode || '')) ? '#FF9500' : '#0A84FF'
}

function normalizedStationName(value?: string | null) {
  return value?.trim().replace(/\s+/g, '').replace(/站$/, '') || null
}

function normalizeInterchangeColors(stops: TransitStop[]) {
  const groups = new Map<string, TransitStop[]>()
  for (const stop of stops) {
    if (stop.priority !== 'transfer') continue
    const name = normalizedStationName(stop.title)
    if (!name) continue
    const group = groups.get(name) || []
    group.push(stop)
    groups.set(name, group)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const nearby = group.every((stop, index) => index === 0
      || Math.hypot(stop.coordinate[0] - group[0].coordinate[0], stop.coordinate[1] - group[0].coordinate[1]) < 0.003)
    if (!nearby) continue
    const interchangeColor = group[0].color
    for (const stop of group) stop.color = interchangeColor
  }
  return stops
}

function transitStops(reservation: Reservation): TransitStop[] {
  if (reservation.type !== 'transit') return []
  let metadata: any = reservation.metadata
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata) } catch { return [] }
  }
  const legs = metadata?.transit?.legs
  if (!Array.isArray(legs)) return []
  const stops = new Map<string, TransitStop>()
  const add = (stop: any, color: string, priority: TransitStop['priority']) => {
    const lat = Number(stop?.lat)
    const lng = Number(stop?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
    const existing = stops.get(key)
    if (existing) {
      if (existing.color !== color || priority === 'transfer') existing.priority = 'transfer'
      return
    }
    stops.set(key, {
      coordinate: [lat, lng],
      title: typeof stop?.name === 'string' ? stop.name : null,
      color,
      priority,
    })
  }
  const transitLegs = selectTransitAlternatives(legs as any[], metadata?.transit?.selected_lines || {}).filter((leg: any) => leg?.mode !== 'WALK')
  transitLegs.forEach((leg: any, index: number) => {
    const color = routeColor(leg?.mode)
    add(leg?.from, color, index === 0 ? 'key' : 'transfer')
    add(leg?.to, color, index === transitLegs.length - 1 ? 'key' : 'transfer')
  })
  for (let index = 0; index < transitLegs.length - 1; index++) {
    const fromLeg = transitLegs[index]
    const toLeg = transitLegs[index + 1]
    const fromMode = /SUBWAY|METRO/i.test(String(fromLeg?.mode || '')) ? 'rail' : 'bus'
    const toMode = /SUBWAY|METRO/i.test(String(toLeg?.mode || '')) ? 'rail' : 'bus'
    if (fromMode !== toMode) continue
    const fromLabel = routeLineLabel(typeof fromLeg?.line === 'string' ? fromLeg.line : null)
    const toLabel = routeLineLabel(typeof toLeg?.line === 'string' ? toLeg.line : null)
    if (!fromLabel || !toLabel || fromLabel === toLabel) continue
    const point = fromLeg?.to || toLeg?.from
    const lat = Number(point?.lat)
    const lng = Number(point?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const stop = [...stops.values()].find(candidate =>
      Math.hypot(candidate.coordinate[0] - lat, candidate.coordinate[1] - lng) < 0.0015)
    if (stop) { stop.priority = 'transfer'; stop.transfer = { from: fromLabel, to: toLabel } }
  }
  return normalizeInterchangeColors([...stops.values()])
}

export function buildRouteRenderModels(
  reservations: Reservation[],
  roadRoutes: Map<number, [number, number][]>,
): RouteRenderModel[] {
  return reservations.flatMap((reservation) => {
    const endpoints = orderedEndpoints(reservation)
    if (endpoints.length < 2) return []

    const transitSegments = getTransitMapSegments(reservation)
    const road = roadRoutes.get(reservation.id)
    const rawSegments: RouteRenderSegment[] = transitSegments.length
      ? transitSegments.map((segment, index) => ({
          id: `${reservation.id}:segment:${index}`,
          reservationId: reservation.id,
          kind: segment.walk ? 'walking' : /SUBWAY|METRO/i.test(segment.mode) ? 'subway' : 'transit',
          coordinates: segment.coords,
          label: segment.walk ? null : routeLineLabel(segment.line),
          color: segment.walk ? '#626B76' : routeColor(segment.mode),
        }))
      : [{
          id: `${reservation.id}:segment:0`,
          reservationId: reservation.id,
          kind: road?.length ? 'road' : 'direct',
          coordinates: road?.length ? road : endpoints.map(endpoint => [endpoint.lat, endpoint.lng]),
          color: road?.length ? '#0A84FF' : '#626B76',
        }]
    const segments = rawSegments.reduce<RouteRenderSegment[]>((result, segment) => {
      const previous = result[result.length - 1]
      const previousEnd = previous?.coordinates[previous.coordinates.length - 1]
      const segmentEnd = segment.coordinates[segment.coordinates.length - 1]
      const sameEndpoints = previous && previousEnd && segmentEnd && previous.kind === segment.kind && segment.kind === 'transit'
        && Math.hypot(previous.coordinates[0][0] - segment.coordinates[0][0], previous.coordinates[0][1] - segment.coordinates[0][1]) < 0.00002
        && Math.hypot(previousEnd[0] - segmentEnd[0], previousEnd[1] - segmentEnd[1]) < 0.00002
      if (!sameEndpoints) { result.push(segment); return result }
      // Same-section services are alternatives, not transfers. The first is the
      // default; a saved user selection is filtered earlier by transitGeometry.
      return result
    }, [])

    const placeEndpoints = [endpoints[0], endpoints[endpoints.length - 1]]
    const endpointNodes: RouteRenderNode[] = placeEndpoints.map((endpoint, index) => ({
      id: `${reservation.id}:node:${index}`,
      reservationId: reservation.id,
      kind: index === 0 ? 'start' : 'end',
      coordinate: [endpoint.lat, endpoint.lng],
      title: endpoint.name,
      color: '#0A84FF',
      priority: 'endpoint',
    }))
    const endpointCoordinates = new Set(endpointNodes.map(node => `${node.coordinate[0].toFixed(6)},${node.coordinate[1].toFixed(6)}`))
    const stopNodes: RouteRenderNode[] = transitStops(reservation)
      .filter(stop => !endpointCoordinates.has(`${stop.coordinate[0].toFixed(6)},${stop.coordinate[1].toFixed(6)}`))
      .map((stop, index) => ({
        id: `${reservation.id}:transit-stop:${index}`,
        reservationId: reservation.id,
        kind: stop.priority === 'transfer' ? 'transfer' : 'transit-stop',
        coordinate: stop.coordinate,
        title: stop.title,
        color: stop.color,
          priority: stop.priority,
          transfer: stop.transfer,
      }))
    const nodes = [...endpointNodes, ...stopNodes]

    return [{
      id: `reservation:${reservation.id}`,
      reservationId: reservation.id,
      segments,
      nodes,
      label: null,
    }]
  })
}
