import { Module } from '@nestjs/common';
import { MapsModule } from '../maps/maps.module';
import { RateLimitModule } from '../common/rate-limit.module';
import { AmapRoadRouteProvider } from './amap-road-route.provider';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

@Module({ imports: [MapsModule, RateLimitModule], controllers: [RoutesController], providers: [RoutesService, AmapRoadRouteProvider] })
export class RoutesModule {}
