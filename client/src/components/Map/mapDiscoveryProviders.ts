import { gcj02ToWgs84, wgs84ToGcj02 } from '@trek/shared'
import { mapsApi } from '../../api/client'
import { loadAmap, type AmapBrowserConfig } from './amapLoader'
import type { MapDiscoveryFeature, MapDiscoveryLayerDefinition } from './poiCategories'

export interface Bbox { south: number; west: number; north: number; east: number }

export interface MapDiscoveryProvider {
  id: string
  search(layer: MapDiscoveryLayerDefinition, bbox: Bbox, locale: string, signal: AbortSignal): Promise<MapDiscoveryFeature[]>
}

function abortError(): DOMException {
  return new DOMException('Map discovery request was cancelled', 'AbortError')
}

function bboxRadiusMeters(bbox: Bbox): number {
  const centerLat = (bbox.south + bbox.north) / 2
  const latMeters = Math.abs(bbox.north - bbox.south) * 111_320 / 2
  const lngMeters = Math.abs(bbox.east - bbox.west) * 111_320 * Math.cos(centerLat * Math.PI / 180) / 2
  return Math.max(100, Math.min(50_000, Math.ceil(Math.hypot(latMeters, lngMeters))))
}

function amapLocation(location: unknown): { lng: number; lat: number } | null {
  const value = location as { getLng?: () => number; getLat?: () => number; lng?: number; lat?: number } | null
  const lng = value?.getLng?.() ?? value?.lng
  const lat = value?.getLat?.() ?? value?.lat
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng: Number(lng), lat: Number(lat) } : null
}

function textValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export const trekDiscoveryProvider: MapDiscoveryProvider = {
  id: 'trek',
  async search(layer, bbox, locale, signal) {
    const response = await mapsApi.pois(layer.providers.trekCategory, bbox, locale, signal)
    return response.pois
  },
}

export function createAmapDiscoveryProvider(config: AmapBrowserConfig): MapDiscoveryProvider {
  return {
    id: 'amap',
    async search(layer, bbox, _locale, signal) {
      const query = layer.providers.amap
      if (!query) return []
      if (signal.aborted) throw abortError()
      const AMap = await loadAmap(config).then((loaded) => {
        const appConfig = loaded.getConfig?.()
        if (appConfig) appConfig.appname = 'amap-jsapi-skill'
        return loaded
      })
      await new Promise<void>((resolve) => AMap.plugin(['AMap.PlaceSearch'], resolve))
      if (signal.aborted) throw abortError()

      const centerWgs = { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 }
      const center = wgs84ToGcj02(centerWgs)
      const service = new AMap.PlaceSearch({
        type: query.typeCodes.join('|'),
        pageSize: 50,
        pageIndex: 1,
        extensions: 'all',
      })

      return new Promise<MapDiscoveryFeature[]>((resolve, reject) => {
        const cancel = () => reject(abortError())
        signal.addEventListener('abort', cancel, { once: true })
        service.searchNearBy(query.keyword ?? '', [center.lng, center.lat], bboxRadiusMeters(bbox), (status: string, result: any) => {
          signal.removeEventListener('abort', cancel)
          if (signal.aborted) return reject(abortError())
          if (status !== 'complete') return reject(new Error(`Amap PlaceSearch failed: ${status}`))
          const items = Array.isArray(result?.poiList?.pois) ? result.poiList.pois : []
          resolve(items.flatMap((item: any) => {
            const location = amapLocation(item.location)
            if (!location || !item.name) return []
            const point = gcj02ToWgs84({ lat: location.lat, lng: location.lng })
            return [{
              osm_id: `amap/${String(item.id || `${location.lng},${location.lat}`)}`,
              name: String(item.name),
              lat: point.lat,
              lng: point.lng,
              category: layer.key,
              poi_type: textValue(item.type) || layer.key,
              address: textValue(item.address),
              website: textValue(item.website),
              phone: textValue(item.tel),
              opening_hours: textValue(item.biz_ext?.open_time),
              cuisine: null,
              source: 'amap',
            } satisfies MapDiscoveryFeature]
          }))
        })
      })
    },
  }
}
