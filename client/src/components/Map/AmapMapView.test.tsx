import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { wgs84ToGcj02 } from '@trek/shared'
import { useSettingsStore } from '../../store/settingsStore'

const amapMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>()
  const markers: any[] = []
  const labelMarkers: any[] = []
  const lines: any[] = []
  const circles: any[] = []
  const discoveryLayers: any[] = []
  const map = {
    on: vi.fn((name: string, callback: (...args: any[]) => void) => handlers.set(name, callback)),
    off: vi.fn(), add: vi.fn(), remove: vi.fn(), destroy: vi.fn(), getZoom: vi.fn(() => 12),
    setZoomAndCenter: vi.fn(), setFitView: vi.fn(),
    getBounds: vi.fn(),
    lngLatToContainer: vi.fn(() => ({ x: 512, y: 384 })),
  }
  const AMap = {
    getConfig: vi.fn(() => ({})),
    Map: vi.fn(function () { return map }),
    Pixel: vi.fn(function (x: number, y: number) { return { x, y } }),
    Marker: vi.fn(function (options: any) {
      const marker = { options, on: vi.fn() }
      markers.push(marker)
      return marker
    }),
    LabelsLayer: vi.fn(function (options: any) {
      const layer = { options, add: vi.fn(), clear: vi.fn() }
      discoveryLayers.push(layer)
      return layer
    }),
    LabelMarker: vi.fn(function (options: any) {
      const marker = { options, on: vi.fn() }
      labelMarkers.push(marker)
      return marker
    }),
    Polyline: vi.fn(function (options: any) { const line = { options }; lines.push(line); return line }),
    CircleMarker: vi.fn(function (options: any) {
      const circle = { options, on: vi.fn(), off: vi.fn() }
      circles.push(circle)
      return circle
    }),
    Polygon: vi.fn(function (options: any) { return { options } }),
    Circle: vi.fn(function (options: any) { return { options } }),
  }
  return { handlers, markers, labelMarkers, lines, circles, discoveryLayers, map, AMap }
})

vi.mock('./amapLoader', () => ({ loadAmap: vi.fn(async () => amapMock.AMap) }))
vi.mock('../../api/client', () => ({
  mapsApi: { placePhoto: vi.fn(async () => ({ photoUrl: null })) },
  pluginsApi: {
    mapMarkers: vi.fn(async () => ({ markers: [] })),
    mapLayers: vi.fn(async () => ({ layers: [] })),
  },
}))
vi.mock('../../hooks/useTransportRoutes', () => ({ useTransportRoutes: () => new Map() }))

import { AmapMapView, placeMarkerContent } from './AmapMapView'

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const label = this instanceof HTMLSpanElement && this.style.visibility === 'hidden'
    const width = label ? Math.max(20, (this.textContent?.length || 0) * 12 + 8) : 1024
    const height = label ? 18 : 768
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
})

