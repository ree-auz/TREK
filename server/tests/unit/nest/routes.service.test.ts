import { describe, expect, it, vi } from 'vitest';
import { RoutesService } from '../../../src/nest/routes/routes.service';

const request = { tripId: 7, routeType: 'driving' as const, waypoints: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] };

describe('RoutesService provider selection', () => {
  it('uses Amap only for an explicitly configured Trip', async () => {
    const result = { source: 'amap' as const, routeType: 'driving' as const, route: { coordinates: [], distance: 0, duration: 0, legs: [] } };
    const amap = { enabled: () => true, plan: vi.fn().mockResolvedValue(result) };
    const service = new RoutesService(amap as any, { resolve: vi.fn().mockResolvedValue('amap') });
    await expect(service.plan(2, request)).resolves.toBe(result);
  });

  it('does not call Amap for a global Trip', async () => {
    const amap = { enabled: () => true, plan: vi.fn() };
    const service = new RoutesService(amap as any, { resolve: vi.fn().mockResolvedValue('global') });
    await expect(service.plan(2, request)).rejects.toThrow('does not use Amap');
    expect(amap.plan).not.toHaveBeenCalled();
  });
});

