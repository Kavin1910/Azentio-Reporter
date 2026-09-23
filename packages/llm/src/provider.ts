/**
 * OpenRouter adapter.
 *
 * Everything that knows about the wire protocol lives in this file. Switching to
 * the Anthropic SDK directly — which removes a proxy hop and is worth measuring
 * if time-to-first-token disappoints — means replacing this file and nothing else.
 *
 * Uses OpenRouter's OpenAI-compatible /chat/completions endpoint.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Claude Haiku 4.5. Anthropic's own ID is `claude-haiku-4-5`; OpenRouter
 * namespaces it. Verify against https://openrouter.ai/models if requests 404.
 */
export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as emitted by the model. Always parse; never string-match. */
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string; cache?: boolean }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Populated when the cached prefix was actually reused. Zero means it wasn't. */
  cacheReadTokens: number;
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; usage: Usage }
  | { type: 'error'; message: string };

export interface ProviderConfig {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
}

export function providerConfigFromEnv(): ProviderConfig {
  const apiKey = process.env.OPENROUTER_KEY ?? '';
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_KEY is not set. Add it to .env.local — the chatbot cannot start without it.',
    );
  }
  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    siteUrl: process.env.OPENROUTER_SITE_URL,
    siteName: process.env.OPENROUTER_SITE_NAME,
  };
}

/**
 * Serialise to the wire format.
 *
 * Anthropic prompt caching is requested per content block. OpenRouter forwards
 * `cache_control` for Anthropic models when content is an array of parts, so a
 * cacheable system message becomes a one-element array rather than a string.
 * Everything before the marked block is cached; volatile content must come after.
 */
function toWireMessage(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'system':
      return m.cache
        ? {
            role: 'system',
            content: [
              { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
            ],
          }
        : { role: 'system', content: m.content };
    case 'assistant':
      return m.tool_calls?.length
        ? {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.tool_calls.map((t) => ({
              id: t.id,
              type: 'function',
              function: { name: t.name, arguments: t.arguments },
            })),
          }
        : { role: 'assistant', content: m.content };
    case 'tool':
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    default:
      return { role: 'user', content: m.content };
  }
}

export interface StreamOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Streams a single model turn.
 *
 * Note what is absent: no `thinking` / reasoning parameter. Haiku 4.5 does not
 * support adaptive thinking, and omitting the parameter means no thinking at
 * all — which is exactly what a latency-critical chat path wants.
 */
export async function* streamChat(
  cfg: ProviderConfig,
  opts: StreamOptions,
): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model: cfg.model ?? DEFAULT_MODEL,
    messages: opts.messages.map(toWireMessage),
    stream: true,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.3,
    // Ask OpenRouter to report token accounting on the final SSE frame.
    usage: { include: true },
  };

  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (cfg.siteUrl) headers['HTTP-Referer'] = cfg.siteUrl;
  if (cfg.siteName) headers['X-Title'] = cfg.siteName;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    yield { type: 'error', message: `OpenRouter ${res.status}: ${detail.slice(0, 400)}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Tool calls arrive as deltas keyed by index and must be accumulated.
  const pending = new Map<number, { id: string; name: string; args: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        // OpenRouter emits `: OPENROUTER PROCESSING` keep-alive comments.
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // a partial frame; the next read completes it
        }

        if (parsed.error) {
          yield { type: 'error', message: String(parsed.error.message ?? parsed.error) };
          return;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) yield { type: 'text', delta: delta.content as string };

        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const slot = pending.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name = tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          pending.set(idx, slot);
        }

        if (parsed.usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: parsed.usage.prompt_tokens ?? 0,
              outputTokens: parsed.usage.completion_tokens ?? 0,
              cacheReadTokens:
                parsed.usage.prompt_tokens_details?.cached_tokens ??
                parsed.usage.cache_read_input_tokens ??
                0,
            },
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (pending.size > 0) {
    yield {
      type: 'tool_calls',
      calls: [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, s]) => ({ id: s.id, name: s.name, arguments: s.args })),
    };
  }
}
