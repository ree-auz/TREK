import { afterEach, describe, expect, it, vi } from 'vitest'

describe('AMap JS loader', () => {
  afterEach(() => {
    document.querySelectorAll('script[src*="webapi.amap.com"]').forEach((node) => node.remove())
    delete window.AMap
    delete window._AMapSecurityConfig
    delete window.__trekAmapReady
    vi.resetModules()
  })

  it('sets the preferred security proxy before appending the JS API script', async () => {
    const append = vi.spyOn(document.head, 'appendChild')
    const { loadAmap } = await import('./amapLoader')
    const pending = loadAmap({
      key: 'browser-key',
      securityCode: 'plaintext-fallback',
      securityServiceHost: '/_AMapService',
    })

    expect(window._AMapSecurityConfig).toEqual({ serviceHost: '/_AMapService' })
    const script = append.mock.calls[0][0] as HTMLScriptElement
    expect(script.src).toContain('key=browser-key')
    expect(script.src).not.toContain('plaintext-fallback')

    const appConfig = {}
    window.AMap = { Map: vi.fn(), getConfig: vi.fn(() => appConfig) }
    window.__trekAmapReady?.()
    await expect(pending).resolves.toBe(window.AMap)
    expect(appConfig).toEqual({ appname: 'amap-jsapi-skill' })
    append.mockRestore()
  })

  it('supports the documented plaintext security-code fallback without putting it in the URL', async () => {
    const append = vi.spyOn(document.head, 'appendChild')
    const { loadAmap } = await import('./amapLoader')
    const pending = loadAmap({ key: 'browser-key', securityCode: 'security-code' })

    expect(window._AMapSecurityConfig).toEqual({ securityJsCode: 'security-code' })
    const script = append.mock.calls[0][0] as HTMLScriptElement
    expect(script.src).not.toContain('security-code')
    window.AMap = {}
    window.__trekAmapReady?.()
    await pending
    append.mockRestore()
  })
})
