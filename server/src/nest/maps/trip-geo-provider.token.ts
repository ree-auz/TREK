import type { TripGeoProvider } from '@trek/shared';

export const TRIP_GEO_PROVIDER = Symbol('TRIP_GEO_PROVIDER');

export interface TripGeoProviderResolver {
  resolve(userId: number, tripId?: number): TripGeoProvider;
}
