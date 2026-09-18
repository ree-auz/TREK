import { describe, expect, it, vi } from 'vitest'
import { gcj02ToWgs84 } from '@trek/shared'
import { POI_CATEGORY_BY_KEY } from './poiCategories'

const mocks = vi.hoisted(() => ({
  loadAmap: vi.fn(),
  mapsPois: vi.fn(),
  searchNearBy: vi.fn(),
}))

vi.mock('./amapLoader', () => ({ loadAmap: mocks.loadAmap }))
vi.mock('../../api/client', () => ({ mapsApi: { pois: mocks.mapsPois } }))

import { createAmapDiscoveryProvider, trekDiscoveryProvider } from './mapDiscoveryProviders'

describe('map discovery providers', () => {
  it('keeps the TREK provider behind the shared discovery contract', async () => {
    const expected = [{ osm_id: 'node/1' }]
    mocks.mapsPois.mockResolvedValueOnce({ pois: expected })
    const bbox = { south: 29.5, west: 106.5, north: 29.6, east: 106.6 }
    const signal = new AbortController().signal

    await expect(trekDiscoveryProvider.search(POI_CATEGORY_BY_KEY.cafe, bbox, 'zh-CN', signal)).resolves.toBe(expected)
    expect(mocks.mapsPois).toHaveBeenCalledWith('cafe', bbox, 'zh-CN', signal)
  })

  it('uses AMap PlaceSearch without letting the SDK auto-render on the map', async () => {
    const appConfig: Record<string, string> = {}
    const AMap = {
      getConfig: vi.fn(() => appConfig),
      plugin: vi.fn((_plugins: string[], callback: () => void) => callback()),
      PlaceSearch: vi.fn(function (options: any) {
        expect(options).not.toHaveProperty('map')
        expect(options).not.toHaveProperty('panel')
        return { searchNearBy: mocks.searchNearBy }
      }),
    }
    mocks.loadAmap.mockResolvedValueOnce(AMap)
    mocks.searchNearBy.mockImplementationOnce((_keyword, _center, _radius, callback) => callback('complete', {
      poiList: {
        pois: [{
          id: 'B0FF', name: '山城步道', location: { lng: 106.56, lat: 29.55 },
          type: '风景名胜', address: '重庆市渝中区', tel: ['023-123456'],
        }],
      },
    }))

    const provider = createAmapDiscoveryProvider({ key: 'browser-key' })
    const results = await provider.search(
      POI_CATEGORY_BY_KEY.sights,
      { south: 29.5, west: 106.5, north: 29.6, east: 106.6 },
      'zh-CN',
      new AbortController().signal,
    )

    expect(appConfig.appname).toBe('amap-jsapi-skill')
    expect(AMap.plugin).toHaveBeenCalledWith(['AMap.PlaceSearch'], expect.any(Function))
    expect(mocks.searchNearBy).toHaveBeenCalledWith('', expect.any(Array), expect.any(Number), expect.any(Function))
    expect(results[0]).toMatchObject({ osm_id: 'amap/B0FF', source: 'amap', category: 'sights', name: '山城步道' })
    expect(results[0].lat).toBeCloseTo(gcj02ToWgs84({ lat: 29.55, lng: 106.56 }).lat, 6)
  })

  it('uses the official AMap public-toilet category code', () => {
    expect(POI_CATEGORY_BY_KEY.toilet.providers.amap).toEqual({ typeCodes: ['200300'] })
    expect(POI_CATEGORY_BY_KEY.bar.providers.amap).toEqual({ typeCodes: ['080304'] })
  })
})
