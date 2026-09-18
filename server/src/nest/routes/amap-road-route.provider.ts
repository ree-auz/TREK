import { Injectable } from '@nestjs/common';
import type { RoadRoutePlanResponse, RoadRouteType } from '@trek/shared';
import { gcj02ToWgs84, wgs84ToGcj02 } from '@trek/shared';
import { AmapClient, AmapProviderError } from '../maps/amap.client';

type UnknownRecord = Record<string, unknown>;
const record = (v: unknown): UnknownRecord | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as UnknownRecord : null;
function records(v: unknown): UnknownRecord[] {
  if (Array.isArray(v)) return v.map(record).filter((x): x is UnknownRecord => x !== null);
  const x = record(v); return x ? [x] : [];
}
function numberValue(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function stringParts(v: unknown): string[] {
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string')
    .flatMap((x) => x.split(';')).map((x) => x.trim()).filter(Boolean);
}
function geometry(steps: UnknownRecord[]): [number, number][] {
  const out: [number, number][] = [];
  for (const value of steps.flatMap((step) => stringParts(step.polyline))) {
    const [lngRaw, latRaw] = value.split(',');
    const lng = Number(lngRaw); const lat = Number(latRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const wgs = gcj02ToWgs84({ lat, lng });
    const point: [number, number] = [wgs.lat, wgs.lng];
    const previous = out.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) out.push(point);
  }
  return out;
}

const ENDPOINT: Record<RoadRouteType, string> = {
  walking: '/v5/direction/walking', driving: '/v5/direction/driving',
  bicycling: '/v5/direction/bicycling', electrobike: '/v5/direction/electrobike',
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 300;

@Injectable()
export class AmapRoadRouteProvider {
  private readonly cache = new Map<string, { expiresAt: number; response: RoadRoutePlanResponse }>();

  constructor(private readonly client: AmapClient) {}
  enabled(): boolean { return this.client.enabled(); }

  async plan(routeType: RoadRouteType, waypoints: Array<{ lat: number; lng: number }>): Promise<RoadRoutePlanResponse> {
    const cacheKey = `${routeType}:${waypoints.map(({ lat, lng }) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(';')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.response;
    if (cached) this.cache.delete(cacheKey);
    const coordinates: [number, number][] = [];
    const legs: RoadRoutePlanResponse['route']['legs'] = [];
    let distance = 0; let duration = 0;
    // v5 takes one origin/destination pair. Preserve TREK's per-waypoint legs
    // by routing consecutive pairs rather than discarding intermediate stops.
    for (let index = 0; index < waypoints.length - 1; index++) {
      const from = waypoints[index]; const to = waypoints[index + 1];
      const origin = wgs84ToGcj02(from); const destination = wgs84ToGcj02(to);
      const response = await this.client.get<UnknownRecord>(ENDPOINT[routeType], {
        origin: `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}`,
        destination: `${destination.lng.toFixed(6)},${destination.lat.toFixed(6)}`,
        show_fields: 'cost,polyline',
      });
      const route = record(response.route) ?? record(response.data);
      const path = records(route?.paths)[0];
      if (!path) throw new AmapProviderError(`Amap ${routeType} returned no route`);
      const steps = records(path.steps);
      let legGeometry = geometry(steps);
      if (legGeometry.length < 2) legGeometry = geometry([{ polyline: path.polyline }]);
      if (legGeometry.length < 2) throw new AmapProviderError(`Amap ${routeType} returned no usable geometry`);
      const legDistance = numberValue(path.distance) || steps.reduce((sum, step) => sum + numberValue(step.step_distance ?? step.distance), 0);
      const cost = record(path.cost);
      const legDuration = numberValue(cost?.duration ?? path.duration)
        || steps.reduce((sum, step) => sum + numberValue(record(step.cost)?.duration ?? step.duration), 0);
      const mid = legGeometry[Math.floor(legGeometry.length / 2)] ?? [(from.lat + to.lat) / 2, (from.lng + to.lng) / 2] as [number, number];
      if (coordinates.length) legGeometry.shift();
      coordinates.push(...legGeometry); distance += legDistance; duration += legDuration;
      legs.push({ from: [from.lat, from.lng], to: [to.lat, to.lng], mid, distance: legDistance, duration: legDuration });
    }
    const response: RoadRoutePlanResponse = { source: 'amap', routeType, route: { coordinates, distance, duration, legs } };
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, response });
    return response;
  }
}
