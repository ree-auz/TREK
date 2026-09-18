import type { Reservation } from '../../types'
import { selectTransitAlternatives } from '../../utils/transitAlternatives'

/**
 * Real-path geometry for transit journeys on the map (#1065). MOTIS delivers
 * each leg's shape as a Google-encoded polyline; we store it on
 * metadata.transit.legs[].geometry and decode it here so the map can draw the
 * actual rail/bus alignment instead of a straight line.
 */

export interface TransitMapSegment {
  coords: [number, number][]
  color: string | null
  walk: boolean
  mode: string
  line: string | null
}

/** Google polyline decoding with a configurable precision (MOTIS uses 6). */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = Math.pow(10, precision)
  const coords: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0
      let shift = 0
      let byte = 0x20
      while (byte >= 0x20) {
        if (index >= encoded.length) return coords
        byte = encoded.codePointAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      }
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lng += delta
    }
    coords.push([lat / factor, lng / factor])
  }
  return coords
}

/**
 * The decoded per-leg segments of a transit reservation, or [] when it has no
 * stored geometry (pre-geometry entries fall back to the straight line).
 */
export function getTransitMapSegments(res: Reservation): TransitMapSegment[] {
  if (res.type !== 'transit') return []
  let meta: any = res.metadata
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta) } catch { return [] }
  }
  const rawLegs = meta?.transit?.legs
  const legs = Array.isArray(rawLegs) ? selectTransitAlternatives(rawLegs, meta?.transit?.selected_lines || {}) : rawLegs
  if (!Array.isArray(legs)) return []
  const out: TransitMapSegment[] = []
  for (const leg of legs) {
    let coords: [number, number][] = []
    if (typeof leg?.geometry === 'string') {
      coords = decodePolyline(leg.geometry, typeof leg.geometry_precision === 'number' ? leg.geometry_precision : 6)
    }
    // New transit reservations retain the canonical WGS84 leg endpoints. They
    // provide a conservative fallback for AMap walking legs whose real response
    // contains endpoints but no usable steps polyline. Older reservations simply
    // keep the existing whole-route fallback behavior.
    if (coords.length < 2 && leg?.mode === 'WALK') {
      const from = storedPoint(leg.from)
      const to = storedPoint(leg.to)
      if (from && to) coords = [from, to]
    }
    if (coords.length < 2) continue
    out.push({
      coords,
      color: leg.line_color || null,
      walk: leg.mode === 'WALK',
      mode: String(leg.mode || ''),
      line: typeof leg.line === 'string' && leg.line.trim() ? leg.line.trim() : null,
    })
  }
  return out
}

function storedPoint(value: unknown): [number, number] | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { lat?: unknown; lng?: unknown }
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return [lat, lng]
}
