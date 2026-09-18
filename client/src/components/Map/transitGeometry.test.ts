import { describe, expect, it } from 'vitest'
import { getTransitMapSegments } from './transitGeometry'

describe('getTransitMapSegments', () => {
  it('uses stored WGS84 endpoints for a walking leg without geometry', () => {
    const reservation = {
      type: 'transit',
      metadata: {
        transit: {
          legs: [{
            mode: 'WALK',
            line_color: null,
            geometry: null,
            from: { lat: 29.5606, lng: 106.5539 },
            to: { lat: 29.5647, lng: 106.5516 },
          }],
        },
      },
    }

    expect(getTransitMapSegments(reservation as never)).toEqual([{
      coords: [[29.5606, 106.5539], [29.5647, 106.5516]],
      color: null,
      walk: true,
      mode: 'WALK',
      line: null,
    }])
  })

  it('does not invent geometry for non-walking legs', () => {
    const reservation = {
      type: 'transit',
      metadata: {
        transit: {
          legs: [{
            mode: 'BUS',
            geometry: null,
            from: { lat: 29.56, lng: 106.55 },
            to: { lat: 29.57, lng: 106.56 },
          }],
        },
      },
    }

    expect(getTransitMapSegments(reservation as never)).toEqual([])
  })
})
