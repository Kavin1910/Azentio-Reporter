/**
 * The agent loop: model → tools → model, capped at MAX_TOOL_ROUNDS.
 *
 * Two rounds covers "look it up, then answer" and "describe the schema, then
 * query". Refusing a third keeps a runaway conversation from becoming an
 * unbounded latency and cost hole. Tool calls within a round run concurrently.
 */

import type { ChartSpec } from '@azentio/core';
import { streamChat, type ChatMessage, type ProviderConfig, type Usage } from './provider';
import { executeTool, TOOL_DEFINITIONS, type DatasetContext } from './tools';

export const MAX_TOOL_ROUNDS = 2;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; names: string[] }
  | { type: 'chart'; chart: ChartSpec }
  /** The text streamed so far this turn was pre-tool narration; drop it from the view. */
  | { type: 'retract' }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      /** Time to first visible token — the number the user actually feels. */
      ttftMs: number | null;
      totalMs: number;
      usage: Usage;
      toolsUsed: string[];
    };

export async function* runAgent(
  cfg: ProviderConfig,
  initialMessages: ChatMessage[],
  ctx: DatasetContext,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now();
  let ttftMs: number | null = null;
  const toolsUsed: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const messages = [...initialMessages];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // Final round: strip the tools so the model must answer in words rather
    // than request a call we would have to refuse.
    const lastRound = round === MAX_TOOL_ROUNDS;

    let assistantText = '';
    let calls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const ev of streamChat(cfg, {
      messages,
      tools: lastRound ? undefined : TOOL_DEFINITIONS,
      signal,
      maxTokens: 900,
    })) {
      if (ev.type === 'text') {
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        assistantText += ev.delta;
        yield { type: 'text', delta: ev.delta };
      } else if (ev.type === 'tool_calls') {
        calls = ev.calls;
      } else if (ev.type === 'usage') {
        usage.inputTokens += ev.usage.inputTokens;
        usage.outputTokens += ev.usage.outputTokens;
        usage.cacheReadTokens += ev.usage.cacheReadTokens;
      } else if (ev.type === 'error') {
        yield { type: 'error', message: ev.message };
        yield { type: 'done', ttftMs, totalMs: Date.now() - startedAt, usage, toolsUsed };
        return;
      }
    }

    if (calls.length === 0) break;

    // "Let me check…" before a tool call is not an answer. It has already been
    // streamed, so tell the client to take it back; the tool status replaces it.
    if (assistantText.trim()) yield { type: 'retract' };

    yield { type: 'tool_start', names: calls.map((c) => c.name) };
    toolsUsed.push(...calls.map((c) => c.name));
    messages.push({ role: 'assistant', content: assistantText, tool_calls: calls });

    const results = await Promise.all(
      calls.map(async (c) => ({ id: c.id, ...(await executeTool(c.name, c.arguments, ctx)) })),
    );

    for (const r of results) {
      if (r.chart) yield { type: 'chart', chart: r.chart };
      messages.push({ role: 'tool', tool_call_id: r.id, content: r.output });
    }
  }

  yield { type: 'done', ttftMs, totalMs: Date.now() - startedAt, usage, toolsUsed };
}
