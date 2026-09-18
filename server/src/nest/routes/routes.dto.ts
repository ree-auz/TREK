import { roadRoutePlanRequestSchema } from '@trek/shared';
import { createZodDto } from 'nestjs-zod';

/** Validated request contract for the authenticated Amap road-routing endpoint. */
export class RoadRoutePlanDto extends createZodDto(roadRoutePlanRequestSchema) {}
