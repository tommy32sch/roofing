export const WEBHOOK_API_KEY_HEADER = 'x-api-key';

/**
 * Read an integration credential from the one supported transport.
 *
 * Credentials deliberately never fall back to the URL: paths and query strings
 * are routinely retained by proxies, CDNs, analytics, and access logs.
 */
export function getWebhookApiKey(headers: Headers): string | null {
  const apiKey = headers.get(WEBHOOK_API_KEY_HEADER)?.trim();
  return apiKey || null;
}
