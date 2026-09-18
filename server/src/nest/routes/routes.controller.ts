import { Body, Controller, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitService } from '../common/rate-limit.service';
import type { User } from '../../types';
import { RoadRoutePlanDto } from './routes.dto';
import { RoutesService } from './routes.service';

@Controller('api/routes')
@UseGuards(JwtAuthGuard)
export class RoutesController {
  constructor(private readonly routes: RoutesService, private readonly rl: RateLimitService) {}
  @Post('plan')
  async plan(@CurrentUser() user: User, @Body() body: RoadRoutePlanDto, @Req() req: Request) {
    if (!this.rl.check('road_route_plan', req.ip || 'unknown', 60, 15 * 60 * 1000, Date.now())) {
      throw new HttpException({ error: 'Too many requests. Please try again later.' }, 429);
    }
    try {
      return await this.routes.plan(user.id, body);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const status = (error as { status?: number }).status || 502;
      const message = error instanceof Error ? error.message : 'Route provider error';
      throw new HttpException({ error: message }, status);
    }
  }
}
