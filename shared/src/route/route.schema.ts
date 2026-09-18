import { z } from 'zod';

export const roadRouteTypeSchema = z.enum(['walking', 'driving', 'bicycling', 'electrobike']);
export type RoadRouteType = z.infer<typeof roadRouteTypeSchema>;

const waypointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
const routeLegSchema = z.object({
  from: z.tuple([z.number(), z.number()]),
  to: z.tuple([z.number(), z.number()]),
  mid: z.tuple([z.number(), z.number()]),
  distance: z.number().nonnegative(),
  duration: z.number().nonnegative(),
});

export const roadRoutePlanRequestSchema = z.object({
  tripId: z.coerce.number().int().positive(),
  routeType: roadRouteTypeSchema,
  waypoints: z.array(waypointSchema).min(2).max(50),
});
export type RoadRoutePlanRequest = z.infer<typeof roadRoutePlanRequestSchema>;

export const roadRoutePlanResponseSchema = z.object({
  source: z.literal('amap'),
  routeType: roadRouteTypeSchema,
  route: z.object({
    coordinates: z.array(z.tuple([z.number(), z.number()])),
    distance: z.number().nonnegative(),
    duration: z.number().nonnegative(),
    legs: z.array(routeLegSchema),
  }),
});
export type RoadRoutePlanResponse = z.infer<typeof roadRoutePlanResponseSchema>;
