import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TripGeoProvider } from '@trek/shared';
import { DatabaseService } from '../database/database.service';

/** Resolves the explicit per-trip provider choice. It never infers geography. */
@Injectable()
export class TripGeoProviderService {
  constructor(private readonly database: DatabaseService) {}

  resolve(userId: number, tripId?: number): TripGeoProvider {
    if (tripId === undefined) return 'global';
    if (!this.database.canAccessTrip(tripId, userId)) {
      throw new ForbiddenException('No access to this trip');
    }
    return this.database.get<{ geo_provider?: TripGeoProvider }>(
      'SELECT geo_provider FROM trips WHERE id = ?',
      tripId,
    )?.geo_provider ?? 'global';
  }
}
