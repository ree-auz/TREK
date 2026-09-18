import type { Day, Reservation } from '../../types'

export type MapLatLng = [number, number]

export interface MapRouteSegment {
  mid: MapLatLng
  from: MapLatLng
  to: MapLatLng
  walkingText?: string
  drivingText?: string
}

export interface MapViewProps {
  // Map surfaces also receive Collection and mobile place projections, which
  // intentionally omit Trip-only fields such as trip_id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  places?: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dayPlaces?: any[]
  tripId?: number | string
  route?: MapLatLng[][] | null
  routeProfile?: string
  // Plugin route-via payloads are structurally validated by each renderer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routeVias?: any[]
  routeSegments?: MapRouteSegment[]
  selectedPlaceId?: number | null
  onMarkerClick?: (id: number) => void
  hoverDisabled?: boolean
  onMapClick?: (info: { latlng: { lat: number; lng: number } }) => void
  onMapContextMenu?: ((info: { latlng: { lat: number; lng: number }; originalEvent: MouseEvent | TouchEvent }) => void) | null
  center?: MapLatLng
  zoom?: number
  tileUrl?: string
  fitKey?: number | null
  dayOrderMap?: Record<number, number[] | null>
  leftWidth?: number
  rightWidth?: number
  hasInspector?: boolean
  hasDayDetail?: boolean
  reservations?: Reservation[]
  visibleConnectionIds?: number[]
  showTransitRoutes?: boolean
  days?: Day[]
  selectedDayId?: number | null
  showReservationStats?: boolean
  onReservationClick?: (reservationId: number) => void
  // POI sources differ between provider-backed exploration surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pois?: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPoiClick?: (poi: any) => void
  onViewportChange?: (bbox: { south: number; west: number; north: number; east: number }) => void
  onMapReady?: (map: unknown | null) => void
}
