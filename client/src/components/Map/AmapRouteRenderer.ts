import type { RouteRenderModel, RouteRenderNode, RouteRenderSegment } from './routeRendering'

type ToAmap = (point: [number, number]) => [number, number]

export function segmentStyle(segment: RouteRenderSegment) {
  if (segment.kind === 'subway' || segment.kind === 'transit') {
    return {
      strokeColor: segment.color,
      strokeWeight: 3.5,
      strokeOpacity: 0.96,
      strokeStyle: 'solid',
    }
  }
  if (segment.kind === 'direct') {
    return { strokeColor: segment.color, strokeWeight: 2.5, strokeOpacity: 0.9, strokeStyle: 'dashed', strokeDasharray: [6, 6] }
  }
  if (segment.kind === 'walking') {
    return {
      strokeColor: segment.color,
      strokeWeight: 3,
      strokeOpacity: 0.94,
      strokeStyle: 'dashed',
      strokeDasharray: [1, 7],
    }
  }
  return { strokeColor: segment.color, strokeWeight: 2.5, strokeOpacity: 0.96, strokeStyle: 'solid' }
}

function alternateSide(id: string) {
  let hash = 0
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return Math.abs(hash) % 2 === 0
}

export function labelDirectionForTangent(id: string, tangent: [number, number]): 'right' | 'left' | 'top' | 'bottom' {
  if (Math.abs(tangent[0]) >= Math.abs(tangent[1])) return alternateSide(id) ? 'top' : 'bottom'
  return alternateSide(id) ? 'right' : 'left'
}

function nearestTangent(coordinate: [number, number], segments: RouteRenderSegment[]): [number, number] {
  let nearest: { distance: number; tangent: [number, number] } | null = null
  for (const segment of segments) {
    for (let index = 0; index < segment.coordinates.length - 1; index++) {
      const start = segment.coordinates[index]
      const end = segment.coordinates[index + 1]
      const midLat = (start[0] + end[0]) / 2
      const midLng = (start[1] + end[1]) / 2
      const distance = (coordinate[0] - midLat) ** 2 + (coordinate[1] - midLng) ** 2
      if (!nearest || distance < nearest.distance) {
        nearest = { distance, tangent: [end[1] - start[1], end[0] - start[0]] }
      }
    }
  }
  return nearest?.tangent || [1, 0]
}

export function bestLineLabelIndex(coordinates: [number, number][]) {
  if (coordinates.length < 3) return Math.floor(coordinates.length / 2)
  let best = 1
  let bestScore = -Infinity
  for (let index = 1; index < coordinates.length - 1; index++) {
    const previous = coordinates[index - 1]
    const current = coordinates[index]
    const next = coordinates[index + 1]
    const before = [current[1] - previous[1], current[0] - previous[0]]
    const after = [next[1] - current[1], next[0] - current[0]]
    const beforeLength = Math.hypot(before[0], before[1]) || 1
    const afterLength = Math.hypot(after[0], after[1]) || 1
    const straightness = (before[0] * after[0] + before[1] * after[1]) / (beforeLength * afterLength)
    const edgePenalty = Math.abs(index / (coordinates.length - 1) - 0.5)
    const score = straightness - edgePenalty * 0.35 + Math.min(beforeLength, afterLength) * 100
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  }
  return best
}

function lineBadgeDataUrl(label: string, color: string) {
  const safeLabel = label.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
  const canvas = document.createElement('canvas')
  const context = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent) ? null : canvas.getContext('2d')
  if (context) context.font = '700 11px Arial, sans-serif'
  const width = Math.max(20, Math.ceil((context?.measureText(label).width || label.length * 11) + 14))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18"><rect width="${width}" height="18" rx="3.5" fill="${color}"/><text x="${width / 2}" y="13" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="white">${safeLabel}</text></svg>`
  return { image: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, width, height: 18 }
}

function transferBadgeDataUrl(from: string, to: string, color: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
  const text = `${from} ▶ ${to}`
  const canvas = document.createElement('canvas')
  const context = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent) ? null : canvas.getContext('2d')
  if (context) context.font = '700 11px Arial, sans-serif'
  const width = Math.max(48, Math.ceil((context?.measureText(text).width || text.length * 11) + 16))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18"><rect x="0.75" y="0.75" width="${width - 1.5}" height="16.5" rx="3.5" fill="${color}" stroke="white" stroke-width="1.5"/><text x="${width / 2}" y="13" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="white">${escape(from)} ▶ ${escape(to)}</text></svg>`
  return { image: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, width, height: 18 }
}

