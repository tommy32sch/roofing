import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { getWebhookApiKey, WEBHOOK_API_KEY_HEADER } from './webhook-auth';

describe('webhook API key transport', () => {
  it('accepts and trims only the x-api-key header', () => {
    const headers = new Headers({ [WEBHOOK_API_KEY_HEADER]: '  secret-key  ' });

    expect(getWebhookApiKey(headers)).toBe('secret-key');
    expect(getWebhookApiKey(new Headers())).toBeNull();
    expect(getWebhookApiKey(new Headers({ [WEBHOOK_API_KEY_HEADER]: '   ' }))).toBeNull();
  });

  it('leaves no URL credential fallback in either webhook endpoint', () => {
    const inboundRoute = readFileSync(
      join(process.cwd(), 'src/app/api/webhooks/inbound/route.ts'),
      'utf8'
    );
    const emailRoute = readFileSync(
      join(process.cwd(), 'src/app/api/webhooks/email/route.ts'),
      'utf8'
    );

    for (const route of [inboundRoute, emailRoute]) {
      expect(route).toContain('getWebhookApiKey(request.headers)');
      expect(route).not.toContain("searchParams.get('api_key')");
    }

    expect(
      existsSync(join(process.cwd(), 'src/app/api/webhooks/inbound/[apiKey]/route.ts'))
    ).toBe(false);
  });
});
