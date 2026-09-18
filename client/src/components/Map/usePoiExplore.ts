import { useState, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'
import { useTripStore } from '../../store/tripStore'
import { createAmapDiscoveryProvider, trekDiscoveryProvider, type Bbox, type MapDiscoveryProvider } from './mapDiscoveryProviders'
import { MAP_DISCOVERY_LAYER_BY_KEY, type MapDiscoveryFeature } from './poiCategories'

export type { Bbox } from './mapDiscoveryProviders'

// A request we cancelled on purpose (newer search superseded it) — not a failure.
function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string } | null
  return e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED' || e?.name === 'AbortError'
}

/**
 * State for the map discovery-layer control. Categories select an auxiliary
 * information layer; Provider lookup is independent from TREK Place state.
 * Panning/zooming does not auto-refetch, which keeps provider load and visual
 * churn bounded while still offering an explicit refresh for the new viewport.
 */
export function usePoiExplore(tripId?: number | string) {
  const { locale } = useTranslation()
  const trip = useTripStore(state => state.trip)
  const amapKey = useSettingsStore(state => state.settings.amap_js_key)
  const amapSecurityCode = useSettingsStore(state => state.settings.amap_js_security_code)
  const amapSecurityServiceHost = useSettingsStore(state => state.settings.amap_js_security_service_host)
  const [active, setActive] = useState<Set<string>>(() => new Set())
  const [byCat, setByCat] = useState<Record<string, MapDiscoveryFeature[]>>({})
  const [selectedFeature, setSelectedFeature] = useState<MapDiscoveryFeature | null>(null)
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set())
  const [moved, setMoved] = useState(false)
  // Categories whose last Provider request genuinely failed, so the control can
  // offer a retry instead of looking like "no information here".
  const [errorKeys, setErrorKeys] = useState<Set<string>>(() => new Set())

  const bboxRef = useRef<Bbox | null>(null)
  // activeRef always mirrors the latest active set so async callbacks (fetch
  // completions) can check whether a category is still wanted.
  const activeRef = useRef(active)
  activeRef.current = active
  // One in-flight AbortController per layer, so re-toggling / refreshing cancels
  // the previous Provider request instead of racing it.
  const abortRef = useRef<Record<string, AbortController>>({})
  const provider = useMemo<MapDiscoveryProvider>(() => {
    const isAmapTrip = tripId != null
      && String(trip?.id) === String(tripId)
      && trip?.geo_provider === 'amap'
      && Boolean(amapKey?.trim())
    return isAmapTrip
      ? createAmapDiscoveryProvider({
          key: amapKey!.trim(),
          securityCode: amapSecurityCode?.trim() || undefined,
          securityServiceHost: amapSecurityServiceHost?.trim() || undefined,
        })
      : trekDiscoveryProvider
  }, [tripId, trip?.id, trip?.geo_provider, amapKey, amapSecurityCode, amapSecurityServiceHost])

  const setLoading = useCallback((key: string, on: boolean) => setLoadingKeys(prev => {
    const next = new Set(prev)
    if (on) next.add(key); else next.delete(key)
    return next
  }), [])

  const setError = useCallback((key: string, on: boolean) => setErrorKeys(prev => {
    if (on === prev.has(key)) return prev
    const next = new Set(prev)
    if (on) next.add(key); else next.delete(key)
    return next
  }), [])

  const fetchCat = useCallback(async (key: string, bbox: Bbox) => {
    const layer = MAP_DISCOVERY_LAYER_BY_KEY[key]
    if (!layer) return
    abortRef.current[key]?.abort()
    const ctrl = new AbortController()
    abortRef.current[key] = ctrl
    setLoading(key, true)
    setError(key, false)
    try {
      const results = await provider.search(layer, bbox, locale, ctrl.signal)
      // Drop the result if the user toggled this category off while the (slow)
      // Overpass request was in flight — otherwise stale results re-appear.
      setByCat(prev => (activeRef.current.has(key) ? { ...prev, [key]: results } : prev))
    } catch (err) {
      // A superseded request was aborted on purpose — leave its state untouched
      // so the newer request owns the spinner and results.
      if (isAbortError(err)) return
      // A real failure (every Overpass mirror down/timed out): surface it instead
      // of a silent empty so the user can retry rather than assume "no places".
      setByCat(prev => (activeRef.current.has(key) ? { ...prev, [key]: [] } : prev))
      if (activeRef.current.has(key)) setError(key, true)
    } finally {
      // Only the latest controller for this key clears the spinner; a superseded
      // one must not, or it would hide the newer request's in-flight state.
      if (abortRef.current[key] === ctrl) {
        setLoading(key, false)
        delete abortRef.current[key]
      } else if (!abortRef.current[key]) {
        // Cancelled with nothing taking over (toggle switched the category, or
        // turned it off) — no later request will clear this key, so do it here
        // instead of leaving the pill spinning forever.
        setLoading(key, false)
      }
    }
  }, [setLoading, setError, locale, provider])

  const onViewportChange = useCallback((bbox: Bbox) => {
    bboxRef.current = bbox
    if (activeRef.current.size > 0) setMoved(true)
  }, [])

  // Each category is an independent auxiliary layer. Clicking it once enables
  // it without disturbing the other layers; clicking the same category again
  // disables only that layer and removes only its own results.
  const toggle = useCallback((key: string) => {
    const isActive = activeRef.current.has(key)
    setMoved(false)
    setSelectedFeature(null)
    if (isActive) {
      abortRef.current[key]?.abort()
      delete abortRef.current[key]
      setActive(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      setByCat(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setError(key, false)
      return
    }
    setActive(prev => new Set(prev).add(key))
    if (bboxRef.current) fetchCat(key, bboxRef.current)
  }, [fetchCat, setError])

  const searchArea = useCallback(() => {
    const bbox = bboxRef.current
    if (!bbox) return
    setMoved(false)
    activeRef.current.forEach(key => fetchCat(key, bbox))
  }, [fetchCat])

  const pois = useMemo(() => Object.values(byCat).flat(), [byCat])
  const selectFeature = useCallback((feature: MapDiscoveryFeature) => setSelectedFeature(feature), [])
  const clearSelection = useCallback(() => setSelectedFeature(null), [])

  return {
    active,
    pois,
    selectedFeature,
    providerId: provider.id,
    loadingKeys,
    errorKeys,
    moved,
    toggle,
    searchArea,
    onViewportChange,
    selectFeature,
    clearSelection,
  }
}
