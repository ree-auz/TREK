import { describe, expect, it } from 'vitest'
import { buildRouteRenderModels } from './routeRendering'
import { bestLineLabelIndex, labelDirectionForTangent, segmentStyle } from './AmapRouteRenderer'

describe('buildRouteRenderModels', () => {
  it('keeps transit segments and route nodes separate from Place markers', () => {
    const reservation = {
      id: 7,
      type: 'transit',
      endpoints: [
        { role: 'from', sequence: 0, name: 'Start', lat: 30, lng: 120 },
        { role: 'stop', sequence: 1, name: 'Transfer', lat: 30.1, lng: 120.1 },
        { role: 'to', sequence: 2, name: 'End', lat: 30.2, lng: 120.2 },
      ],
      metadata: {
        transit: {
          legs: [
            { mode: 'WALK', geometry: null, from: { lat: 30, lng: 120 }, to: { lat: 30.01, lng: 120.01 } },
            { mode: 'SUBWAY', geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', geometry_precision: 5 },
          ],
        },
      },
    } as any

    const [model] = buildRouteRenderModels([reservation], new Map())

    expect(model.segments.map(segment => segment.kind)).toEqual(['walking', 'subway'])
    expect(model.nodes.map(node => node.kind)).toEqual(['start', 'end'])
    expect(model.nodes.every(node => node.reservationId === 7)).toBe(true)
    expect(model.segments.map(segment => segment.color)).toEqual(['#626B76', '#FF9500'])
    expect(model.nodes.every(node => node.priority === 'endpoint')).toBe(true)
  })

  it('uses routed road geometry without creating transport markers', () => {
    const reservation = {
      id: 8,
      type: 'car',
      endpoints: [
        { role: 'from', sequence: 0, name: 'Start', lat: 31, lng: 121 },
        { role: 'to', sequence: 1, name: 'End', lat: 31.2, lng: 121.2 },
      ],
    } as any
    const road = [[31, 121], [31.1, 121.15], [31.2, 121.2]] as [number, number][]

    const [model] = buildRouteRenderModels([reservation], new Map([[8, road]]))

    expect(model.segments).toEqual([expect.objectContaining({ kind: 'road', coordinates: road })])
    expect(model.nodes.map(node => node.kind)).toEqual(['start', 'end'])
  })

  it('keeps separate interchange endpoints but omits ordinary via stops', () => {
    const reservation = {
      id: 9,
      type: 'transit',
      endpoints: [
        { role: 'from', sequence: 0, name: 'Place A', lat: 29.5, lng: 106.5 },
        { role: 'to', sequence: 1, name: 'Place B', lat: 29.6, lng: 106.6 },
      ],
      metadata: {
        transit: {
          legs: [
            { mode: 'SUBWAY', line: '轨道交通2号线(较场口--鱼洞)', geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', geometry_precision: 5, from: { name: '临江门', lat: 29.51, lng: 106.51 }, to: { name: '黄花园', lat: 29.54, lng: 106.54 }, stop_nodes: [{ name: '大溪沟', lat: 29.53, lng: 106.53 }] },
            { mode: 'BUS', line: '181路(朝天门公交枢纽站--小杨公桥)', from: { name: '黄花园', lat: 29.541, lng: 106.541 }, to: { name: '肿瘤医院', lat: 29.58, lng: 106.58 }, stop_nodes: [{ name: '上清寺', lat: 29.56, lng: 106.56 }] },
          ],
        },
      },
    } as any

    const [model] = buildRouteRenderModels([reservation], new Map())
    const stationNodes = model.nodes.filter(node => node.id.includes('transit-stop'))

    expect(stationNodes.map(node => node.title)).toEqual(['临江门', '黄花园', '黄花园', '肿瘤医院'])
    expect(stationNodes.map(node => node.kind)).toEqual(['transit-stop', 'transfer', 'transfer', 'transit-stop'])
    expect(stationNodes.map(node => node.priority)).toEqual(['key', 'transfer', 'transfer', 'key'])
    expect(stationNodes.map(node => node.color)).toEqual(['#FF9500', '#FF9500', '#FF9500', '#0A84FF'])
    expect(stationNodes.some(node => node.title === '大溪沟' || node.title === '上清寺')).toBe(false)
    expect(model.segments[0].label).toBe('2号线')
    expect(stationNodes.some(node => node.transfer?.from === '2' && node.transfer?.to === '181')).toBe(false)
  })

  it('shortens subway names for compact route badges', () => {
    const reservation = {
      id: 10,
      type: 'transit',
      endpoints: [
        { sequence: 0, name: 'A', lat: 29.5, lng: 106.5 },
        { sequence: 1, name: 'B', lat: 29.6, lng: 106.6 },
      ],
      metadata: { transit: { legs: [{ mode: 'SUBWAY', line: '轨道交通6号线（北碚—茶园）', geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', geometry_precision: 5 }] } },
    } as any

    const [model] = buildRouteRenderModels([reservation], new Map())

    expect(model.segments[0].label).toBe('6号线')
  })

  it('records same-mode line changes on the transfer station', () => {
    const reservation = {
      id: 11, type: 'transit',
      endpoints: [
        { sequence: 0, name: 'A', lat: 24.5, lng: 118.1 },
        { sequence: 1, name: 'B', lat: 24.6, lng: 118.2 },
      ],
      metadata: { transit: { legs: [
        { mode: 'BUS', line: '52路', geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', geometry_precision: 5, from: { name: 'A站', lat: 24.5, lng: 118.1 }, to: { name: '金榜公园站', lat: 24.55, lng: 118.15 } },
        { mode: 'BUS', line: '42路', geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', geometry_precision: 5, from: { name: '金榜公园站', lat: 24.55, lng: 118.15 }, to: { name: 'B站', lat: 24.6, lng: 118.2 } },
      ] } },
    } as any

    const [model] = buildRouteRenderModels([reservation], new Map())
    expect(model.nodes.find(node => node.title === '金榜公园站')?.transfer).toEqual({ from: '52', to: '42' })
  })
})

describe('route label placement', () => {
  it('matches source line widths and dash patterns without changing route colours', () => {
    const segment = (kind: any, color: string) => ({ kind, color } as any)
    expect(segmentStyle(segment('transit', '#123456'))).toMatchObject({ strokeColor: '#123456', strokeWeight: 3.5, strokeStyle: 'solid' })
    expect(segmentStyle(segment('subway', '#abcdef'))).toMatchObject({ strokeColor: '#abcdef', strokeWeight: 3.5, strokeStyle: 'solid' })
    expect(segmentStyle(segment('walking', '#626B76'))).toMatchObject({ strokeColor: '#626B76', strokeWeight: 3, strokeDasharray: [1, 7] })
    expect(segmentStyle(segment('road', '#0A84FF'))).toMatchObject({ strokeColor: '#0A84FF', strokeWeight: 2.5, strokeStyle: 'solid' })
    expect(segmentStyle(segment('direct', '#626B76'))).toMatchObject({ strokeColor: '#626B76', strokeWeight: 2.5, strokeDasharray: [6, 6] })
  })

  it('places station labels perpendicular to the local route direction', () => {
    expect(['top', 'bottom']).toContain(labelDirectionForTangent('horizontal', [10, 1]))
    expect(['left', 'right']).toContain(labelDirectionForTangent('vertical', [1, 10]))
  })

  it('prefers a straight interior point for a route badge', () => {
    const coordinates = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] as [number, number][]
    expect(bestLineLabelIndex(coordinates)).toBe(1)
  })
})
