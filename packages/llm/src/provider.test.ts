import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChat, type ProviderConfig, type StreamEvent } from './provider';

const cfg: ProviderConfig = { apiKey: 'test-key', model: 'anthropic/claude-haiku-4.5' };

/** Feeds the given raw bytes back as a fetch Response body. */
function mockFetch(chunks: string[], ok = true, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok, status, body: ok ? stream : null,
    text: async () => 'upstream exploded',
  })));
}

async function collect(): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of streamChat(cfg, { messages: [{ role: 'user', content: 'hi' }] })) {
    out.push(ev);
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('streamChat', () => {
  it('assembles text deltas in order', async () => {
    mockFetch([
      'data: {"choices":[{"delta":{"content":"Your "}}]}\n',
      'data: {"choices":[{"delta":{"content":"EMI is "}}]}\n',
      'data: {"choices":[{"delta":{"content":"₹16,253."}}]}\n',
      'data: [DONE]\n',
    ]);

    const text = (await collect())
      .filter((e): e is Extract<StreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');

    expect(text).toBe('Your EMI is ₹16,253.');
  });

  it('survives a frame split across two network reads', async () => {
    // The transport can split anywhere, including mid-JSON. A naive
    // line-by-line parser drops the frame and silently loses a token.
    mockFetch([
      'data: {"choices":[{"delta":{"con',
      'tent":"partial"}}]}\n',
      'data: [DONE]\n',
    ]);

    const text = (await collect())
      .filter((e): e is Extract<StreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');

    expect(text).toBe('partial');
  });

  it('ignores OpenRouter keep-alive comment lines', async () => {
    mockFetch([
      ': OPENROUTER PROCESSING\n',
      '\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
      ': OPENROUTER PROCESSING\n',
      'data: [DONE]\n',
    ]);

    const events = await collect();
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
    expect(events.find((e) => e.type === 'text')).toEqual({ type: 'text', delta: 'ok' });
  });

  it('accumulates tool-call argument deltas by index', async () => {
    mockFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"estimate_emi","arguments":"{\\"amount\\":"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1800000}"}}]}}]}\n',
      'data: [DONE]\n',
    ]);

    const calls = (await collect()).find(
      (e): e is Extract<StreamEvent, { type: 'tool_calls' }> => e.type === 'tool_calls',
    );

    expect(calls?.calls).toHaveLength(1);
    expect(calls?.calls[0]).toMatchObject({ id: 'call_1', name: 'estimate_emi' });
    // Arguments must be parsed, never string-matched.
    expect(JSON.parse(calls!.calls[0]!.arguments)).toEqual({ amount: 1800000 });
  });

  it('keeps parallel tool calls separate and ordered', async () => {
    mockFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"second","arguments":"{}"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"first","arguments":"{}"}}]}}]}\n',
      'data: [DONE]\n',
    ]);

    const calls = (await collect()).find(
      (e): e is Extract<StreamEvent, { type: 'tool_calls' }> => e.type === 'tool_calls',
    );

    expect(calls?.calls.map((c) => c.name)).toEqual(['first', 'second']);
  });

  it('reports cache reads so the caching claim is measurable', async () => {
    mockFetch([
      'data: {"choices":[{"delta":{"content":"x"}}],"usage":{"prompt_tokens":1200,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":980}}}\n',
      'data: [DONE]\n',
    ]);

    const usage = (await collect()).find(
      (e): e is Extract<StreamEvent, { type: 'usage' }> => e.type === 'usage',
    );

    expect(usage?.usage).toEqual({ inputTokens: 1200, outputTokens: 40, cacheReadTokens: 980 });
  });

  it('defaults cache reads to zero when the provider omits them', async () => {
    mockFetch([
      'data: {"choices":[{"delta":{"content":"x"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n',
      'data: [DONE]\n',
    ]);

    const usage = (await collect()).find(
      (e): e is Extract<StreamEvent, { type: 'usage' }> => e.type === 'usage',
    );

    expect(usage?.usage.cacheReadTokens).toBe(0);
  });

  it('surfaces an HTTP failure as an error event rather than throwing', async () => {
    mockFetch([], false, 429);
    const events = await collect();
    expect(events[0]?.type).toBe('error');
    expect((events[0] as any).message).toContain('429');
  });

  it('surfaces an in-stream error payload', async () => {
    mockFetch(['data: {"error":{"message":"context length exceeded"}}\n']);
    const events = await collect();
    expect(events[0]).toEqual({ type: 'error', message: 'context length exceeded' });
  });
});
