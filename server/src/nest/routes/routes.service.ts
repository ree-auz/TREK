import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { RoadRoutePlanRequest, RoadRoutePlanResponse } from '@trek/shared';
import { TRIP_GEO_PROVIDER, type TripGeoProviderResolver } from '../maps/trip-geo-provider.token';
import { AmapRoadRouteProvider } from './amap-road-route.provider';

@Injectable()
export class RoutesService {
  constructor(private readonly amap: AmapRoadRouteProvider, @Inject(TRIP_GEO_PROVIDER) private readonly tripProvider: TripGeoProviderResolver) {}
  async plan(userId: number, request: RoadRoutePlanRequest): Promise<RoadRoutePlanResponse> {
    if (await this.tripProvider.resolve(userId, request.tripId) !== 'amap') throw new BadRequestException('This Trip does not use Amap');
    if (!this.amap.enabled()) throw new BadRequestException('Amap Web Service is not configured');
    return this.amap.plan(request.routeType, request.waypoints);
  }
}