describe('AmapMapView coordinate boundary', () => {
  beforeEach(() => {
    amapMock.handlers.clear()
    amapMock.markers.length = 0
    amapMock.labelMarkers.length = 0
    amapMock.lines.length = 0
    amapMock.circles.length = 0
    amapMock.discoveryLayers.length = 0
    vi.clearAllMocks()
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, amap_js_key: 'browser-key', map_booking_labels: false },
    }))
  })

  it('converts WGS84 markers and route geometry to GCJ-02', async () => {
    const place = { id: 1, trip_id: 7, name: '故宫', lat: 39.9163, lng: 116.3972 } as any
    render(<AmapMapView places={[place]} route={[[[39.9163, 116.3972], [39.92, 116.4]]]} />)

    await waitFor(() => expect(amapMock.markers.length).toBeGreaterThan(0))
    const expected = wgs84ToGcj02({ lat: place.lat, lng: place.lng })
    expect(amapMock.markers[0].options.position[0]).toBeCloseTo(expected.lng, 6)
    expect(amapMock.markers[0].options.position[1]).toBeCloseTo(expected.lat, 6)
    expect(amapMock.lines[0].options.path[0]).toEqual(amapMock.markers[0].options.position)
  })

  it('uses a quiet basemap without provider POI labels', async () => {
    render(<AmapMapView />)

    await waitFor(() => expect(amapMock.AMap.Map).toHaveBeenCalled())
    expect(amapMock.AMap.Map).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mapStyle: 'amap://styles/whitesmoke',
      features: ['bg', 'road', 'building'],
    }))
  })

  it('converts an Amap click back to TREK WGS84', async () => {
    const onMapClick = vi.fn()
    render(<AmapMapView onMapClick={onMapClick} />)
    await waitFor(() => expect(amapMock.handlers.has('click')).toBe(true))
    const gcj = wgs84ToGcj02({ lat: 29.563, lng: 106.5516 })
    act(() => amapMock.handlers.get('click')?.({
      lnglat: { getLng: () => gcj.lng, getLat: () => gcj.lat },
    }))
    expect(onMapClick).toHaveBeenCalledWith({
      latlng: { lat: expect.closeTo(29.563, 5), lng: expect.closeTo(106.5516, 5) },
    })
  })

  it('maps saved transit endpoints to lightweight route nodes', async () => {
    const reservation = {
      id: 9,
      type: 'transit',
      endpoints: [
        { role: 'from', sequence: 0, name: '山城步道', lat: 29.55, lng: 106.56 },
        { role: 'stop', sequence: 1, name: '小什字', lat: 29.556, lng: 106.568 },
        { role: 'to', sequence: 2, name: '洪崖洞', lat: 29.565, lng: 106.552 },
      ],
    } as any

    render(<AmapMapView reservations={[reservation]} visibleConnectionIds={[9]} />)

    await waitFor(() => expect(amapMock.circles.filter(circle => circle.options.extData)).toHaveLength(2))
    const nodes = amapMock.circles.filter(circle => circle.options.extData)
    expect(nodes.map(circle => circle.options.extData.kind)).toEqual(['start', 'end'])
    expect(nodes.map(circle => circle.options.radius)).toEqual([3.5, 3.5])
    expect(amapMock.markers).toHaveLength(0)
  })

  it('keeps a place anchored above an overlapping transport endpoint', async () => {
    const place = { id: 1, trip_id: 7, name: '洪崖洞', lat: 29.565, lng: 106.552 } as any
    const reservation = {
      id: 11,
      type: 'bus',
      endpoints: [
        { role: 'from', sequence: 0, name: '洪崖洞站', lat: 29.565, lng: 106.552 },
        { role: 'to', sequence: 1, name: '解放碑站', lat: 29.56, lng: 106.57 },
      ],
    } as any

    render(<AmapMapView places={[place]} reservations={[reservation]} visibleConnectionIds={[11]} />)

    await waitFor(() => expect(amapMock.circles.some(circle => circle.options.extData?.kind === 'start')).toBe(true))
    const placeMarker = amapMock.markers.find((marker) => marker.options.content?.dataset.markerKind === 'place')
    const endpointMarker = amapMock.circles.find((circle) => circle.options.extData?.kind === 'start')
    expect(placeMarker.options.offset).toEqual({ x: 0, y: -18 })
    expect(placeMarker.options.zIndex).toBeGreaterThan(endpointMarker.options.zIndex)
    expect(endpointMarker.options.radius).toBe(3.5)
  })

  it('renders discovery results in a collision-aware LabelsLayer below TREK places', async () => {
    const onPoiClick = vi.fn()
    const poi = {
      osm_id: 'amap/B0FF', name: '山城步道', lat: 29.55, lng: 106.56,
      category: 'sights', poi_type: '风景名胜', address: null,
      website: null, phone: null, opening_hours: null, cuisine: null, source: 'amap',
    } as any
    render(<AmapMapView pois={[poi]} onPoiClick={onPoiClick} />)

    await waitFor(() => expect(amapMock.labelMarkers).toHaveLength(1))
    const discoveryLayer = amapMock.discoveryLayers.find(layer => layer.options.zIndex === 90)
    expect(discoveryLayer?.options).toMatchObject({
      zIndex: 90,
      collision: true,
      allowCollision: false,
    })
    expect(amapMock.markers).toHaveLength(0)
    expect(discoveryLayer?.add).toHaveBeenCalledWith(amapMock.labelMarkers)
    expect(amapMock.labelMarkers[0].options.extData).toBe(poi)
    const click = amapMock.labelMarkers[0].on.mock.calls.find(([event]: [string]) => event === 'click')?.[1]
    click?.()
    expect(onPoiClick).toHaveBeenCalledWith(poi)
  })

  it('draws first and final walking legs together with the transit geometry', async () => {
    const reservation = {
      id: 10,
      type: 'transit',
      endpoints: [
        { role: 'from', sequence: 0, name: '起点', lat: 29.55, lng: 106.56 },
        { role: 'to', sequence: 1, name: '终点', lat: 29.57, lng: 106.58 },
      ],
      metadata: {
        transit: {
          legs: [
            { mode: 'WALK', geometry: null, from: { lat: 29.55, lng: 106.56 }, to: { lat: 29.551, lng: 106.561 } },
            { mode: 'SUBWAY', line: '轨道交通1号线', geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', geometry_precision: 5, line_color: '#2563eb' },
            { mode: 'WALK', geometry: null, from: { lat: 29.569, lng: 106.579 }, to: { lat: 29.57, lng: 106.58 } },
          ],
        },
      },
    } as any

    render(<AmapMapView reservations={[reservation]} visibleConnectionIds={[10]} />)

    await waitFor(() => expect(amapMock.lines).toHaveLength(4))
    const routeLines = amapMock.lines.filter(line => line.options.zIndex === 101)
    expect(routeLines.map((line) => line.options.strokeStyle)).toEqual(['dashed', 'solid', 'dashed'])
    expect(routeLines.every(line => line.options.lineCap === 'round' && line.options.lineJoin === 'round')).toBe(true)
    const routeLabel = amapMock.markers.find(marker => marker.options.extData?.kind === 'route-label')
    expect(decodeURIComponent(routeLabel.options.content.src)).toContain('>1号线<')
    expect(decodeURIComponent(routeLabel.options.content.src)).toContain('#FF9500')
    expect(decodeURIComponent(routeLabel.options.content.src)).not.toContain('stroke="white"')
    expect(routeLabel.options.anchor).toBe('center')
    expect(routeLabel.options.offset).toEqual({ x: 0, y: 0 })
    expect(routeLabel.options.content.style.height).toBe('18px')
    const stationLabels = amapMock.markers.filter(marker => marker.options.extData?.kind === 'route-stop-label')
    expect(stationLabels.every(marker => Math.abs(marker.options.offset.x) + Math.abs(marker.options.offset.y) >= 8)).toBe(true)
  })

  it('renders the selected day walking route as a thin dotted round-cap line', async () => {
    render(<AmapMapView routeProfile="walking" route={[[[29.55, 106.56], [29.57, 106.58]]]} />)

    await waitFor(() => expect(amapMock.lines).toHaveLength(1))
    expect(amapMock.lines[0].options).toMatchObject({
      strokeWeight: 3,
      strokeStyle: 'dashed',
      strokeDasharray: [1, 7],
      lineCap: 'round',
      lineJoin: 'round',
    })
  })

  it('uses a place photo with the category colour as its outline', () => {
    const marker = placeMarkerContent({
      id: 12, name: '山城步道', category_color: '#16a34a',
    } as any, null, false, '/uploads/places/trail.jpg')

    expect(marker.style.border).toContain('rgb(22, 163, 74)')
    expect(marker.style.width).toBe('40px')
    expect(marker.style.height).toBe('40px')
    expect(marker.style.boxSizing).toBe('border-box')
    expect(marker.querySelector('img')?.getAttribute('src')).toBe('/uploads/places/trail.jpg')
  })

  it('renders place names in a higher-priority collision layer', async () => {
    const place = { id: 5, trip_id: 7, name: '苹果公园', lat: 39.93, lng: 116.4 } as any
    render(<AmapMapView places={[place]} />)

    await waitFor(() => expect(amapMock.labelMarkers.some(marker => marker.options.extData?.kind === 'place-label')).toBe(true))
    expect(amapMock.discoveryLayers.find(layer => layer.options.zIndex === 170)?.options).toMatchObject({ zIndex: 170, collision: false, allowCollision: true })
    const label = amapMock.labelMarkers.find(marker => marker.options.extData?.kind === 'place-label')
    expect(label.options.text.content).toBe('苹果公园')
    expect(label.options.rank).toBe(100)
    expect(label.options.text.direction).toBe('bottom')
    expect(label.options.text.offset).toEqual([0, 6])
  })

  it('fans co-located place names around their markers before collision avoidance', async () => {
    const places = [
      { id: 5, trip_id: 7, name: '三峡博物馆', lat: 29.55, lng: 106.56 },
      { id: 6, trip_id: 7, name: '重庆博物馆', lat: 29.55, lng: 106.56 },
    ] as any
    render(<AmapMapView places={places} />)

    await waitFor(() => expect(amapMock.labelMarkers.filter(marker => marker.options.extData?.kind === 'place-label')).toHaveLength(2))
    const labels = amapMock.labelMarkers.filter(marker => marker.options.extData?.kind === 'place-label')
    expect(labels).toHaveLength(2)
    expect(labels[0].options.text.direction).toBe('bottom')
    expect(labels[1].options.text.direction).not.toBe('bottom')
  })
})
