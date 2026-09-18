import { describe, expect, it } from 'vitest'
import {
  compactTransitLine,
  groupAlternativeTransitLegs,
  inferredTransferCount,
  selectTransitAlternatives,
  transitAlternativeKey,
} from './transitAlternatives'

describe('parallel transit alternatives', () => {
  const leg = (line: string) => ({
    mode: 'BUS', line,
    from: { name: '上新街', lat: 29.551, lng: 106.592, time: '09:12' },
    to: { name: '黄桷垭', lat: 29.54, lng: 106.601, time: '09:12' },
  })

  it('renders same-section buses as one slash-separated choice', () => {
    const legs = [leg('346路(较场口--悠山路)'), leg('347路(菜园坝--老厂)'), leg('347路区间(上海城--老厂)')]
    expect(groupAlternativeTransitLegs(legs)).toHaveLength(1)
    expect(groupAlternativeTransitLegs(legs)[0].line).toBe('346/347/347区间')
    expect(inferredTransferCount(legs)).toBe(0)
  })

  it('keeps actual sequential sections separate', () => {
    const next = { ...leg('6号线'), mode: 'SUBWAY', from: { name: '黄桷垭' }, to: { name: '大剧院' } }
    expect(groupAlternativeTransitLegs([leg('346路'), next])).toHaveLength(2)
    expect(inferredTransferCount([leg('346路'), next])).toBe(1)
    expect(compactTransitLine('轨道交通6号线(北碚--茶园)')).toBe('6号线')
  })

  it('shows only the first parallel service until the user chooses one', () => {
    const legs = [leg('346路(较场口--悠山路)'), leg('347路(菜园坝--老厂)'), leg('347路区间(上海城--老厂)')]
    expect(selectTransitAlternatives(legs).map(item => item.line)).toEqual(['346路(较场口--悠山路)'])
  })

  it('uses the saved service for the same section', () => {
    const legs = [leg('346路(较场口--悠山路)'), leg('347路(菜园坝--老厂)'), leg('347路区间(上海城--老厂)')]
    const selected = { [transitAlternativeKey(legs[0])]: '347路区间(上海城--老厂)' }
    expect(selectTransitAlternatives(legs, selected).map(item => item.line)).toEqual(['347路区间(上海城--老厂)'])
  })

  it('uses the provider segment id when alternative services use different stops', () => {
    const first = { ...leg('210路'), alternativeGroup: 'segment-1' }
    const second = { ...leg('808路'), alternativeGroup: 'segment-1', from: { ...leg('808路').from, name: '另一上车站' } }
    expect(selectTransitAlternatives([first, second]).map(item => item.line)).toEqual(['210路'])
    expect(inferredTransferCount([first, second])).toBe(0)
  })
})
