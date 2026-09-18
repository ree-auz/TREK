import { AmapClient } from './amap.client';
import {
  gcj02ToWgs84,
  isMainlandChina,
  parseAmapCoordinate,
  wgs84ToGcj02,
  type Coordinate,
} from './coordinate-transform';
import { Injectable } from '@nestjs/common';

export interface AmapPoi {
  id?: string;
  name?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
  citycode?: string;
  adcode?: string;
  type?: string;
  typecode?: string;
  business?: { tel?: string; rating?: string; opentime_week?: string };
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

@Injectable()
export class AmapPlacesProvider {
  constructor(private readonly client: AmapClient = new AmapClient()) {}
  enabled(): boolean {
    return this.client.enabled();
  }

  mapPoi(poi: AmapPoi): Record<string, unknown> | null {
    const gcj = parseAmapCoordinate(poi.location);
    if (!poi.id || !poi.name || !gcj || !isMainlandChina(gcj) || !poi.adcode) return null;
    const wgs = gcj02ToWgs84(gcj);
    const address = [text(poi.pname), text(poi.cityname), text(poi.adname), text(poi.address)].filter(Boolean).join('');
    return {
      amap_place_id: poi.id,
      provider_id: poi.id,
      name: poi.name,
      address,
      lat: wgs.lat,
      lng: wgs.lng,
      citycode: text(poi.citycode),
      adcode: text(poi.adcode),
      types: poi.type ? [poi.type] : [],
      typecode: text(poi.typecode),
      rating: Number(poi.business?.rating) || null,
      phone: text(poi.business?.tel) || null,
      opening_hours: text(poi.business?.opentime_week) || null,
      source: 'amap',
    };
  }

  async search(keywords: string, _lang?: string, bias?: Coordinate): Promise<Record<string, unknown>[]> {
    // Text Search 2.0 has no coordinate-bias parameter. The router uses this
    // WGS84 hint as a mainland gate; keep it in this signature for providers.
    void bias;
    const data = await this.client.get<{ pois?: AmapPoi[] }>('/v5/place/text', {
      keywords: keywords.slice(0, 80),
      page_size: '10',
      show_fields: 'business',
      // v5 text has no coordinate bias; region is deliberately omitted unless resolved reliably.
      region: undefined,
    });
    return (data.pois ?? []).flatMap((p) => {
      const mapped = this.mapPoi(p);
      return mapped ? [mapped] : [];
    });
  }

  async details(placeId: string): Promise<Record<string, unknown> | null> {
    const data = await this.client.get<{ pois?: AmapPoi[] }>('/v5/place/detail', {
      id: placeId,
      show_fields: 'business',
    });
    return this.mapPoi(data.pois?.[0] ?? {});
  }

  async reverse(
    point: Coordinate,
  ): Promise<{ citycode: string; adcode: string; name: string; address: string } | null> {
    if (!isMainlandChina(point)) return null;
    const gcj = wgs84ToGcj02(point);
    const data = await this.client.get<{
      regeocode?: {
        formatted_address?: string;
        addressComponent?: { citycode?: string; adcode?: string; city?: string; province?: string };
      };
    }>('/v3/geocode/regeo', {
      location: `${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`,
      extensions: 'base',
      radius: '1000',
    });
    const r = data.regeocode;
    const c = r?.addressComponent;
    if (!r || !c?.citycode || !c.adcode) return null;
    return {
      citycode: text(c.citycode),
      adcode: text(c.adcode),
      name: text(c.city) || text(c.province),
      address: text(r.formatted_address),
    };
  }
}
