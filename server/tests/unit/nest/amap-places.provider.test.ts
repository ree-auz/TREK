import { AmapPlacesProvider } from '../../../src/nest/maps/amap-places.provider';

import { AmapClient } from '../../../src/nest/maps/amap.client';

import { afterEach, describe, expect, it, vi } from 'vitest';

const poi = {
  id: 'B001',
  name: '故宫博物院',
  address: '景山前街4号',
  location: '116.397029,39.917839',
  pname: '北京市',
  cityname: '北京市',
  adname: '东城区',
  citycode: '010',
  adcode: '110101',
  type: '风景名胜',
  typecode: '110200',
  business: { tel: '010-1', rating: '4.9' },
};

describe('Amap POI provider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not send langCode for ordinary Chinese POI searches', async () => {
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue({ status: '1', pois: [poi] }) };
    const provider = new AmapPlacesProvider(client as never);

    await provider.search('洪崖洞', 'zh');

    expect(client.get).toHaveBeenCalledWith('/v5/place/text', {
      keywords: '洪崖洞',
      page_size: '10',
      show_fields: 'business',
      region: undefined,
    });
    expect(client.get.mock.calls[0][1]).not.toHaveProperty('langCode');
  });

  it('maps search POIs into TREK fields and WGS84', () => {
    const provider = new AmapPlacesProvider({} as never);
    expect(provider.mapPoi(poi)).toMatchObject({
      amap_place_id: 'B001',
      provider_id: 'B001',
      name: '故宫博物院',
      citycode: '010',
      adcode: '110101',
      source: 'amap',
    });
    expect(Number(provider.mapPoi(poi)!.lng)).toBeLessThan(116.397029);
  });

  it('maps detail response through the same canonical mapper', async () => {
    const client = { enabled: () => true, get: vi.fn().mockResolvedValue({ status: '1', pois: [poi] }) };
    const provider = new AmapPlacesProvider(client as never);
    await expect(provider.details('B001')).resolves.toMatchObject({ name: '故宫博物院', citycode: '010' });
    expect(client.get).toHaveBeenCalledWith('/v5/place/detail', expect.objectContaining({ id: 'B001' }));
  });

  it('rejects incomplete/non-mainland POIs so the router can fall back', () => {
    const provider = new AmapPlacesProvider({} as never);
    expect(provider.mapPoi({ ...poi, location: '2.3522,48.8566' })).toBeNull();
    expect(provider.mapPoi({ ...poi, adcode: '' })).toBeNull();
  });

  it('includes Amap info and infocode in provider errors without exposing the key', async () => {
    vi.stubEnv('AMAP_WEB_KEY', 'test-secret-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: '0', info: 'INSUFFICIENT_PRIVILEGES', infocode: '10012' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const request = new AmapClient().get('/v5/place/text', { keywords: '洪崖洞' });
    await expect(request).rejects.toEqual(
      expect.objectContaining({
        message:
          'Amap provider rejected the request (info=INSUFFICIENT_PRIVILEGES, infocode=10012)',
        info: 'INSUFFICIENT_PRIVILEGES',
        infocode: '10012',
      }),
    );
    await expect(request).rejects.not.toThrow('test-secret-key');
  });
});
