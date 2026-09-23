/**
 * Optional model assist for the Structure step.
 *
 * The heuristics already handle the common banking headers deterministically.
 * This asks Haiku to name only what fell through — columns that ended up as
 * plain snake_case and the anonymous parts of a text split — and returns
 * PROPOSALS that land in the Customisation Layer as pending. It never edits data.
 *
 * Time-boxed and failure-tolerant: if the key is missing, the call is slow, or
 * the JSON is malformed, structuring proceeds without it.
 */

import { streamChat, type ProviderConfig } from './provider';

export interface NamingRequest {
  columns: Array<{ key: string; source_header: string; type: string; samples: unknown[] }>;
  splits: Array<{ column: string; parts: Array<{ key: string; type: string; samples: unknown[] }> }>;
}

export interface NamingSuggestion {
  renames: Array<{ from: string; to: string; label: string; confidence: number; reason: string }>;
  splitParts: Array<{ column: string; index: number; key: string; label: string }>;
}

const SYSTEM = `You name spreadsheet columns for an Indian retail-lending reporting tool.
Given columns with their original header and sample values, propose a canonical snake_case key and a short human label for each.
Prefer these canonical keys when they fit: loan_account_no, customer_id, borrower_name, date_of_birth, gender, city, state, occupation, branch, region, product, sanctioned_amount, disbursed_amount, outstanding_amount, amount_paid, emi_amount, existing_emi, monthly_income, interest_rate, tenure_months, sanction_date, disbursed_on, payment_date, as_of_date, cibil_score, dpd, asset_classification, mode, receipt_no.
If the existing key is already right, return it unchanged with confidence 100.
Respond with JSON only, no prose:
{"renames":[{"from":"","to":"","label":"","confidence":0-100,"reason":""}],"splitParts":[{"column":"","index":0,"key":"","label":""}]}`;

const TIMEOUT_MS = 7000;

export async function suggestNames(cfg: ProviderConfig, req: NamingRequest): Promise<NamingSuggestion | null> {
  if (req.columns.length === 0 && req.splits.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let text = '';
    for await (const ev of streamChat(cfg, {
      messages: [
        { role: 'system', content: SYSTEM, cache: true },
        { role: 'user', content: JSON.stringify(req) },
      ],
      maxTokens: 700,
      temperature: 0,
      signal: controller.signal,
    })) {
      if (ev.type === 'text') text += ev.delta;
      if (ev.type === 'error') return null;
    }

    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as Partial<NamingSuggestion>;
    return {
      renames: Array.isArray(parsed.renames) ? parsed.renames.filter((r) => r?.from && r?.to) : [],
      splitParts: Array.isArray(parsed.splitParts) ? parsed.splitParts.filter((p) => p?.column && p?.key) : [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
