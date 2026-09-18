import { Utensils, Coffee, Wine, BedDouble, Camera, Landmark, Trees, Ticket, Bath, type LucideIcon } from 'lucide-react'

// The POI categories shown in the map "explore" pill. The `key` is the contract
// with the server (CATEGORY_OSM_FILTERS in mapsService.ts) — the OSM tag mapping
// lives there; label/icon/colour live here. `color` doubles as the active-pill
// fill AND the marker colour, so the pill and the map agree visually.
export interface MapDiscoveryLayerDefinition {
  key: string
  labelKey: string
  Icon: LucideIcon
  color: string
  providers: {
    trekCategory: string
    amap?: { keyword?: string; typeCodes: string[] }
  }
}

export const MAP_DISCOVERY_LAYERS: MapDiscoveryLayerDefinition[] = [
  { key: 'restaurant', labelKey: 'poi.cat.restaurants', Icon: Utensils, color: '#EF4444', providers: { trekCategory: 'restaurant', amap: { typeCodes: ['050000'] } } },
  { key: 'cafe', labelKey: 'poi.cat.cafes', Icon: Coffee, color: '#B45309', providers: { trekCategory: 'cafe', amap: { typeCodes: ['050500'] } } },
  { key: 'bar', labelKey: 'poi.cat.bars', Icon: Wine, color: '#A855F7', providers: { trekCategory: 'bar', amap: { typeCodes: ['080304'] } } },
  { key: 'hotel', labelKey: 'poi.cat.hotels', Icon: BedDouble, color: '#2563EB', providers: { trekCategory: 'hotel', amap: { typeCodes: ['100000'] } } },
  { key: 'sights', labelKey: 'poi.cat.sights', Icon: Camera, color: '#EC4899', providers: { trekCategory: 'sights', amap: { typeCodes: ['110000'] } } },
  { key: 'museum', labelKey: 'poi.cat.museums', Icon: Landmark, color: '#6366F1', providers: { trekCategory: 'museum', amap: { typeCodes: ['140100'] } } },
  { key: 'nature', labelKey: 'poi.cat.nature', Icon: Trees, color: '#16A34A', providers: { trekCategory: 'nature', amap: { typeCodes: ['110100'] } } },
  { key: 'activity', labelKey: 'poi.cat.activities', Icon: Ticket, color: '#F59E0B', providers: { trekCategory: 'activity', amap: { typeCodes: ['080000'] } } },
  { key: 'toilet', labelKey: 'poi.cat.toilets', Icon: Bath, color: '#0891B2', providers: { trekCategory: 'toilet', amap: { typeCodes: ['200300'] } } },
]

export const MAP_DISCOVERY_LAYER_BY_KEY: Record<string, MapDiscoveryLayerDefinition> = Object.fromEntries(
  MAP_DISCOVERY_LAYERS.map(c => [c.key, c]),
)

// Compatibility exports for existing Leaflet/GL marker helpers. New discovery
// controls and Providers should use the provider-neutral names above.
export type PoiCategory = MapDiscoveryLayerDefinition
export const POI_CATEGORIES = MAP_DISCOVERY_LAYERS
export const POI_CATEGORY_BY_KEY = MAP_DISCOVERY_LAYER_BY_KEY

// One POI result from /api/maps/pois (mirror of the server's OverpassPoi).
export interface MapDiscoveryFeature {
  osm_id: string
  name: string
  lat: number
  lng: number
  category: string
  poi_type: string
  address: string | null
  website: string | null
  phone: string | null
  opening_hours: string | null
  cuisine: string | null
  source: 'openstreetmap' | 'amap' | (string & {})
}

export type Poi = MapDiscoveryFeature
