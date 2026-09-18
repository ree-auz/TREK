import { AmapTransitProvider } from '../../../src/nest/transit/amap-transit.provider';
import { amapStrategy } from '../../../src/nest/transit/transit.helpers';
import amapTransitResponse from '../../fixtures/amap-transit-response.json';

import { describe, expect, it, vi } from 'vitest';

describe('Amap transit provider', () => {
  it('maps UI preferences to Amap strategies', () => {
    expect(amapStrategy('best')).toBe('0');
    expect(amapStrategy('transfers')).toBe('2');
    expect(amapStrategy('walking')).toBe('3');
  });

  it('maps walking and subway segments into canonical legs', async () => {
    const client = {
      enabled: () => true,
      get: vi
        .fn()
        .mockResolvedValue({
          status: '1',
          route: {
            transits: [
              {
                duration: '1800',
                transfers: '0',
                segments: [
                  {
                    walking: {
                      origin: '116.404,39.915',
                      destination: '116.405,39.916',
                      duration: '300',
                      distance: '250',
                      steps: [{ polyline: '116.404,39.915;116.405,39.916' }],
                    },
                  },
                  {
                    bus: {
                      buslines: [
                        {
                          name: '地铁1号线',
                          type: '地铁线路',
                          duration: '1200',
                          distance: '9000',
                          start_time: '0805',
                          end_time: '0825',
                          departure_stop: { name: '天安门东', location: '116.405,39.916' },
                          arrival_stop: { name: '国贸', location: '116.46,39.91' },
                          via_stops: [{ name: 'x' }],
                          polyline: '116.405,39.916;116.46,39.91',
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        }),
    };
    const places = { reverse: vi.fn().mockResolvedValue({ citycode: '010', adcode: '110101' }) };
    const provider = new AmapTransitProvider(client as never, places as never);
    const result = await provider.plan({
      from: '39.9042,116.4074',
      to: '39.91,116.46',
      time: '2026-09-04T08:00:00+08:00',
      strategy: 'walking',
    });
    expect(result.itineraries[0].legs.map((l) => l.mode)).toEqual(['WALK', 'SUBWAY']);
    expect(result.itineraries[0].walkSeconds).toBe(300);
    expect(result.itineraries[0].legs[1]).toMatchObject({
      line: '地铁1号线',
      intermediateStops: 1,
      stopNodes: [expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) })],
      geometryPrecision: 5,
    });
    expect(String(client.get.mock.calls.at(-1)?.[1].strategy)).toBe('3');
  });

  it('parses the real response shape whose walking and bus polylines are wrapper objects', async () => {
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue(amapTransitResponse) };
    const places = { reverse: vi.fn().mockResolvedValue({ citycode: '023', adcode: '500103' }) };
    const provider = new AmapTransitProvider(client as never, places as never);

    const result = await provider.plan({
      from: '29.5514,106.5658',
      to: '29.5647,106.5516',
      time: '2026-09-04T08:00:00+08:00',
      strategy: 'best',
    });

    expect(result.itineraries).toHaveLength(1);
    expect(result.itineraries[0].legs.map((leg) => leg.mode)).toEqual(['WALK', 'SUBWAY', 'WALK']);
    expect(result.itineraries[0].legs.every((leg) => typeof leg.geometry === 'string')).toBe(true);
    expect(result.itineraries[0].legs[1]).toMatchObject({
      from: { name: '小什字' },
      to: { name: '较场口' },
      intermediateStops: 1,
      line: '轨道交通1号线(朝天门--璧山)',
    });
    expect(result).toMatchObject({ source: 'amap', fallbackUsed: false });
    expect(result.itineraries[0]).toMatchObject({
      startTime: '2026-09-04T00:00:00.000Z',
      endTime: '2026-09-04T00:31:00.000Z',
      duration: 1860,
      transfers: 0,
      walkSeconds: 580,
    });
    expect(result.itineraries[0].startTime).not.toContain('06:30');
    expect(result.itineraries[0].endTime).not.toContain('23:30');
  });

  it('keeps a zero-duration final walking segment and falls back to its endpoints', async () => {
    const response = structuredClone(amapTransitResponse);
    const finalWalk = response.route.transits[0].segments[2].walking;
    if (Array.isArray(finalWalk)) throw new Error('Expected final walking segment details');
    finalWalk.duration = '0';
    finalWalk.steps = [];
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue(response) };
    const places = { reverse: vi.fn().mockResolvedValue({ citycode: '023', adcode: '500103' }) };

    const result = await new AmapTransitProvider(client as never, places as never).plan({
      from: '29.5516,106.5660',
      to: '29.5649,106.5519',
      time: '2026-09-04T08:00:00+08:00',
    });

    expect(result.itineraries[0].legs.map((leg) => leg.mode)).toEqual(['WALK', 'SUBWAY', 'WALK']);
    expect(result.itineraries[0].legs[2]).toMatchObject({
      duration: 258,
      distance: 310,
      geometry: expect.any(String),
      geometryPrecision: 5,
    });
  });

  it('derives transfers from Amap transit legs when the response omits the summary', async () => {
    const response = structuredClone(amapTransitResponse);
    delete (response.route.transits[0] as { transfers?: string }).transfers;
    response.route.transits[0].segments.push(structuredClone(response.route.transits[0].segments[1]));
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue(response) };
    const places = { reverse: vi.fn().mockResolvedValue({ citycode: '023', adcode: '500103' }) };

    const result = await new AmapTransitProvider(client as never, places as never).plan({
      from: '29.5517,106.5661',
      to: '29.5650,106.5520',
      time: '2026-09-04T08:00:00+08:00',
    });

    expect(result.itineraries[0].transfers).toBe(1);
  });

  it('marks buslines in one Amap segment as alternatives instead of transfers', async () => {
    const response = structuredClone(amapTransitResponse);
    const segment = response.route.transits[0].segments[1];
    const alternative = structuredClone(segment.bus.buslines[0]);
    alternative.name = '轨道交通环线内环';
    alternative.departure_stop = { ...alternative.departure_stop, name: '另一上车站' };
    segment.bus.buslines.push(alternative);
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue(response) };
    const places = { reverse: vi.fn().mockResolvedValue({ citycode: '023', adcode: '500103' }) };

    const result = await new AmapTransitProvider(client as never, places as never).plan({
      from: '29.5518,106.5662', to: '29.5651,106.5521', time: '2026-09-04T08:00:00+08:00',
    });
    const rides = result.itineraries[0].legs.filter((leg) => leg.mode !== 'WALK');
    expect(rides).toHaveLength(2);
    expect(rides.map((leg) => leg.alternativeGroup)).toEqual(['segment-1', 'segment-1']);
    expect(result.itineraries[0].transfers).toBe(0);
    expect(rides[0].from.time).toBe(rides[1].from.time);
  });

  it('diagnoses an unexpected polyline type without throwing or exposing request data', async () => {
    const malformed = structuredClone(amapTransitResponse);
    (malformed.route.transits[0].segments[0].walking as { steps: Array<{ polyline: unknown }> }).steps[0].polyline = { coordinates: [] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue(malformed) };
    const places = { reverse: vi.fn().mockResolvedValue({ citycode: '023', adcode: '500103' }) };

    await expect(
      new AmapTransitProvider(client as never, places as never).plan({
        from: '29.5515,106.5659',
        to: '29.5648,106.5517',
        time: '2026-09-04T08:00:00+08:00',
      }),
    ).resolves.toMatchObject({ itineraries: expect.any(Array) });
    expect(warn).toHaveBeenCalledWith(
      '[Transit/Amap] parse failed field=route.transits[].segments[].walking.steps[].polyline actualType=object',
    );
    warn.mockRestore();
  });
});
