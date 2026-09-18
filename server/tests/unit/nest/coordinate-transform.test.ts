import { gcj02ToWgs84, isMainlandChina, wgs84ToGcj02 } from '../../../src/nest/maps/coordinate-transform';

import { describe, expect, it } from 'vitest';

describe('Amap coordinate boundary', () => {
  it.each([
    ['Beijing', { lat: 39.9042, lng: 116.4074 }],
    ['Chongqing', { lat: 29.563, lng: 106.5516 }],
  ])('round-trips %s within one metre', (_name, wgs) => {
    const roundTrip = gcj02ToWgs84(wgs84ToGcj02(wgs));
    expect(roundTrip.lat).toBeCloseTo(wgs.lat, 5);
    expect(roundTrip.lng).toBeCloseTo(wgs.lng, 5);
  });

  it('leaves foreign and boundary-invalid coordinates unchanged', () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    expect(wgs84ToGcj02(paris)).toEqual(paris);
    expect(gcj02ToWgs84(paris)).toEqual(paris);
    expect(isMainlandChina({ lat: 18, lng: 110 })).toBe(false);
    expect(isMainlandChina({ lat: Number.NaN, lng: 110 })).toBe(false);
  });
});
