import { z } from 'zod';

export const routeSourceSchema = z.enum(['amap', 'transitous']);
const routeStopSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  time: z.string().nullable(),
  scheduledTime: z.string().nullable(),
  track: z.string().nullable(),
});
const transitLegSchema = z.object({
  mode: z.string(),
  from: routeStopSchema,
  to: routeStopSchema,
  duration: z.number(),
  distance: z.number().nullable(),
  headsign: z.string().nullable(),
  line: z.string().nullable(),
  lineColor: z.string().nullable(),
  lineTextColor: z.string().nullable(),
  agency: z.string().nullable(),
  intermediateStops: z.number(),
  stopNodes: z.array(routeStopSchema).optional(),
  alternativeGroup: z.string().optional(),
  geometry: z.string().nullable().optional(),
  geometryPrecision: z.number().optional(),
});
export const transitRouteItinerarySchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  duration: z.number(),
  transfers: z.number(),
  walkSeconds: z.number(),
  distance: z.number().nullable().optional(),
  legs: z.array(transitLegSchema),
});
export const routePlanResponseSchema = z.object({
  source: routeSourceSchema,
  fallbackUsed: z.boolean(),
  itineraries: z.array(transitRouteItinerarySchema),
});

export type RouteSource = z.infer<typeof routeSourceSchema>;
export type TransitRouteItinerary = z.infer<typeof transitRouteItinerarySchema>;
export type RoutePlanResponse = z.infer<typeof routePlanResponseSchema>;
