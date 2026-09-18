import { RotateCw, AlertTriangle, Layers3, Plus, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Tooltip } from '../shared/Tooltip'
import { MAP_DISCOVERY_LAYERS, type MapDiscoveryFeature } from './poiCategories'

interface Props {
  active: Set<string>
  onToggle: (key: string) => void
  loadingKeys?: Set<string>
  /** categories whose last fetch failed → show a retry affordance */
  errorKeys?: Set<string>
  /** true when the map moved since the last search → offer "search this area" */
  moved?: boolean
  onSearchArea?: () => void
  selectedFeature?: MapDiscoveryFeature | null
  onAddFeature?: (feature: MapDiscoveryFeature) => void
  onDismissFeature?: () => void
  /** Stretch the bar across its container and spread the segments evenly.
   *  The phone map gives it the full width between the screen margins; on
   *  desktop it floats, so it stays content-width there. */
  fullWidth?: boolean
}

// Frosted, icon-only segmented control that floats over the map. Active segments
// fill with the category colour (matching their markers); the label shows in a
// custom tooltip on hover so the pill stays compact and never needs to scroll.
export default function PoiCategoryPill({
  active, onToggle, loadingKeys, errorKeys, moved, onSearchArea,
  selectedFeature, onAddFeature, onDismissFeature, fullWidth,
}: Props) {
  const { t } = useTranslation()
  const anyError = !!errorKeys && Array.from(active).some(k => errorKeys.has(k))

  const frosted: React.CSSProperties = {
    background: 'var(--sidebar-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    boxShadow: 'var(--sidebar-shadow, 0 4px 16px rgba(0,0,0,0.14))',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: fullWidth ? '100%' : undefined }}>
      <div style={{
        display: fullWidth ? 'flex' : 'inline-flex',
        alignSelf: fullWidth ? 'stretch' : undefined,
        alignItems: 'center', gap: 2, padding: 4, borderRadius: 999, pointerEvents: 'auto', ...frosted,
      }}>
        <Tooltip label={t('poi.discoveryLayers')} placement="bottom">
          <span
            aria-hidden="true"
            className="text-content-muted"
            style={{ width: 28, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <Layers3 size={15} strokeWidth={2} />
          </span>
        </Tooltip>
        {MAP_DISCOVERY_LAYERS.map(cat => {
          const on = active.has(cat.key)
          // Only an active category can be loading — a deselected one whose fetch
          // is still winding down must not keep spinning.
          const loading = on && !!loadingKeys?.has(cat.key)
          return (
            <Tooltip key={cat.key} label={t(cat.labelKey)} placement="bottom">
              <button
                type="button"
                onClick={() => onToggle(cat.key)}
                aria-pressed={on}
                aria-label={t(cat.labelKey)}
                className={on ? '' : 'text-content-muted'}
                style={{
                  position: 'relative',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexGrow: fullWidth ? 1 : undefined,
                  flexShrink: fullWidth ? 1 : undefined,
                  flexBasis: fullWidth ? 0 : undefined,
                  minWidth: fullWidth ? 0 : undefined,
                  width: fullWidth ? 'auto' : 34, height: 34, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: on ? cat.color : 'transparent',
                  color: on ? '#fff' : undefined,
                  transition: 'background 0.14s, color 0.14s',
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
              >
                {loading ? (
                  <span
                    className="animate-spin"
                    style={{
                      width: 14, height: 14, borderRadius: 999, display: 'inline-block',
                      border: '2px solid', borderColor: on ? 'rgba(255,255,255,0.45)' : 'var(--border-primary)',
                      borderTopColor: on ? '#fff' : 'var(--text-muted)',
                    }}
                  />
                ) : (
                  <cat.Icon size={16} strokeWidth={2} />
                )}
                {on && !loading && errorKeys?.has(cat.key) && (
                  <span style={{
                    position: 'absolute', top: 2, right: 2, width: 8, height: 8,
                    borderRadius: 999, background: '#ef4444', border: '1.5px solid var(--sidebar-bg)',
                  }} />
                )}
              </button>
            </Tooltip>
          )
        })}
      </div>

      {selectedFeature && (
        <div
          data-testid="map-discovery-card"
          className="text-content"
          style={{
            width: fullWidth ? '100%' : 280,
            maxWidth: 'calc(100vw - 32px)',
            padding: '10px 11px',
            borderRadius: 12,
            pointerEvents: 'auto',
            boxSizing: 'border-box',
            ...frosted,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFeature.name}
              </div>
              {selectedFeature.address && (
                <div className="text-content-muted" style={{ marginTop: 2, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedFeature.address}
                </div>
              )}
              <div className="text-content-muted" style={{ marginTop: 4, fontSize: 10 }}>
                {t('poi.auxiliarySource', { source: selectedFeature.source === 'amap' ? 'AMap' : selectedFeature.source })}
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissFeature}
              aria-label={t('common.close')}
              className="text-content-muted"
              style={{ padding: 2, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex' }}
            >
              <X size={15} />
            </button>
          </div>
          {onAddFeature && (
            <button
              type="button"
              onClick={() => onAddFeature(selectedFeature)}
              style={{
                marginTop: 9, width: '100%', height: 30, border: 'none', borderRadius: 8,
                background: 'var(--accent, #4f46e5)', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                font: '600 12px var(--font-system)',
              }}
            >
              <Plus size={14} />
              {t('poi.addToTrip')}
            </button>
          )}
        </div>
      )}

      {(moved || anyError) && active.size > 0 && (
        <button
          type="button"
          onClick={onSearchArea}
          className="text-content"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 13px', borderRadius: 999, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit', pointerEvents: 'auto',
            color: anyError ? '#ef4444' : undefined,
            ...frosted,
          }}
        >
          {anyError
            ? <AlertTriangle size={13} strokeWidth={2.4} />
            : <RotateCw size={13} strokeWidth={2.4} />}
          {t('poi.searchThisArea')}
        </button>
      )}
    </div>
  )
}
