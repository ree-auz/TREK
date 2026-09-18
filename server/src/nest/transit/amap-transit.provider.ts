import { AmapPlacesProvider } from '../maps/amap-places.provider';
import { AmapClient } from '../maps/amap.client';
import {
  gcj02ToWgs84,
  parseAmapCoordinate,
  wgs84ToGcj02,
  type Coordinate,
} from '../maps/coordinate-transform';
import {
  amapStrategy,
  deriveTransitStats,
  type PlanQuery,
  type RoutePlanResponse,
  type TransitLeg,
  type TransitLegStop,
  type TransitProvider,
} from './transit.helpers';
import { Injectable } from '@nestjs/common';

const CITY_TTL = 10 * 60 * 1000;
const cityCache = new Map<string, { at: number; citycode: string }>();
const planCache = new Map<string, { at: number; value: RoutePlanResponse }>();

type RawStop = { name?: unknown; location?: unknown; entrance?: unknown; exit?: unknown };
type RawBusline = {
  name?: unknown;
  type?: unknown;
  distance?: unknown;
  duration?: unknown;
  departure_stop?: unknown;
  arrival_stop?: unknown;
  via_stops?: unknown;
  polyline?: unknown;
  start_time?: unknown;
  end_time?: unknown;
};
type RawWalking = {
  origin?: unknown;
  destination?: unknown;
  distance?: unknown;
  duration?: unknown;
  steps?: unknown;
};
type RawSegment = { walking?: unknown; bus?: unknown; railway?: unknown };

function actualType(value: unknown): 'array' | 'object' | 'string' | 'number' | 'boolean' | 'null' | 'undefined' {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value as Exclude<ReturnType<typeof actualType>, 'array' | 'null'>;
}

function parseDiagnostic(field: string, value: unknown): void {
  console.warn(`[Transit/Amap] parse failed field=${field} actualType=${actualType(value)}`);
}

function record(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  parseDiagnostic(field, value);
  return undefined;
}

function records(value: unknown, field: string): Array<Record<string, unknown>> {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    parseDiagnostic(field, value);
    return [];
  }
  return value.flatMap((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) return [item as Record<string, unknown>];
    parseDiagnostic(`${field}[]`, item);
    return [];
  });
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function point(value: unknown): Coordinate {
  const p = parseAmapCoordinate(value);
  return p ? gcj02ToWgs84(p) : { lat: 0, lng: 0 };
}
function stop(raw: RawStop | undefined, time: string | null): TransitLegStop {
  const p = point(raw?.location);
  return { name: text(raw?.name) ?? '', ...p, time, scheduledTime: time, track: null };
}
function encode(points: Coordinate[]): string | null {
  if (points.length < 2) return null;
  let out = '',
    lastLat = 0,
    lastLng = 0;
  const part = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1,
      s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5),
      lng = Math.round(p.lng * 1e5);
    out += part(lat - lastLat) + part(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}
function stringParts(value: unknown, field: string): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((part) => stringParts(part, `${field}[]`))
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') return value.split(';').map((part) => part.trim()).filter(Boolean);
  // With show_fields=polyline the real v5 transit API wraps both
  // walking.steps[].polyline and buslines[].polyline as
  // { polyline: "lng,lat;..." }. Older/fixture responses may expose the
  // inner string or an array directly, so normalize all documented shapes at
  // this single provider boundary.
  if (value && typeof value === 'object') {
    const wrapped = value as Record<string, unknown>;
    if ('polyline' in wrapped && wrapped.polyline !== value) return stringParts(wrapped.polyline, `${field}.polyline`);
  }
  if (value !== null && value !== undefined) parseDiagnostic(field, value);
  return [];
}

function geometry(field: string, ...values: unknown[]): string | null {
  const points = values
    .flatMap((value) => stringParts(value, field))
    .map(parseAmapCoordinate)
    .filter((p): p is Coordinate => !!p)
    .map(gcj02ToWgs84);
  return encode(points);
}

@Injectable()
export class AmapTransitProvider implements TransitProvider {
  readonly id = 'amap';
  constructor(
    private readonly client: AmapClient = new AmapClient(),
    private readonly places: AmapPlacesProvider = new AmapPlacesProvider(client),
  ) {}
  enabled(): boolean {
    return this.client.enabled();
  }
  private async city(point: Coordinate): Promise<string> {
    const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
    const hit = cityCache.get(key);
    if (hit && Date.now() - hit.at < CITY_TTL) return hit.citycode;
    const result = await this.places.reverse(point);
    if (!result?.citycode) throw Object.assign(new Error('Amap could not determine transit city'), { status: 502 });
    cityCache.set(key, { at: Date.now(), citycode: result.citycode });
    return result.citycode;
  }

