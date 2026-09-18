import { lazyWithRetry } from '../../utils/lazyWithRetry'

export const AmapMapViewLazy = lazyWithRetry(async () => {
  const component = await import('./AmapMapView')
  return { default: component.AmapMapView }
})

