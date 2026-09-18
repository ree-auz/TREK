import { routePlanResponseSchema } from './transit.schema';

import { describe, expect, it } from 'vitest';

describe('routePlanResponseSchema', () => {
  it('accepts provider metadata and a transit result', () => {
    expect(
      routePlanResponseSchema.safeParse({
        source: 'amap',
        fallbackUsed: false,
        itineraries: [
          {
            startTime: '2026-09-04T00:00:00Z',
            endTime: '2026-09-04T00:12:00Z',
            duration: 720,
            transfers: 0,
            walkSeconds: 720,
            distance: 1400,
            legs: [],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts Transitous fallback metadata', () => {
    expect(
      routePlanResponseSchema.safeParse({
        source: 'transitous',
        fallbackUsed: true,
        itineraries: [],
      }).success,
    ).toBe(true);
  });
});
