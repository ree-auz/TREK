import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, type LucideIcon } from 'lucide-react'
import { gcj02ToWgs84, wgs84ToGcj02 } from '@trek/shared'
import { pluginsApi, type PluginMapLayer, type PluginMapMarker } from '../../api/client'
import { useSettingsStore } from '../../store/settingsStore'
import { useAuthStore } from '../../store/authStore'
import { fetchPhoto, getAllThumbs, getCached, isLoading, onThumbReady } from '../../services/photoService'
import type { Place } from '../../types'
import { useTransportRoutes } from '../../hooks/useTransportRoutes'
import { visibleRouteReservations } from '../../utils/reservationRoutes'
import { renderIconMarkup } from '../../utils/iconMarkup'
import { safeHexColor } from '../../utils/safeColor'
import { CATEGORY_ICON_MAP, getCategoryIcon } from '../shared/categoryIcons'
import { POI_CATEGORY_BY_KEY } from './poiCategories'
import { loadAmap } from './amapLoader'
import type { MapViewProps } from './mapViewProps'
import { AmapRouteRenderer } from './AmapRouteRenderer'
import { buildRouteRenderModels } from './routeRendering'
import { layoutPlaceLabels, type LabelCandidateName, type LabelLayoutItem, type LabelRect } from './placeLabelLayout'
import { isCustomPlaceImage, photoCacheKey } from './placePhoto'
import { makeMarkerDraggable } from './markerDrag'

type LatLng = [number, number]

const TONE_COLORS = { default: '#4F46E5', success: '#10b981', warn: '#f59e0b', danger: '#ef4444' } as const

function toAmap([lat, lng]: LatLng): [number, number] {
  const point = wgs84ToGcj02({ lat, lng })
  return [point.lng, point.lat]
}

function fromAmap(lng: number, lat: number) {
  return gcj02ToWgs84({ lat, lng })
}

function iconMarkup(Icon: LucideIcon, size: number): string {
  return renderIconMarkup(createElement(Icon, { size, strokeWidth: 2.2, 'aria-hidden': true }))
}

function baseIconMarker(label: string, color: string, Icon: LucideIcon, selected = false): HTMLDivElement {
  const el = document.createElement('div')
  el.title = label
  el.setAttribute('aria-label', label)
  el.style.cssText = [
    `width:${selected ? 40 : 32}px`, `height:${selected ? 40 : 32}px`,
    'border-radius:50%', `background:${safeHexColor(color, '#6b7280')}`, 'border:3px solid white',
    `box-shadow:${selected ? '0 0 0 3px rgba(17,24,39,.35),0 3px 10px rgba(0,0,0,.3)' : '0 2px 7px rgba(0,0,0,.3)'}`,
    'display:flex', 'align-items:center', 'justify-content:center', 'color:white',
    'cursor:pointer', 'box-sizing:border-box',
  ].join(';')
  el.innerHTML = iconMarkup(Icon, selected ? 20 : 17)
  return el
}

function placeCategoryIcon(category: { category_icon?: string; category_name?: string }): LucideIcon {
  const configured = category.category_icon
  if (configured && configured !== 'MapPin' && CATEGORY_ICON_MAP[configured]) return getCategoryIcon(configured)
  const legacyIcon = configured && ({
    '🏨': 'BedDouble', '🍽️': 'UtensilsCrossed', '🏛️': 'Landmark', '🛍️': 'ShoppingBag',
    '🚌': 'Bus', '🎯': 'Activity', '☕': 'Coffee', '🏖️': 'Waves', '🌿': 'TreePine',
    '🚻': 'Bath', '🚽': 'Bath',
  } as Record<string, string>)[configured]
  if (legacyIcon) return getCategoryIcon(legacyIcon)
  const name = category.category_name?.toLowerCase() || ''
  if (/hotel|住宿|酒店|民宿/.test(name)) return getCategoryIcon('BedDouble')
  if (/restaurant|餐饮|餐厅|美食/.test(name)) return getCategoryIcon('UtensilsCrossed')
  if (/activity|活动|event|体验/.test(name)) return getCategoryIcon('Activity')
  if (/attraction|景点|景区|landmark/.test(name)) return getCategoryIcon('Landmark')
  if (/shopping|购物|商场/.test(name)) return getCategoryIcon('ShoppingBag')
  if (/transport|交通|公交|地铁/.test(name)) return getCategoryIcon('Bus')
  if (/bar|cafe|coffee|酒吧|咖啡/.test(name)) return getCategoryIcon('Coffee')
  if (/toilet|restroom|公厕|厕所|洗手间/.test(name)) return getCategoryIcon('Bath')
  if (/beach|海滩|沙滩/.test(name)) return getCategoryIcon('Waves')
  if (/nature|自然|公园/.test(name)) return getCategoryIcon('TreePine')
  return getCategoryIcon(configured)
}