  async plan(q: PlanQuery): Promise<RoutePlanResponse> {
    const cacheKey = JSON.stringify(q);
    const cached = planCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const [fl, fn] = q.from.split(',').map(Number),
      [tl, tn] = q.to.split(',').map(Number);
    const from = { lat: fl, lng: fn },
      to = { lat: tl, lng: tn };
    const origin = wgs84ToGcj02(from),
      destination = wgs84ToGcj02(to);
    const when = q.time ? new Date(q.time) : new Date();
    const common = {
      origin: `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}`,
      destination: `${destination.lng.toFixed(6)},${destination.lat.toFixed(6)}`,
    };
    const [city1, city2] = await Promise.all([this.city(from), this.city(to)]);
    const data = await this.client.get<{ route?: unknown }>('/v5/direction/transit/integrated', {
      ...common,
      city1,
      city2,
      strategy: amapStrategy(q.strategy),
      AlternativeRoute: '8',
      show_fields: 'cost,navi,polyline',
      date: when.toISOString().slice(0, 10),
      time: `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`,
    });
    const route = record(data.route, 'route');
    const itineraries = records(route?.transits, 'route.transits').flatMap((raw) => {
      const legs: TransitLeg[] = [];
      // Each AMap segment contains one walking connector and zero or more
      // buslines. Multiple buslines in the same segment are alternatives, not
      // consecutive rides; retain them for the UI selector but time/count the
      // group once.
      const alternativeGroups: number[][] = [];
      for (const [segmentIndex, segment] of (records(raw.segments, 'route.transits[].segments') as RawSegment[]).entries()) {
        const walk = record(segment.walking, 'route.transits[].segments[].walking') as RawWalking | undefined;
        const walkGeometry = walk
          ? geometry(
              'route.transits[].segments[].walking.steps[].polyline',
              ...records(walk.steps, 'route.transits[].segments[].walking.steps').map((step) => step.polyline),
            ) ?? geometry('route.transits[].segments[].walking.origin/destination', walk.origin, walk.destination)
          : null;
        // Real AMap responses occasionally omit/zero the walking duration while
        // still returning a useful first, transfer, or final walking shape. Keep
        // those segments whenever they carry route information; dropping them
        // leaves an otherwise valid transit path visually disconnected.
        const walkDistance = number(walk?.distance);
        if (walk && (number(walk.duration) > 0 || walkDistance > 0 || walkGeometry))
          legs.push({
            mode: 'WALK',
            from: stop({ name: 'Origin', location: walk.origin }, null),
            to: stop({ name: 'Destination', location: walk.destination }, null),
            duration: number(walk.duration) || Math.round(walkDistance / 1.2),
            distance: walkDistance || null,
            headsign: null,
            line: null,
            lineColor: null,
            lineTextColor: null,
            agency: null,
            intermediateStops: 0,
            geometry: walkGeometry,
            geometryPrecision: 5,
          });
        const bus = record(segment.bus, 'route.transits[].segments[].bus');
        const buslines = records(bus?.buslines, 'route.transits[].segments[].bus.buslines') as RawBusline[];
        const railway = record(segment.railway, 'route.transits[].segments[].railway') as RawBusline | undefined;
        const lines = buslines.length > 0 ? buslines : railway ? [railway] : [];
        const groupIndexes: number[] = [];
        for (const line of lines) {
          // start_time/end_time are the line's first/last service times, not this journey.
          const start = null,
            end = null;
          const lineType = text(line.type) ?? '',
            lineName = text(line.name) ?? '';
          const subway = /地铁|subway|metro/i.test(lineType) || /地铁|号线/.test(lineName);
          const departureStop = record(line.departure_stop, 'route.transits[].segments[].bus.buslines[].departure_stop') as
              | RawStop
              | undefined,
            arrivalStop = record(line.arrival_stop, 'route.transits[].segments[].bus.buslines[].arrival_stop') as
              | RawStop
              | undefined;
          const viaStops = records(
            line.via_stops,
            'route.transits[].segments[].bus.buslines[].via_stops',
          ) as RawStop[];
          groupIndexes.push(legs.length);
          legs.push({
            mode: subway ? 'SUBWAY' : 'BUS',
            from: stop(departureStop, start),
            to: stop(arrivalStop, end),
            duration: number(line.duration),
            distance: number(line.distance) || null,
            headsign: text(arrivalStop?.name) ?? null,
            line: lineName || null,
            lineColor: null,
            lineTextColor: null,
            agency: null,
            intermediateStops: viaStops.length,
            stopNodes: viaStops.map((viaStop) => stop(viaStop, null)),
            geometry: geometry('route.transits[].segments[].bus.buslines[].polyline', line.polyline),
            geometryPrecision: 5,
            alternativeGroup: lines.length > 1 ? `segment-${segmentIndex}` : undefined,
          });
        }
        if (groupIndexes.length) alternativeGroups.push(groupIndexes);
      }
      if (!legs.some((l) => l.mode !== 'WALK')) return [];
      const duration = number(raw.duration) || number(record(raw.cost, 'route.transits[].cost')?.duration);
      if (duration <= 0) return [];

      // Join walking connectors to the surrounding real stops. Provider
      // placeholders such as Origin/Destination must never leak into cards.
      legs.forEach((leg, index) => {
        if (leg.mode !== 'WALK') return;
        const previous = legs.slice(0, index).reverse().find((item) => item.mode !== 'WALK');
        const next = legs.slice(index + 1).find((item) => item.mode !== 'WALK');
        leg.from.name = previous?.to.name || 'START';
        leg.to.name = next?.from.name || 'END';
      });

      // Some real v5 responses omit busline.duration. Allocate the remaining
      // wall-clock time across actual ride groups (not across alternatives),
      // weighted by distance when available, so a valid trip never becomes a
      // sequence of zero-minute rides.
      const walkingSeconds = legs.filter((leg) => leg.mode === 'WALK').reduce((sum, leg) => sum + leg.duration, 0);
      const knownRideSeconds = alternativeGroups.reduce((sum, indexes) => sum + Math.max(...indexes.map((index) => legs[index].duration)), 0);
      const missingGroups = alternativeGroups.filter((indexes) => Math.max(...indexes.map((index) => legs[index].duration)) <= 0);
      const remainingRideSeconds = Math.max(0, duration - walkingSeconds - knownRideSeconds);
      const missingWeight = missingGroups.reduce((sum, indexes) => sum + Math.max(1, ...indexes.map((index) => legs[index].distance || 0)), 0);
      for (const indexes of missingGroups) {
        const weight = Math.max(1, ...indexes.map((index) => legs[index].distance || 0));
        const estimated = Math.max(60, Math.round(remainingRideSeconds * weight / Math.max(1, missingWeight)));
        indexes.forEach((index) => { legs[index].duration = estimated; });
      }

      const startAt = q.arriveBy ? when.getTime() - duration * 1000 : when.getTime();
      const endAt = q.arriveBy ? when.getTime() : when.getTime() + duration * 1000;
      const startTime = new Date(startAt).toISOString();
      const endTime = new Date(endAt).toISOString();
      let cursor = startAt;
      const groupByIndex = new Map<number, number[]>();
      alternativeGroups.forEach((indexes) => indexes.forEach((index) => groupByIndex.set(index, indexes)));
      const groupTimes = new Map<number, { start: number; end: number }>();
      const timedLegs = legs.map((leg, index) => {
        const group = groupByIndex.get(index);
        const groupDuration = group ? Math.max(...group.map((item) => legs[item].duration)) : leg.duration;
        let timing = group ? groupTimes.get(group[0]) : undefined;
        if (!timing) {
          timing = { start: cursor, end: Math.min(cursor + Math.max(0, groupDuration) * 1000, endAt) };
          if (group) groupTimes.set(group[0], timing);
          cursor = timing.end;
        }
        const legStart = new Date(timing.start).toISOString();
        const legEnd = index === legs.length - 1 ? endTime : new Date(timing.end).toISOString();
        return {
          ...leg,
          from: { ...leg.from, time: legStart, scheduledTime: legStart },
          to: { ...leg.to, time: legEnd, scheduledTime: legEnd },
        };
      });
      return [{
        startTime,
        endTime,
        ...deriveTransitStats(startTime, endTime, timedLegs, Math.max(0, alternativeGroups.length - 1)),
        distance: timedLegs.reduce((sum, leg) => sum + (leg.distance ?? 0), 0) || null,
        legs: timedLegs,
      }];
    });
    const value: RoutePlanResponse = { source: 'amap', fallbackUsed: false, itineraries };
    if (planCache.size >= 200) planCache.delete(planCache.keys().next().value!);
    planCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
}
