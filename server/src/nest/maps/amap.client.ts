import { readEnv } from '../../app-config';
import { Injectable } from '@nestjs/common';

export class AmapProviderError extends Error {
  status = 502;
  constructor(
    message = 'Amap provider error',
    readonly infocode?: string,
    readonly info?: string,
  ) {
    super(message);
  }
}

@Injectable()
export class AmapClient {
  enabled(): boolean {
    return !!readEnv().integrations.amapWebKey;
  }

  async get<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const key = readEnv().integrations.amapWebKey;
    if (!key) throw new AmapProviderError('Amap provider is not configured');
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) if (value !== undefined) query.set(name, value);
    query.set('key', key);
    let response: Response;
    try {
      response = await fetch(`https://restapi.amap.com${path}?${query}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new AmapProviderError('Amap provider unavailable');
    }
    if (!response.ok) throw new AmapProviderError(`Amap provider error (HTTP ${response.status})`);
    let data: T & { status?: string; info?: string; infocode?: string };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new AmapProviderError('Amap provider returned invalid data');
    }
    if (data.status !== '1') {
      const quota = data.infocode === '10003' || data.infocode === '10004' || data.infocode === '10044';
      const reason = quota
        ? 'Amap provider quota exceeded'
        : data.infocode === '10001'
          ? 'Amap provider rejected the API key'
          : 'Amap provider rejected the request';
      const details = `info=${data.info ?? 'unknown'}, infocode=${data.infocode ?? 'unknown'}`;
      throw new AmapProviderError(`${reason} (${details})`, data.infocode, data.info);
    }
    return data;
  }
}