export function placeMarkerContent(place: Place, orders: number[] | null | undefined, selected: boolean, photoUrl: string | null = null): HTMLDivElement {
  const category = place as Place & { category_color?: string; category_icon?: string; category_name?: string }
  const color = safeHexColor(category.category_color, '#6b7280')
  const Icon = placeCategoryIcon(category)
  const el = baseIconMarker(place.name, color, Icon, selected)
  // Match the OSM renderer's established 40/48px footprint. The category
  // outline is included in that diameter instead of increasing it.
  const size = selected ? 48 : 40
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.boxSizing = 'border-box'
  el.style.border = `3px solid ${color}`
  el.style.boxShadow = selected
    ? '0 0 0 4px rgba(17,24,39,.38),0 5px 16px rgba(0,0,0,.36)'
    : '0 0 0 2px rgba(17,24,39,.18),0 4px 12px rgba(0,0,0,.3)'
  if (photoUrl) {
    el.style.background = color
    // The order badge intentionally sits outside the circular photo. Clipping
    // belongs on the image itself, not the marker root.
    el.style.overflow = 'visible'
    const image = document.createElement('img')
    image.src = photoUrl
    image.alt = ''
    image.draggable = false
    image.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;border-radius:50%;pointer-events:none'
    el.replaceChildren(image)
  } else {
    el.innerHTML = iconMarkup(Icon, selected ? 22 : 19)
  }
  el.dataset.markerKind = 'place'
  if (orders?.length) {
    const badge = document.createElement('span')
    badge.textContent = orders.join('·')
    badge.style.cssText = [
      // Keep the badge inside the Marker content box. AMap may clip content that
      // extends beyond its measured footprint, especially after zoom/pan.
      'position:absolute', 'right:-1px', 'bottom:-1px', 'min-width:20px', 'height:20px',
      'padding:0 4px', 'border-radius:10px', 'background:#111827', 'border:2px solid white',
      'color:white', 'font:700 11px var(--font-system)', 'line-height:16px', 'text-align:center',
      'box-sizing:border-box', 'white-space:nowrap',
      'z-index:2', 'pointer-events:none',
    ].join(';')
    el.style.position = 'relative'
    el.appendChild(badge)
  }
  return el
}

function discoveryIconDataUrl(poi: { category: string }): string {
  const category = POI_CATEGORY_BY_KEY[poi.category]
  const color = safeHexColor(category?.color, '#0f766e')
  const glyph = iconMarkup(category?.Icon || MapPin, 16)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${color}" stroke="white" stroke-width="2"/><g transform="translate(7 7)" color="white">${glyph}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function validPoint(value: unknown): value is LatLng {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
}

const PLACE_ICON_SIZE = 40
const PLACE_ICON_Y_OFFSET = -18

function placeMarkerOuterSize(selected: boolean) {
  return selected ? 48 : PLACE_ICON_SIZE
}

function placeIconOffsets(places: Place[]): Map<number, [number, number]> {
  const counts = new Map<string, number>()
  const result = new Map<number, [number, number]>()
  for (const place of places) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue
    const key = `${Number(place.lat).toFixed(5)},${Number(place.lng).toFixed(5)}`
    const index = counts.get(key) || 0
    counts.set(key, index + 1)
    if (index === 0) result.set(place.id, [0, PLACE_ICON_Y_OFFSET])
    else {
      const angle = ((index - 1) % 8) * (Math.PI / 4)
      const radius = 22 + Math.floor((index - 1) / 8) * 12
      result.set(place.id, [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius) + PLACE_ICON_Y_OFFSET])
    }
  }
  return result
}

function measurePlaceLabel(container: HTMLElement, text: string, selected: boolean): { width: number; height: number; fontFamily: string } {
  const fontFamily = getComputedStyle(container).fontFamily || 'sans-serif'
  const strokeWidth = selected ? 5 : 4
  const span = document.createElement('span')
  Object.assign(span.style, {
    position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap',
    fontFamily, fontSize: `${selected ? 13 : 12}px`, fontWeight: `${selected ? 700 : 600}`,
    lineHeight: '18px', WebkitTextStroke: `${strokeWidth}px transparent`,
  })
  span.textContent = text
  container.appendChild(span)
  const rect = span.getBoundingClientRect()
  span.remove()
  return { width: Math.ceil(rect.width + strokeWidth * 2), height: Math.ceil(rect.height + strokeWidth * 2), fontFamily }
}