export class AmapRouteRenderer {
  private overlays: any[] = []
  private listeners: Array<{ target: any; handler: () => void }> = []
  private readonly labelLayer: any
  private viewportInsets = { left: 0, right: 0 }
  private externalObstacles: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
  private labelRects: Array<{ id: string; rect: { x: number; y: number; width: number; height: number } }> = []
  private lineRects: Array<{ id: string; x: number; y: number; width: number; height: number }> = []

  constructor(
    private readonly map: any,
    private readonly AMap: any,
    private readonly toAmap: ToAmap,
  ) {
    this.labelLayer = new this.AMap.LabelsLayer({
      zooms: [3, 20],
      zIndex: 104,
      collision: false,
      allowCollision: true,
    })
    this.map.add(this.labelLayer)
  }

  setViewportInsets(left: number, right: number) {
    this.viewportInsets = { left: Math.max(0, left), right: Math.max(0, right) }
  }

  setCollisionObstacles(obstacles: Array<{ id: string; x: number; y: number; width: number; height: number }>) {
    this.externalObstacles = obstacles
  }

  getLabelRects() { return this.labelRects }

  render(models: RouteRenderModel[], onRouteClick?: (reservationId: number) => void) {
    this.clear()
    this.labelRects = []
    this.lineRects = []
    const occupied = [...this.externalObstacles]
    for (const node of models.flatMap(model => model.nodes)) {
      const point = this.screenPoint(node.coordinate)
      const radius = node.priority === 'key' ? 10 : node.priority === 'endpoint' ? 5 : 7
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      const rect = { x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 }
      occupied.push({ id: `route-node:${node.id}`, ...rect })
      this.labelRects.push({ id: `route-node:${node.id}`, rect })
    }
    for (const segment of models.flatMap(model => model.segments)) {
      for (let index = 0; index < segment.coordinates.length - 1; index++) {
        const start = this.screenPoint(segment.coordinates[index])
        const end = this.screenPoint(segment.coordinates[index + 1])
        if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) continue
        const distance = Math.hypot(end.x - start.x, end.y - start.y)
        const steps = Math.max(1, Math.ceil(distance / 10))
        for (let step = 0; step <= steps; step++) {
          const ratio = step / steps
          const rect = { x: start.x + (end.x - start.x) * ratio - 3, y: start.y + (end.y - start.y) * ratio - 3, width: 6, height: 6 }
          const entry = { id: `route-line:${segment.id}:${index}:${step}`, ...rect }
          this.lineRects.push(entry)
        }
      }
    }
    const stationLabels = new Set<string>()
    const labelNodes: Array<{ node: RouteRenderNode; segments: RouteRenderSegment[] }> = []
    for (const model of models) {
      for (const segment of model.segments) {
        this.addSegment(segment)
      }
      for (const node of model.nodes) {
        this.addNode(node, onRouteClick)
        const stationKey = `${node.title || ''}:${node.coordinate[0].toFixed(5)},${node.coordinate[1].toFixed(5)}`
        if (stationLabels.has(stationKey)) continue
        stationLabels.add(stationKey)
        labelNodes.push({ node, segments: model.segments })
      }
    }
    // Station information is more useful than a repeated line badge. Reserve
    // transfer/key station labels first, then let line names find another point
    // along their geometry (or disappear as the lower-priority fallback).
    const nodeRank = (node: RouteRenderNode) => node.priority === 'transfer' ? 2 : node.priority === 'key' ? 1 : 0
    labelNodes.sort((a, b) => nodeRank(b.node) - nodeRank(a.node) || a.node.id.localeCompare(b.node.id))
    for (const { node, segments } of labelNodes) {
        const label = this.createNodeLabel(node, segments, occupied)
        if (label) this.overlays.push(label)
    }
    for (const model of models) {
      for (const segment of model.segments) {
        const label = this.createSegmentLabel(segment, occupied, onRouteClick)
        if (label) this.overlays.push(label)
      }
    }
    if (this.overlays.length) this.map.add(this.overlays)
  }

  clear() {
    for (const { target, handler } of this.listeners) target.off?.('click', handler)
    this.listeners = []
    if (this.overlays.length) this.map.remove(this.overlays)
    this.overlays = []
    this.labelLayer.clear?.()
  }

  destroy() {
    this.clear()
    this.map.remove?.(this.labelLayer)
  }

  private overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  }

  private screenPoint(coordinate: [number, number]) {
    const pixel = this.map.lngLatToContainer?.(this.toAmap(coordinate))
    return { x: Number(pixel?.getX?.() ?? pixel?.x), y: Number(pixel?.getY?.() ?? pixel?.y) }
  }

  private free(rect: { x: number; y: number; width: number; height: number }, occupied: Array<{ x: number; y: number; width: number; height: number }>) {
    const container = this.map.getContainer?.().getBoundingClientRect?.()
    if (!container?.width || !container?.height) return true
    if (rect.x < this.viewportInsets.left + 2 || rect.y < 2 || rect.x + rect.width > container.width - this.viewportInsets.right - 2 || rect.y + rect.height > container.height - 2) return false
    return !occupied.some(blocker => this.overlaps(rect, blocker))
  }

  private createSegmentLabel(segment: RouteRenderSegment, occupied: Array<{ id?: string; x: number; y: number; width: number; height: number }>, onRouteClick?: (reservationId: number) => void) {
    if (!segment.label || segment.coordinates.length < 2 || segment.kind === 'walking') return null
    const badge = lineBadgeDataUrl(segment.label, segment.color)
    const candidates = this.visibleLineLabelCoordinates(segment.coordinates)
    const canProject = candidates.some(coordinate => { const point = this.screenPoint(coordinate); return Number.isFinite(point.x) && Number.isFinite(point.y) })
    const chosen = !canProject ? candidates[0] : candidates.find(coordinate => {
      const point = this.screenPoint(coordinate)
      return Number.isFinite(point.x) && this.free({ x: point.x - badge.width / 2, y: point.y - badge.height / 2, width: badge.width, height: badge.height }, occupied)
    })
    if (!chosen) return null
    const point = this.screenPoint(chosen)
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      const rect = { x: point.x - badge.width / 2, y: point.y - badge.height / 2, width: badge.width, height: badge.height }
      occupied.push({ id: `route-label:${segment.id}`, ...rect })
    }
    const content = document.createElement('img')
    content.src = badge.image
    content.alt = segment.label
    content.draggable = false
    content.dataset.markerKind = 'route-label'
    content.style.cssText = `display:block;width:${badge.width}px;height:${badge.height}px;pointer-events:${onRouteClick ? 'auto' : 'none'};cursor:${onRouteClick ? 'pointer' : 'default'}`
    const marker = new this.AMap.Marker({
      position: this.toAmap(chosen),
      zooms: [8, 20],
      content,
      anchor: 'center',
      offset: new this.AMap.Pixel(0, 0),
      zIndex: 104,
      extData: { reservationId: segment.reservationId, kind: 'route-label' },
    })
    if (onRouteClick) {
      const handler = () => onRouteClick(segment.reservationId)
      marker.on('click', handler)
      this.listeners.push({ target: marker, handler })
    }
    return marker
  }

  private visibleLineLabelCoordinates(coordinates: [number, number][]) {
    const fallback = coordinates[bestLineLabelIndex(coordinates)]
    const container = this.map.getContainer?.()
    const rect = container?.getBoundingClientRect?.()
    if (!rect?.width || !rect?.height || !this.map.lngLatToContainer) return [fallback]
    const minX = this.viewportInsets.left + 28
    const maxX = rect.width - this.viewportInsets.right - 28
    const centerX = (minX + maxX) / 2
    const centerY = rect.height / 2
    const candidates: Array<{ coordinate: [number, number]; score: number }> = []
    coordinates.forEach((coordinate, index) => {
      if (index === 0 || index === coordinates.length - 1) return
      const pixel = this.map.lngLatToContainer(this.toAmap(coordinate))
      const x = Number(pixel?.getX?.() ?? pixel?.x)
      const y = Number(pixel?.getY?.() ?? pixel?.y)
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < minX || x > maxX || y < 28 || y > rect.height - 28) return
      const previous = coordinates[index - 1]
      const next = coordinates[index + 1]
      const a = [coordinate[1] - previous[1], coordinate[0] - previous[0]]
      const b = [next[1] - coordinate[1], next[0] - coordinate[0]]
      const straightness = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) || 1) * (Math.hypot(...b) || 1))
      const distance = Math.hypot((x - centerX) / Math.max(1, maxX - minX), (y - centerY) / rect.height)
      const score = straightness - distance * 0.8
      candidates.push({ coordinate, score })
    })
    return candidates.sort((a, b) => b.score - a.score).map(candidate => candidate.coordinate).concat([fallback])
  }

  private addSegment(segment: RouteRenderSegment) {
    if (segment.coordinates.length < 2) return
    const path = segment.coordinates.map(this.toAmap)
    // Match TREK's source rendering: only motorised transit gets the slim
    // white casing. Walking/direct/road lines are deliberately single-stroke.
    if (segment.kind === 'subway' || segment.kind === 'transit') {
      this.overlays.push(new this.AMap.Polyline({
        path,
        strokeColor: '#ffffff',
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 100,
      }))
    }
    this.overlays.push(new this.AMap.Polyline({
      path,
      ...segmentStyle(segment),
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 101,
    }))
  }

  private addSegmentText(segment: RouteRenderSegment) {
    if (!segment.label || segment.coordinates.length < 2 || segment.kind === 'walking') return
    const index = bestLineLabelIndex(segment.coordinates)
    const coordinate = segment.coordinates[index]
    const before = segment.coordinates[Math.max(0, index - 1)]
    const after = segment.coordinates[Math.min(segment.coordinates.length - 1, index + 1)]
    const horizontal = Math.abs(after[1] - before[1]) >= Math.abs(after[0] - before[0])
    this.overlays.push(new this.AMap.Text({
      position: this.toAmap(coordinate),
      text: segment.label,
      anchor: 'bottom-center',
      offset: new this.AMap.Pixel(horizontal ? 0 : 11, horizontal ? -11 : 0),
      zooms: [8, 20],
      zIndex: 104,
      style: {
        padding: '3px 7px',
        border: '1px solid rgba(255,255,255,0.95)',
        borderRadius: '6px',
        backgroundColor: segment.color,
        color: '#ffffff',
        fontSize: '12px',
        fontWeight: '700',
        lineHeight: '16px',
        boxShadow: 'none',
        whiteSpace: 'nowrap',
      },
      extData: { reservationId: segment.reservationId, kind: 'route-label' },
    }))
  }

  private addNode(node: RouteRenderNode, onRouteClick?: (reservationId: number) => void) {
    const center = this.toAmap(node.coordinate)
    const endpoint = node.priority === 'endpoint'
    const key = node.priority === 'key'
    const transfer = node.priority === 'transfer'
    const marker = new this.AMap.CircleMarker({
      center,
      radius: endpoint ? 3.5 : key ? 8 : transfer ? 4 : 4.5,
      fillColor: endpoint || key ? node.color : '#ffffff',
      fillOpacity: 1,
      strokeColor: endpoint || key ? '#ffffff' : node.color,
      strokeWeight: endpoint ? 1.5 : 2,
      zIndex: 103,
      extData: node,
    })
    if (onRouteClick) {
      const handler = () => onRouteClick(node.reservationId)
      marker.on('click', handler)
      this.listeners.push({ target: marker, handler })
    }
    this.overlays.push(marker)
  }

  private createNodeLabel(node: RouteRenderNode, segments: RouteRenderSegment[], occupied: Array<{ id?: string; x: number; y: number; width: number; height: number }>) {
    if (!node.title || node.priority === 'endpoint') return null
    const transferBadge = node.transfer ? transferBadgeDataUrl(node.transfer.from, node.transfer.to, node.color) : null
    // Match place labels: below-centre is the canonical position whenever it
    // fits. Only use sides/top to solve a real screen-space collision.
    const directions: Array<'right'|'left'|'top'|'bottom'> = ['bottom', 'right', 'left', 'top']
    const container = this.map.getContainer?.()
    if (!container) return null
    const span = document.createElement('span')
    span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:600 12px/16px sans-serif'
    span.textContent = node.title
    container.appendChild(span)
    const measured = span.getBoundingClientRect(); span.remove()
    const width = Math.max(Math.ceil(measured.width + 8), transferBadge?.width || 0)
    const height = Math.ceil(measured.height + (transferBadge ? transferBadge.height + 3 : 4))
    const point = this.screenPoint(node.coordinate)
    const gap = (node.priority === 'key' ? 11 : 8) + 3
    const rectFor = (direction: 'right'|'left'|'top'|'bottom') => ({
      x: direction === 'right' ? point.x + gap : direction === 'left' ? point.x - gap - width : point.x - width / 2,
      y: direction === 'bottom' ? point.y + gap : direction === 'top' ? point.y - gap - height : point.y - height / 2,
      width, height,
    })
    const blockers = [...occupied, ...this.lineRects]
    let direction = directions.find(candidate => this.free(rectFor(candidate), blockers))
    if (!direction) {
      const viewport = container.getBoundingClientRect()
      const overlapArea = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => {
        const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
        return overlapWidth * overlapHeight
      }
      direction = directions
        .map((candidate, order) => ({ candidate, order, rect: rectFor(candidate) }))
        .filter(({ rect }) => rect.x >= this.viewportInsets.left + 2 && rect.y >= 2
          && rect.x + rect.width <= viewport.width - this.viewportInsets.right - 2
          && rect.y + rect.height <= viewport.height - 2)
        .map(entry => ({ ...entry, penalty: blockers.reduce((sum, blocker) => sum + overlapArea(entry.rect, blocker), 0) }))
        .sort((a, b) => a.penalty - b.penalty || a.order - b.order)[0]?.candidate
    }
    if (!direction) return null
    const rect = rectFor(direction)
    occupied.push({ id: `station-label:${node.id}`, ...rect })
    this.labelRects.push({ id: `station-label:${node.id}`, rect })
    const content = document.createElement('div')
    content.dataset.markerKind = 'route-stop-label'
    content.style.cssText = `display:flex;width:${width}px;box-sizing:border-box;flex-direction:column;align-items:center;overflow:visible;white-space:nowrap;pointer-events:none;color:#374151;font:600 12px/16px sans-serif;text-shadow:-2px -2px 0 #fff,0 -2px 0 #fff,2px -2px 0 #fff,-2px 0 0 #fff,2px 0 0 #fff,-2px 2px 0 #fff,0 2px 0 #fff,2px 2px 0 #fff`
    const title = document.createElement('span'); title.textContent = node.title; content.appendChild(title)
    if (transferBadge) { const badge = document.createElement('img'); badge.src = transferBadge.image; badge.style.cssText = `width:${transferBadge.width}px;height:${transferBadge.height}px`; content.appendChild(badge) }
    return new this.AMap.Marker({
      position: this.toAmap(node.coordinate),
      zooms: [10, 20],
      content, anchor: 'center',
      offset: new this.AMap.Pixel(rect.x + width / 2 - point.x, rect.y + height / 2 - point.y),
      zIndex: 104,
      extData: { reservationId: node.reservationId, kind: 'route-stop-label' },
    })
  }

  private addNodeText(node: RouteRenderNode, segments: RouteRenderSegment[], nodes: RouteRenderNode[]) {
    if (!node.title || node.priority === 'endpoint') return
    const nearbyStation = nodes.find(candidate => candidate.id !== node.id && candidate.priority !== 'endpoint'
      && Math.hypot(candidate.coordinate[0] - node.coordinate[0], candidate.coordinate[1] - node.coordinate[1]) < 0.0015)
    const nearPlaceEndpoint = nodes.some(candidate => candidate.priority === 'endpoint'
      && Math.hypot(candidate.coordinate[0] - node.coordinate[0], candidate.coordinate[1] - node.coordinate[1]) < 0.0015)
    const direction = nearPlaceEndpoint
      ? 'right'
      : nearbyStation
        ? node.color === '#FF9500' ? 'left' : 'right'
        : labelDirectionForTangent(node.id, nearestTangent(node.coordinate, segments))
    const offsets = {
      right: [10, 0],
      left: [-10, 0],
      top: [0, -10],
      bottom: [0, 10],
    } as const
    const anchors = {
      right: 'middle-left',
      left: 'middle-right',
      top: 'bottom-center',
      bottom: 'top-center',
    } as const
    this.overlays.push(new this.AMap.Text({
      position: this.toAmap(node.coordinate),
      text: node.title,
      anchor: anchors[direction],
      offset: new this.AMap.Pixel(...offsets[direction]),
      zooms: [10, 20],
      zIndex: 104,
      style: {
        padding: '0',
        border: 'none',
        backgroundColor: 'transparent',
        color: '#374151',
        fontSize: '12px',
        fontWeight: '600',
        lineHeight: '16px',
        boxShadow: 'none',
        textShadow: '-2px -2px 0 #fff, 0 -2px 0 #fff, 2px -2px 0 #fff, -2px 0 0 #fff, 2px 0 0 #fff, -2px 2px 0 #fff, 0 2px 0 #fff, 2px 2px 0 #fff, 0 0 4px #fff',
        whiteSpace: 'nowrap',
      },
      extData: { reservationId: node.reservationId, kind: 'route-stop-label' },
    }))
  }
}
