import { NextRequest } from 'next/server';
import { POST as handleWebhook } from '../route';

/**
 * Proxy route that extracts the API key from the URL path
 * and forwards to the main webhook handler with the key as a header.
 * This supports services like BatchLeads that only allow a plain URL.
 *
 * URL format: /api/webhooks/inbound/{apiKey}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ apiKey: string }> }
) {
  const { apiKey } = await params;

  // Clone the request with the API key added as a header
  const headers = new Headers(request.headers);
  headers.set('x-api-key', apiKey);

  const modifiedRequest = new NextRequest(request.url, {
    method: request.method,
    headers,
    body: request.body,
  });

  return handleWebhook(modifiedRequest);
}
