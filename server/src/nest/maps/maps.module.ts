import { PlacePhotosModule } from '../place-photos/place-photos.module';
import { StorageModule } from '../storage/storage.module';
import { AmapPlacesProvider } from './amap-places.provider';
import { AmapClient } from './amap.client';
import { MapsController } from './maps.controller';
import { MapsMcp } from './maps.mcp';
import { MapsService } from './maps.service';
import { TripGeoProviderService } from './trip-geo-provider.service';
import { TRIP_GEO_PROVIDER } from './trip-geo-provider.token';
import { Module } from '@nestjs/common';

/**
 * Maps / geo domain (L3 leaf module). Registered in AppModule. Exports
 * MapsService for the in-container consumers (BookingImportModule's Nominatim
 * geocoding, PlacesModule's search_place tool and list-import enrichment).
 * Nothing outside the container consumes this domain, so there is no bridge.
 */
@Module({
  imports: [PlacePhotosModule, StorageModule],
  controllers: [MapsController],
  providers: [MapsService, MapsMcp, AmapClient, AmapPlacesProvider, TripGeoProviderService, { provide: TRIP_GEO_PROVIDER, useExisting: TripGeoProviderService }],
  exports: [MapsService, AmapClient, AmapPlacesProvider, TripGeoProviderService, TRIP_GEO_PROVIDER],
})
export class MapsModule {}
