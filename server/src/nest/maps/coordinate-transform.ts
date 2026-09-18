// Compatibility facade for server imports. The implementation is shared with
// future browser renderers so conversion math cannot drift between boundaries.
export {
  gcj02ToWgs84,
  isMainlandChina,
  parseAmapCoordinate,
  wgs84ToGcj02,
  type Coordinate,
} from '@trek/shared';
