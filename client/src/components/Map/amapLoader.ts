export interface AmapBrowserConfig {
  key: string
  securityCode?: string
  securityServiceHost?: string
}

declare global {
  interface Window {
    AMap?: any
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string }
    __trekAmapReady?: () => void
  }
}

let loadPromise: Promise<any> | null = null
let loadedKey: string | null = null

function tagAmap(AMap: any): any {
  const config = AMap?.getConfig?.()
  if (config) config.appname = 'amap-jsapi-skill'
  return AMap
}

/** Load JS API 2.0 once. Security configuration must exist before the script. */
export function loadAmap(config: AmapBrowserConfig): Promise<any> {
  if (window.AMap) return Promise.resolve(tagAmap(window.AMap))
  if (loadPromise) {
    if (loadedKey !== config.key) return Promise.reject(new Error('Amap JS API is already loading with another key'))
    return loadPromise
  }

  loadedKey = config.key
  window._AMapSecurityConfig = config.securityServiceHost
    ? { serviceHost: config.securityServiceHost }
    : config.securityCode
      ? { securityJsCode: config.securityCode }
      : undefined

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const fail = (message: string) => {
      delete window.__trekAmapReady
      script.remove()
      loadPromise = null
      loadedKey = null
      reject(new Error(message))
    }
    const timeout = window.setTimeout(() => fail('Amap JS API load timed out'), 15_000)
    window.__trekAmapReady = () => {
      window.clearTimeout(timeout)
      delete window.__trekAmapReady
      if (window.AMap) resolve(tagAmap(window.AMap))
      else reject(new Error('Amap JS API loaded without exposing AMap'))
    }
    script.async = true
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.key)}&callback=__trekAmapReady`
    script.onerror = () => {
      window.clearTimeout(timeout)
      fail('Amap JS API failed to load')
    }
    document.head.appendChild(script)
  })
  return loadPromise
}
