import { describe, expect, it, vi } from 'vitest';
import { MapsService } from '../../../src/nest/maps/maps.service';

vi.mock('../../../src/db/database', () => ({
  db: { prepare: () => ({ get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }) },
}));

function service(amap: Record<string, unknown>, provider: 'global' | 'amap' = 'global') {
  const database = { get: vi.fn(), run: vi.fn() };
  const photos = {};
  return new MapsService(database as never, photos as never, amap as never, { resolve: () => provider } as never);
}

describe('Maps Amap routing', () => {
  it('routes the controller-facing autocomplete from the explicit Trip provider', async () => {
    const amap = {
      enabled: () => true,
      search: vi.fn().mockResolvedValue([{ amap_place_id: 'B000', name: '洪崖洞', address: '重庆市' }]),
    };
    const maps = service(amap, 'amap');
    await expect(maps.autocomplete(1, 'Hongyadong', 'en', undefined, undefined, 7)).resolves.toMatchObject({
      source: 'amap',
    });
    expect(amap.search).toHaveBeenCalledOnce();
  });

  it('keeps the original provider stack when the Trip provider is global', async () => {
    const amap = { enabled: () => true, search: vi.fn() };
    const maps = service(amap, 'global');
    vi.spyOn(maps, 'searchNominatim').mockResolvedValue([]);
    await expect(maps.autocomplete(1, '洪崖洞', 'zh', undefined, undefined, 7)).resolves.toMatchObject({
      source: 'nominatim',
    });
    expect(amap.search).not.toHaveBeenCalled();
  });

  it('uses Amap first and emits provider-qualified autocomplete ids', async () => {
    const amap = {
      enabled: () => true,
      search: vi.fn().mockResolvedValue([{ amap_place_id: 'B001', name: '故宫', address: '北京市东城区' }]),
    };
    const maps = service(amap);
    await expect(maps.autocompletePlaces(1, '故宫', 'zh', undefined, undefined, true)).resolves.toEqual({
      suggestions: [{ placeId: 'amap:B001', mainText: '故宫', secondaryText: '北京市东城区' }],
      source: 'amap',
    });
  });

  it('uses the explicit Amap trip choice regardless of query language or bias', async () => {
    const amap = {
      enabled: () => true,
      search: vi.fn().mockResolvedValue([{ amap_place_id: 'B002', name: '洪崖洞', address: '重庆市渝中区' }]),
    };
    const maps = service(amap);
    const result = await maps.autocompletePlaces(1, 'Hongyadong', 'en', {
      low: { lat: 48.8, lng: 2.2 },
      high: { lat: 48.9, lng: 2.4 },
    }, undefined, true);
    expect(result).toEqual({
      suggestions: [{ placeId: 'amap:B002', mainText: '洪崖洞', secondaryText: '重庆市渝中区' }],
      source: 'amap',
    });
    expect(amap.search).toHaveBeenCalledOnce();
  });

  it('keeps amap-prefixed details on the Amap provider', async () => {
    const amap = { enabled: () => true, details: vi.fn().mockResolvedValue({ name: '洪崖洞', source: 'amap' }) };
    const maps = service(amap);
    await expect(maps.getPlaceDetails(1, 'amap:B002')).resolves.toEqual({
      place: { name: '洪崖洞', source: 'amap' },
    });
    expect(amap.details).toHaveBeenCalledWith('B002');
  });

  it('falls back to the existing provider on an Amap failure', async () => {
    const maps = service({ enabled: () => true, search: vi.fn().mockRejectedValue(new Error('timeout')) });
    vi.spyOn(maps, 'searchNominatim').mockResolvedValue([{ osm_id: 'node:1', name: 'Fallback' }] as never);
    await expect(maps.searchPlaces(1, 'fallback', undefined, undefined, true)).resolves.toMatchObject({ source: 'openstreetmap' });
  });

  it('falls back to Nominatim only after Amap returns no usable autocomplete results', async () => {
    const amap = { enabled: () => true, search: vi.fn().mockResolvedValue([]) };
    const maps = service(amap);
    vi.spyOn(maps, 'searchNominatim').mockResolvedValue([
      { osm_id: 'way:1', name: 'Fallback', address: 'Fallback, Chongqing' },
    ] as never);
    await expect(maps.autocompletePlaces(1, '洪崖洞', 'zh', undefined, undefined, true)).resolves.toEqual({
      suggestions: [{ placeId: 'way:1', mainText: 'Fallback', secondaryText: 'Chongqing' }],
      source: 'nominatim',
    });
    expect(amap.search).toHaveBeenCalledOnce();
  });

  it('does not touch Amap when AMAP_WEB_KEY is absent', async () => {
    const amap = { enabled: () => false, search: vi.fn() };
    const maps = service(amap);
    vi.spyOn(maps, 'searchNominatim').mockResolvedValue([]);
    await expect(maps.searchPlaces(1, 'legacy')).resolves.toEqual({ places: [], source: 'openstreetmap' });
    expect(amap.search).not.toHaveBeenCalled();
  });

  it('skips Amap when the trip explicitly uses the global provider', async () => {
    const amap = { enabled: () => true, search: vi.fn() };
    const maps = service(amap);
    vi.spyOn(maps, 'searchNominatim').mockResolvedValue([]);
    await maps.searchPlaces(1, 'Paris', 'fr', { lat: 48.8566, lng: 2.3522 });
    expect(amap.search).not.toHaveBeenCalled();
  });
});
