import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../../../tests/helpers/render'
import { useSettingsStore } from '../../store/settingsStore'
import { useTripStore } from '../../store/tripStore'

vi.mock('./MapView', () => ({ MapView: () => <div data-testid="leaflet-map" /> }))
vi.mock('./glLazy', () => ({
  MapViewGLMapbox: () => <div data-testid="mapbox-map" />,
  MapViewGLMaplibre: () => <div data-testid="maplibre-map" />,
}))
vi.mock('./amapLazy', () => ({ AmapMapViewLazy: () => <div data-testid="amap-map" /> }))

import { MapViewAuto } from './MapViewAuto'

describe('MapViewAuto Trip geography provider', () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, map_provider: 'leaflet', amap_js_key: 'public-js-key' },
    }))
    useTripStore.setState({ trip: { id: 7, geo_provider: 'amap' } as any })
  })

  it('uses Amap only for the matching explicitly configured Trip', async () => {
    render(<MapViewAuto tripId={7} />)
    expect(await screen.findByTestId('amap-map')).toBeTruthy()
  })

  it('keeps the original renderer for a global Trip', () => {
    useTripStore.setState({ trip: { id: 7, geo_provider: 'global' } as any })
    render(<MapViewAuto tripId={7} />)
    expect(screen.getByTestId('leaflet-map')).toBeTruthy()
  })

  it('does not leak the active Trip choice into another map surface', () => {
    render(<MapViewAuto tripId={9} />)
    expect(screen.getByTestId('leaflet-map')).toBeTruthy()
  })

  it('falls back to Leaflet when the browser key is absent', () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, amap_js_key: '' } }))
    render(<MapViewAuto tripId={7} />)
    expect(screen.getByTestId('leaflet-map')).toBeTruthy()
  })
})

