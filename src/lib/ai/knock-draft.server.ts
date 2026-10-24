import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  KnockDraftOutputSchema,
  finalizeKnockDraft,
  knockDraftSystemPrompt,
  knockDraftUserMessage,
  type KnockDraft,
  type MarketToday,
} from './knock-draft';

/**
 * The cheapest current Claude model, chosen by the owner for cost. A draft is a
 * short extraction the rep reviews before anything is saved.
 */
export const KNOCK_DRAFT_MODEL = 'claude-haiku-5-5';

/**
 * One attempt, well inside the route's maxDuration (30s) and the browser's own
 * 20s limit. No automatic retry: a retry would double the time and the bill,
 * and the rep can tap Draft again or use the result buttons.
 */
const TIMEOUT_MS = 15_000;

/** The feature is on exactly when the key is set. Removing it is the off switch. */
export function isKnockDraftConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });
  return client;
}

export type KnockDraftResult =
  | { ok: true; draft: KnockDraft }
  | { ok: false; error: string };

/**
 * Ask the model for a proposed knock result. Never throws and never writes.
 *
 * Logs token counts and the stop reason only — never the rep's sentence, which
 * can hold homeowner details.
 */
export async function draftKnock(
  input: {
    text: string;
    today: MarketToday;
    leadStreet: string | null;
  },
  /** The incoming request's signal: a rep who gives up also stops the paid call. */
  signal?: AbortSignal
): Promise<KnockDraftResult> {
  try {
    const response = await getClient().messages.parse({
      model: KNOCK_DRAFT_MODEL,
      max_tokens: 2048,
      system: knockDraftSystemPrompt(),
      messages: [{ role: 'user', content: knockDraftUserMessage(input) }],
      output_config: {
        effort: 'low',
        format: zodOutputFormat(KnockDraftOutputSchema),
      },
    }, { signal });

    console.info('knock-draft', {
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      stop_reason: response.stop_reason,
    });

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      return { ok: false, error: 'Could not draft this result' };
    }
    const output = response.parsed_output;
    if (!output) return { ok: false, error: 'Could not draft this result' };
    return { ok: true, draft: finalizeKnockDraft(output, input.today) };
  } catch (error) {
    // Most specific first: an abort and a timeout are both APIErrors too.
    if (error instanceof Anthropic.APIUserAbortError) {
      return { ok: false, error: 'Drafting was cancelled' };
    }
    if (error instanceof Anthropic.RateLimitError) {
      console.error('knock-draft rate limited by provider');
      return { ok: false, error: 'Drafting is busy. Try again in a minute' };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      console.error('knock-draft connection error or timeout');
      return { ok: false, error: 'No answer in time' };
    }
    if (error instanceof Anthropic.APIError) {
      console.error('knock-draft API error', error.status);
      return { ok: false, error: 'Could not draft this result' };
    }
    console.error('knock-draft failed', error instanceof Error ? error.name : 'unknown');
    return { ok: false, error: 'Could not draft this result' };
  }
}
