import { describe, expect, it, vi } from 'vitest';
import { AmapRoadRouteProvider } from '../../../src/nest/routes/amap-road-route.provider';

const response = {
  status: '1', info: 'OK', infocode: '10000',
  route: {
    origin: '106.551,29.563', destination: '106.56,29.57',
    paths: [{
      distance: '1400', cost: { duration: '1080' },
      steps: [
        { step_distance: '600', cost: { duration: '420' }, polyline: '106.556000,29.560000;106.560000,29.564000' },
        { step_distance: '800', cost: { duration: '660' }, polyline: ['106.560000,29.564000;106.565000,29.568000'] },
      ],
    }],
  },
};

describe('AmapRoadRouteProvider', () => {
  it.each([
    ['walking', '/v5/direction/walking'],
    ['driving', '/v5/direction/driving'],
    ['bicycling', '/v5/direction/bicycling'],
    ['electrobike', '/v5/direction/electrobike'],
  ] as const)('maps %s route geometry and metrics', async (routeType, endpoint) => {
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue(response) };
    const provider = new AmapRoadRouteProvider(client as any);
    const result = await provider.plan(routeType, [
      { lat: 29.56, lng: 106.55 }, { lat: 29.568, lng: 106.565 },
    ]);
    expect(client.get).toHaveBeenCalledWith(endpoint, expect.objectContaining({ show_fields: 'cost,polyline' }));
    expect(result).toMatchObject({ source: 'amap', routeType, route: { distance: 1400, duration: 1080 } });
    expect(result.route.coordinates).toHaveLength(3);
    expect(result.route.legs).toHaveLength(1);
    // Returned GCJ-02 must not leak into TREK's WGS84 contract.
    expect(result.route.coordinates[0][1]).not.toBe(106.556);
  });

  it('keeps one TREK leg per consecutive waypoint pair', async () => {
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue(response) };
    const provider = new AmapRoadRouteProvider(client as any);
    const result = await provider.plan('driving', [
      { lat: 29.56, lng: 106.55 }, { lat: 29.568, lng: 106.565 }, { lat: 29.57, lng: 106.57 },
    ]);
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(result.route.legs).toHaveLength(2);
    expect(result.route.distance).toBe(2800);
  });

  it('rejects a response without usable polyline geometry', async () => {
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue({ route: { paths: [{ distance: '1', steps: [] }] } }) };
    await expect(new AmapRoadRouteProvider(client as any).plan('walking', [
      { lat: 29.56, lng: 106.55 }, { lat: 29.57, lng: 106.56 },
    ])).rejects.toThrow('no usable geometry');
  });

  it('accepts path-level polyline geometry and caches an identical plan briefly', async () => {
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue({
      route: { paths: [{ distance: 900, duration: 600, polyline: '106.556,29.560;106.565,29.568', steps: [] }] },
    }) };
    const provider = new AmapRoadRouteProvider(client as any);
    const waypoints = [{ lat: 29.56, lng: 106.55 }, { lat: 29.568, lng: 106.565 }];
    const first = await provider.plan('bicycling', waypoints);
    const second = await provider.plan('bicycling', waypoints);
    expect(first.route.coordinates).toHaveLength(2);
    expect(second).toBe(first);
    expect(client.get).toHaveBeenCalledTimes(1);
  });
});