/**
 * Trip Planner's Amap renderer. TREK state remains WGS84; every coordinate is
 * converted only while entering/leaving this component.
 */
export function AmapMapView({
  places = [], dayPlaces = [], tripId, route = null, routeProfile = 'driving', routeVias = [], selectedPlaceId = null,
  onMarkerClick, onMapClick, onMapContextMenu = null, center = [20, 0], zoom = 3,
  fitKey = 0, dayOrderMap = {}, leftWidth = 0, rightWidth = 0, hasInspector = false,
  hasDayDetail = false, reservations = [], visibleConnectionIds = [], showTransitRoutes = true,
  days = [], selectedDayId = null, onReservationClick, pois = [], onPoiClick,
  onViewportChange, onMapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const amapRef = useRef<any>(null)
  const overlaysRef = useRef<any[]>([])
  const discoveryLayerRef = useRef<any>(null)
  const placeLabelLayerRef = useRef<any>(null)
  const previousLabelCandidatesRef = useRef(new Map<string, LabelCandidateName>())
  const placeLabelMarkersRef = useRef(new Map<string, { marker: any; handleClick: () => void; inLayer: boolean }>())
  const hoveredPlaceIdRef = useRef<number | null>(null)
  const debugOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const routeRendererRef = useRef<AmapRouteRenderer | null>(null)
  const [ready, setReady] = useState(false)
  const [labelLayoutRevision, setLabelLayoutRevision] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pluginMarkers, setPluginMarkers] = useState<PluginMapMarker[]>([])
  const [pluginLayers, setPluginLayers] = useState<PluginMapLayer[]>([])
  const settings = useSettingsStore((s) => s.settings)
  const placesPhotosEnabled = useAuthStore((s) => s.placesPhotosEnabled)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>(getAllThumbs)
  const pendingThumbsRef = useRef<Record<string, string>>({})
  const thumbRafRef = useRef<number | null>(null)
  const placeIds = useMemo(() => places.map(place => place.id).join(','), [places])

  useEffect(() => {
    if (!places.length || !placesPhotosEnabled) return
    const cleanups: Array<() => void> = []
    const setThumb = (cacheKey: string, thumb: string) => {
      pendingThumbsRef.current[cacheKey] = thumb
      if (thumbRafRef.current !== null) return
      thumbRafRef.current = requestAnimationFrame(() => {
        thumbRafRef.current = null
        const pending = pendingThumbsRef.current
        pendingThumbsRef.current = {}
        setPhotoUrls(previous => Object.entries(pending).some(([key, value]) => previous[key] !== value)
          ? { ...previous, ...pending }
          : previous)
      })
    }
    for (const place of places) {
      if (isCustomPlaceImage(place.image_url)) continue
      const cacheKey = photoCacheKey(place)
      if (!cacheKey) continue
      const cached = getCached(cacheKey)
      if (cached?.thumbDataUrl) { setThumb(cacheKey, cached.thumbDataUrl); continue }
      cleanups.push(onThumbReady(cacheKey, thumb => setThumb(cacheKey, thumb)))
      if (!isLoading(cacheKey)) {
        const photoId = (place.image_url?.startsWith('/api/maps/place-photo/') ? place.image_url : null)
          || place.google_place_id || place.osm_id || place.image_url
        if (photoId || (place.lat && place.lng)) fetchPhoto(cacheKey, photoId || `coords:${place.lat}:${place.lng}`, place.lat, place.lng, place.name)
      }
    }
    return () => {
      cleanups.forEach(cleanup => cleanup())
      if (thumbRafRef.current !== null) cancelAnimationFrame(thumbRafRef.current)
      thumbRafRef.current = null
    }
  }, [placeIds, placesPhotosEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleReservations = useMemo(() => visibleRouteReservations(reservations, {
    visibleConnectionIds, showTransitRoutes, selectedDayId, days,
  }), [reservations, visibleConnectionIds, showTransitRoutes, selectedDayId, days])
  const transportRoutes = useTransportRoutes(visibleReservations, tripId)
  const routeModels = useMemo(
    () => buildRouteRenderModels(visibleReservations, transportRoutes),
    [visibleReservations, transportRoutes],
  )

  useEffect(() => {
    if (tripId == null) { setPluginMarkers([]); setPluginLayers([]); return }
    let alive = true
    void Promise.all([
      pluginsApi.mapMarkers(tripId).then((r) => r.markers || []).catch(() => []),
      pluginsApi.mapLayers(tripId).then((r) => r.layers || []).catch(() => []),
    ]).then(([markers, layers]) => {
      if (alive) { setPluginMarkers(markers); setPluginLayers(layers) }
    })
    return () => { alive = false }
  }, [tripId])

  useEffect(() => {
    const key = settings.amap_js_key?.trim()
    if (!key || !containerRef.current) return
    let disposed = false
    const disposers: Array<() => void> = []
    loadAmap({
      key,
      securityCode: settings.amap_js_security_code?.trim() || undefined,
      securityServiceHost: settings.amap_js_security_service_host?.trim() || undefined,
    }).then(async (AMap) => {
      const appConfig = AMap.getConfig?.()
      if (appConfig) appConfig.appname = 'amap-jsapi-skill'
      if (disposed || !containerRef.current) return
      const container = containerRef.current

      // The planner mounts its map while the surrounding split panes are still
      // being laid out. AMap snapshots the container size in its constructor;
      // constructing at 0x0 leaves both the base-map canvas and polylines at
      // 0x0 even after the pane becomes visible. Wait for the first usable size
      // and then let AMap's resizeEnable handle subsequent pane changes.
      const initialRect = container.getBoundingClientRect()
      if ((initialRect.width <= 0 || initialRect.height <= 0) && typeof ResizeObserver !== 'undefined') {
        await new Promise<void>((resolve) => {
          const observer = new ResizeObserver(([entry]) => {
            const rect = entry?.contentRect
            if (!rect || rect.width <= 0 || rect.height <= 0) return
            observer.disconnect()
            resolve()
          })
          observer.observe(container)
          disposers.push(() => {
            observer.disconnect()
            resolve()
          })
        })
      }
      if (disposed || !containerRef.current) return
      amapRef.current = AMap
      const initial = dayPlaces.length > 0 ? dayPlaces : places
      const first = initial.find((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      const map = new AMap.Map(container, {
        zoom, center: toAmap(first ? [first.lat, first.lng] : center),
        mapStyle: settings.dark_mode === true || settings.dark_mode === 'dark' ? 'amap://styles/dark' : 'amap://styles/whitesmoke',
        features: ['bg', 'road', 'building'],
        viewMode: '2D', resizeEnable: true,
      })
      mapRef.current = map
      routeRendererRef.current = new AmapRouteRenderer(map, AMap, toAmap)
      const discoveryLayer = new AMap.LabelsLayer({
        zooms: [3, 20],
        zIndex: 90,
        collision: true,
        allowCollision: false,
      })
      discoveryLayerRef.current = discoveryLayer
      map.add(discoveryLayer)
      const placeLabelLayer = new AMap.LabelsLayer({
        zooms: [3, 20],
        zIndex: 170,
        collision: false,
        allowCollision: true,
      })
      placeLabelLayerRef.current = placeLabelLayer
      map.add(placeLabelLayer)
      const emitClick = (event: any) => {
        const point = fromAmap(event.lnglat.getLng(), event.lnglat.getLat())
        onMapClick?.({ latlng: point })
      }
      const emitContext = (event: any) => {
        const point = fromAmap(event.lnglat.getLng(), event.lnglat.getLat())
        onMapContextMenu?.({
          latlng: point,
          originalEvent: event.originEvent as MouseEvent,
        })
      }
      let layoutFrame = 0
      let settledLayoutTimer = 0
      const requestLabelLayout = () => {
        window.cancelAnimationFrame(layoutFrame)
        layoutFrame = window.requestAnimationFrame(() => setLabelLayoutRevision(revision => revision + 1))
      }
      const emitViewport = () => {
        requestLabelLayout()
        if (!onViewportChange) return
        const bounds = map.getBounds?.()
        const sw = bounds?.getSouthWest?.()
        const ne = bounds?.getNorthEast?.()
        if (!sw || !ne) return
        const a = fromAmap(sw.getLng(), sw.getLat())
        const b = fromAmap(ne.getLng(), ne.getLat())
        onViewportChange({ south: a.lat, west: a.lng, north: b.lat, east: b.lng })
      }
      // AMap fires zoomend before its final WebGL projection is always visible
      // to lngLatToContainer. Re-run once after that matrix settles so labels
      // rejected against stale pixels do not remain hidden until the next pan.
      const emitSettledViewport = () => {
        emitViewport()
        window.clearTimeout(settledLayoutTimer)
        settledLayoutTimer = window.setTimeout(requestLabelLayout, 120)
      }
      map.on('click', emitClick)
      map.on('rightclick', emitContext)
      map.on('moveend', emitSettledViewport)
      map.on('zoomend', emitSettledViewport)
      map.on('complete', emitViewport)
      const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(emitViewport)
      resizeObserver?.observe(container)
      disposers.push(() => {
        window.cancelAnimationFrame(layoutFrame)
        window.clearTimeout(settledLayoutTimer)
        resizeObserver?.disconnect()
        map.off?.('click', emitClick)
        map.off?.('rightclick', emitContext)
        map.off?.('moveend', emitSettledViewport)
        map.off?.('zoomend', emitSettledViewport)
        map.off?.('complete', emitViewport)
      })

      // AMap's rightclick covers desktop. Preserve TREK mobile's long-press →
      // add-place contract explicitly because touch browsers do not emit it.
      if (onMapContextMenu) {
        const container = containerRef.current
        let holdTimer: number | null = null
        const cancelHold = () => {
          if (holdTimer !== null) window.clearTimeout(holdTimer)
          holdTimer = null
        }
        const startHold = (event: TouchEvent) => {
          cancelHold()
          const touch = event.touches[0]
          if (!touch) return
          holdTimer = window.setTimeout(() => {
            const rect = container.getBoundingClientRect()
            const lnglat = map.containerToLngLat(new AMap.Pixel(touch.clientX - rect.left, touch.clientY - rect.top))
            const point = fromAmap(lnglat.getLng(), lnglat.getLat())
            onMapContextMenu({ latlng: point, originalEvent: event })
            holdTimer = null
          }, 550)
        }
        container.addEventListener('touchstart', startHold, { passive: true })
        container.addEventListener('touchmove', cancelHold, { passive: true })
        container.addEventListener('touchend', cancelHold, { passive: true })
        container.addEventListener('touchcancel', cancelHold, { passive: true })
        disposers.push(() => {
          cancelHold()
          container.removeEventListener('touchstart', startHold)
          container.removeEventListener('touchmove', cancelHold)
          container.removeEventListener('touchend', cancelHold)
          container.removeEventListener('touchcancel', cancelHold)
        })
      }
      setReady(true)
      onMapReady?.(null)
    }).catch((error: unknown) => {
      if (!disposed) setLoadError(error instanceof Error ? error.message : 'Amap JS API failed to load')
    })
    return () => {
      disposed = true
      disposers.forEach((dispose) => dispose())
      setReady(false)
      onMapReady?.(null)
      discoveryLayerRef.current?.clear?.()
      if (discoveryLayerRef.current && mapRef.current) mapRef.current.remove?.(discoveryLayerRef.current)
      discoveryLayerRef.current = null
      placeLabelLayerRef.current?.clear?.()
      placeLabelMarkersRef.current.forEach(({ marker, handleClick }) => marker.off?.('click', handleClick))
      placeLabelMarkersRef.current.clear()
      if (placeLabelLayerRef.current && mapRef.current) mapRef.current.remove?.(placeLabelLayerRef.current)
      placeLabelLayerRef.current = null
      routeRendererRef.current?.destroy()
      routeRendererRef.current = null
      mapRef.current?.destroy?.()
      mapRef.current = null
      amapRef.current = null
    }
  }, [settings.amap_js_key, settings.amap_js_security_code, settings.amap_js_security_service_host]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild host-owned overlays. No GCJ-02 coordinate escapes this boundary.
  useEffect(() => {
    const map = mapRef.current
    const AMap = amapRef.current
    if (!map || !AMap || !ready) return
    if (overlaysRef.current.length) map.remove(overlaysRef.current)
    const overlays: any[] = []
    const iconOffsets = placeIconOffsets(places)
    const addLine = (points: LatLng[], options: Record<string, unknown> = {}) => {
      if (points.length < 2) return
      overlays.push(new AMap.Polyline({ path: points.map(toAmap), strokeColor: '#4F46E5', strokeWeight: 4, ...options }))
    }

    const walkingRoute = routeProfile === 'walking' || routeProfile === 'foot'
    for (const segment of route || []) addLine(segment, {
      strokeColor: '#6366f1',
      strokeOpacity: 0.9,
      ...(walkingRoute ? {
        strokeWeight: 3,
        strokeStyle: 'dashed',
        strokeDasharray: [1, 7],
        lineCap: 'round',
        lineJoin: 'round',
      } : {}),
    })
    for (const place of places) {
      if (place.route_geometry) {
        try {
          const points = JSON.parse(place.route_geometry) as unknown[]
          addLine(points.filter(validPoint), { strokeColor: (place as Place & { category_color?: string }).category_color || '#64748b', strokeWeight: 3 })
        } catch { /* malformed legacy geometry stays hidden */ }
      }
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue
      const orders = dayOrderMap[place.id]
      const point: LatLng = [place.lat, place.lng]
      const [offsetX, offsetY] = iconOffsets.get(place.id) || [0, PLACE_ICON_Y_OFFSET]
      const offset = new AMap.Pixel(offsetX, offsetY)
      const cacheKey = photoCacheKey(place)
      const photoUrl = isCustomPlaceImage(place.image_url)
        ? place.image_url!
        : ((cacheKey && photoUrls[cacheKey]) || place.image_url || null)
      const content = placeMarkerContent(place, orders, place.id === selectedPlaceId, photoUrl)
      if (typeof navigator === 'undefined' || navigator.maxTouchPoints === 0) makeMarkerDraggable(content, place.id)
      const marker = new AMap.Marker({
        position: toAmap(point),
        content,
        anchor: 'center', zIndex: place.id === selectedPlaceId ? 160 : 150,
        ...(offset ? { offset } : {}),
      })
      marker.on('click', () => onMarkerClick?.(place.id))
      marker.on('mouseover', () => {
        hoveredPlaceIdRef.current = place.id
        setLabelLayoutRevision(revision => revision + 1)
      })
      marker.on('mouseout', () => {
        if (hoveredPlaceIdRef.current === place.id) hoveredPlaceIdRef.current = null
        setLabelLayoutRevision(revision => revision + 1)
      })
      overlays.push(marker)
    }
    for (const via of routeVias) {
      overlays.push(new AMap.CircleMarker({ center: toAmap([via.lat, via.lng]), radius: 7, fillColor: TONE_COLORS[via.tone], fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }))
    }

    for (const markerSpec of pluginMarkers) {
      overlays.push(new AMap.Marker({
        position: toAmap([markerSpec.lat, markerSpec.lng]),
        content: baseIconMarker(markerSpec.label || markerSpec.id, TONE_COLORS[markerSpec.tone], MapPin), anchor: 'center', zIndex: 110,
      }))
    }
    for (const layer of pluginLayers) {
      for (const feature of layer.features) {
        const color = TONE_COLORS[feature.tone]
        if (feature.type === 'polyline' && feature.points) addLine(feature.points, { strokeColor: color, strokeWeight: feature.width, strokeOpacity: feature.opacity, strokeStyle: feature.dash === 'solid' ? 'solid' : 'dashed' })
        if (feature.type === 'polygon' && feature.points) overlays.push(new AMap.Polygon({ path: feature.points.map(toAmap), strokeColor: color, strokeOpacity: feature.opacity, fillColor: color, fillOpacity: feature.fill ? Math.min(0.25, feature.opacity) : 0 }))
        if (feature.type === 'circle' && feature.center && feature.radiusM) overlays.push(new AMap.Circle({ center: toAmap(feature.center), radius: feature.radiusM, strokeColor: color, strokeOpacity: feature.opacity, fillColor: color, fillOpacity: feature.fill ? Math.min(0.25, feature.opacity) : 0 }))
      }
    }
    map.add(overlays)
    overlaysRef.current = overlays
    return () => { if (mapRef.current && overlays.length) mapRef.current.remove(overlays) }
  }, [ready, places, route, routeProfile, routeVias, selectedPlaceId, dayOrderMap, pluginMarkers, pluginLayers, onMarkerClick, photoUrls])

  useEffect(() => {
    const renderer = routeRendererRef.current
    const map = mapRef.current
    if (!ready || !renderer || !map) return
    renderer.setViewportInsets(leftWidth, rightWidth)
    const iconOffsets = placeIconOffsets(places)
    renderer.setCollisionObstacles(places.filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lng)).map(place => {
      const pixel = map.lngLatToContainer(toAmap([place.lat, place.lng]))
      const x = Number(pixel?.getX?.() ?? pixel?.x ?? 0)
      const y = Number(pixel?.getY?.() ?? pixel?.y ?? 0)
      const [offsetX, offsetY] = iconOffsets.get(place.id) || [0, PLACE_ICON_Y_OFFSET]
      const size = placeMarkerOuterSize(place.id === selectedPlaceId)
      const clearance = 4
      return {
        id: `place-icon:${place.id}`,
        x: x + offsetX - size / 2 - clearance,
        y: y + offsetY - size / 2 - clearance,
        width: size + clearance * 2,
        height: size + clearance * 2,
      }
    }))
    renderer.render(routeModels, onReservationClick)
    return () => renderer.clear()
  }, [ready, routeModels, onReservationClick, leftWidth, rightWidth, places, selectedPlaceId, labelLayoutRevision])

  useEffect(() => {
    const AMap = amapRef.current
    const map = mapRef.current
    const layer = placeLabelLayerRef.current
    const container = containerRef.current
    if (!ready || !AMap || !map || !layer || !container) return
    const visiblePlaces = places.filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lng))
    const containerRect = container.getBoundingClientRect()
    const iconOffsets = placeIconOffsets(visiblePlaces)
    const measured = new Map<number, ReturnType<typeof measurePlaceLabel>>()
    const items: LabelLayoutItem[] = visiblePlaces.map((place, index) => {
      const pixel = map.lngLatToContainer(toAmap([place.lat, place.lng]))
      const anchor = { x: Number(pixel?.getX?.() ?? pixel?.x ?? 0), y: Number(pixel?.getY?.() ?? pixel?.y ?? 0) }
      const [offsetX, offsetY] = iconOffsets.get(place.id) || [0, PLACE_ICON_Y_OFFSET]
      const selected = place.id === selectedPlaceId
      const size = measurePlaceLabel(container, place.name, selected)
      const markerSize = placeMarkerOuterSize(selected)
      measured.set(place.id, size)
      return {
        id: String(place.id), anchor,
        iconRect: {
          x: anchor.x + offsetX - markerSize / 2,
          y: anchor.y + offsetY - markerSize / 2,
          width: markerSize,
          height: markerSize,
        },
        size, priority: selected ? 300 : hoveredPlaceIdRef.current === place.id ? 250 : 100,
        stableOrder: index, previousCandidate: previousLabelCandidatesRef.current.get(String(place.id)),
      }
    })
    const viewport: LabelRect = { x: 2, y: 2, width: Math.max(0, containerRect.width - 4), height: Math.max(0, containerRect.height - 4) }
    const obstacles: Array<{ id: string; rect: LabelRect }> = []
    if (leftWidth > 0) obstacles.push({ id: 'left-sidebar', rect: { x: 0, y: 0, width: leftWidth, height: containerRect.height } })
    if (rightWidth > 0) obstacles.push({ id: 'right-sidebar', rect: { x: containerRect.width - rightWidth, y: 0, width: rightWidth, height: containerRect.height } })
    for (const obstacle of routeRendererRef.current?.getLabelRects() || []) obstacles.push(obstacle)
    const layout = layoutPlaceLabels(items, viewport, obstacles)
    previousLabelCandidatesRef.current = new Map([...layout.placements].map(([id, placement]) => [id, placement.candidate]))

    const liveIds = new Set(visiblePlaces.map(place => String(place.id)))
    for (const [id, entry] of placeLabelMarkersRef.current) {
      if (liveIds.has(id)) continue
      entry.marker.off?.('click', entry.handleClick)
      layer.remove?.(entry.marker)
      placeLabelMarkersRef.current.delete(id)
      previousLabelCandidatesRef.current.delete(id)
    }
    visiblePlaces.forEach((place) => {
        const labelPlacement = layout.placements.get(String(place.id))
        const selected = place.id === selectedPlaceId
        const size = measured.get(place.id)!
        const existing = placeLabelMarkersRef.current.get(String(place.id))
        if (!labelPlacement) {
          if (existing?.inLayer) { layer.remove?.(existing.marker); existing.inLayer = false }
          return
        }
        const text = {
          content: place.name,
          direction: labelPlacement.direction,
          offset: labelPlacement.offset,
          style: {
            fontSize: selected ? 13 : 12, fontWeight: selected ? 700 : 600,
            fontFamily: size.fontFamily, lineHeight: 18, fillColor: '#172033',
            strokeColor: 'rgba(255,255,255,0.98)', strokeWidth: selected ? 5 : 4,
          },
        }
        if (existing) {
          existing.marker.setPosition?.(toAmap([place.lat, place.lng]))
          existing.marker.setText?.(text)
          if (!existing.inLayer) { layer.add(existing.marker); existing.inLayer = true }
          return
        }
        const marker = new AMap.LabelMarker({
          position: toAmap([place.lat, place.lng]), zooms: [3, 20], rank: selected ? 200 : 100,
          icon: { type: 'image', image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E', size: [1, 1], anchor: 'center' },
          text, extData: { kind: 'place-label', placeId: place.id },
        })
        const handleClick = () => onMarkerClick?.(place.id)
        marker.on('click', handleClick)
        placeLabelMarkersRef.current.set(String(place.id), { marker, handleClick, inLayer: true })
        layer.add(marker)
      })
    const debug = new URLSearchParams(window.location.search).get('debugMapLabels') === '1'
      || window.localStorage.getItem('trek.debugMapLabels') === '1'
    debugOverlayRef.current?.remove()
    debugOverlayRef.current = null
    if (debug) {
      const canvas = document.createElement('canvas')
      canvas.dataset.mapLabelDebug = 'true'
      canvas.width = Math.max(1, Math.round(containerRect.width))
      canvas.height = Math.max(1, Math.round(containerRect.height))
      canvas.style.cssText = `position:fixed;left:${containerRect.left}px;top:${containerRect.top}px;z-index:9999;pointer-events:none`
      const context = canvas.getContext('2d')
      if (context) {
        context.font = '10px monospace'
        for (const item of items) { context.strokeStyle = '#06b6d4'; context.strokeRect(item.iconRect.x, item.iconRect.y, item.iconRect.width, item.iconRect.height) }
        for (const placement of layout.placements.values()) { context.strokeStyle = '#22c55e'; context.strokeRect(placement.rect.x, placement.rect.y, placement.rect.width, placement.rect.height); context.fillStyle = '#166534'; context.fillText(`${placement.id}:${placement.candidate}`, placement.rect.x, placement.rect.y - 2) }
        for (const rejection of layout.rejections) {
          context.strokeStyle = 'rgba(239,68,68,.18)'
          context.strokeRect(rejection.rect.x, rejection.rect.y, rejection.rect.width, rejection.rect.height)
          context.fillStyle = 'rgba(185,28,28,.75)'
          context.fillText(`${rejection.id}/${rejection.candidate}: ${rejection.reasons.join(',')}`, rejection.rect.x, rejection.rect.y + 10)
        }
        for (const id of layout.hidden) { const item = items.find(candidate => candidate.id === id); if (item) { context.fillStyle = '#dc2626'; context.fillText(`${id}: hidden`, item.anchor.x + 8, item.anchor.y + 8) } }
      }
      document.body.appendChild(canvas)
      debugOverlayRef.current = canvas
      console.debug('[map-label-layout]', { placements: [...layout.placements.values()], hidden: [...layout.hidden], rejections: layout.rejections })
    }
    return () => {
      debugOverlayRef.current?.remove()
      debugOverlayRef.current = null
    }
  }, [ready, places, selectedPlaceId, onMarkerClick, labelLayoutRevision, leftWidth, rightWidth, routeModels])

  // Provider-owned discovery results live in their own official LabelsLayer.
  // They never enter the host Marker collection, route model or Place ordering.
  useEffect(() => {
    const AMap = amapRef.current
    const layer = discoveryLayerRef.current
    if (!ready || !AMap || !layer) return
    layer.clear?.()
    const entries = pois
      .filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
      .map((poi) => {
        const marker = new AMap.LabelMarker({
          position: toAmap([poi.lat, poi.lng]),
          zooms: [11, 20],
          rank: 1,
          icon: {
            type: 'image',
            image: discoveryIconDataUrl(poi),
            size: [30, 30],
            anchor: 'center',
          },
          text: {
            content: poi.name,
            direction: 'top',
            offset: [0, -4],
            style: {
              fontSize: 11,
              fillColor: '#334155',
              strokeColor: '#ffffff',
              strokeWidth: 3,
            },
          },
          extData: poi,
        })
        const handleClick = () => onPoiClick?.(poi)
        marker.on('click', handleClick)
        return { marker, handleClick }
      })
    const markers = entries.map((entry) => entry.marker)
    if (markers.length) layer.add(markers)
    return () => {
      entries.forEach(({ marker, handleClick }) => marker.off?.('click', handleClick))
      layer.clear?.()
    }
  }, [ready, pois, onPoiClick])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selectedPlaceId) return
    const place = places.find((item) => item.id === selectedPlaceId) || dayPlaces.find((item) => item.id === selectedPlaceId)
    if (place) map.setZoomAndCenter(Math.max(map.getZoom(), 14), toAmap([place.lat, place.lng]), false, 350)
  }, [selectedPlaceId, ready, places, dayPlaces])

  const previousFitKey = useRef<number | null>(null)
  useEffect(() => {
    if (!ready || previousFitKey.current === fitKey) return
    previousFitKey.current = fitKey
    const map = mapRef.current
    const target = dayPlaces.length ? dayPlaces : places
    const points = target.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => toAmap([p.lat, p.lng]))
    for (const segment of route || []) for (const point of segment) points.push(toAmap(point))
    if (!points.length) return
    const bottom = hasInspector ? 320 : hasDayDetail ? 280 : 60
    const anchors = points.map((point) => new amapRef.current.Marker({ position: point }))
    map.setFitView(anchors, false, [60, rightWidth + 40, bottom, leftWidth + 40], 16)
  }, [fitKey, ready, dayPlaces, places, route, leftWidth, rightWidth, hasInspector, hasDayDetail])

  if (!settings.amap_js_key) {
    return <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-500">AMap JS key is not configured.</div>
  }
  if (loadError) {
    throw new Error(loadError)
  }
  return <div ref={containerRef} className="w-full h-full" data-testid="amap-map" />
}
