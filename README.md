# Azentio Reporter

One screen that turns messy spreadsheets into approved, templated reports — with a
data assistant that answers only from the loaded file.

```
Source → STRUCTURE → Structured schema → Template + mapping → Customisation Layer → Filters → Report
                                                                      ↑ nothing crosses this unapproved
```

## The contract

Every uncertain decision the system makes — a fuzzy field match, a column that is
94% numeric, an ambiguous date order, a totals row, a derived `age` — lands in the
**Customisation Layer** as *pending*. Reports and the assistant read **approved**
items only. Pending items are counted and shown, never applied. You can approve,
reject, or override with your own value; an override is your decision and applies.

## Run it

```bash
# 1. In the Supabase SQL editor, run in order:
#    supabase/migrations/0000_reset.sql   (first time only; destructive)
#    supabase/migrations/0001_schema.sql
#    supabase/migrations/0002_rls.sql
#    supabase/migrations/0003_seed_templates.sql
#    supabase/migrations/0004_sources.sql        (saved data sources / DB connections)
# 2. cp .env.example .env  and fill in the Supabase URL/anon key, OPENROUTER_KEY and a
#    SOURCE_ENCRYPTION_KEY (any 16+ character secret; encrypts saved DB passwords)
pnpm install
pnpm mock:generate        # writes four deliberately messy files to mock-data/
pnpm dev                  # http://localhost:3000 — create an account on the login page
```

Demo account: `demo@azentio.test` / `Password123!` (created by the e2e script's setup).

## What's where

| Path | What |
|---|---|
| `packages/core` | Parsing, structuring, formula engine, derivation recipes, auto-mapper, report engine. 104 tests. |
| `packages/llm` | OpenRouter/Haiku adapter, dataset-scoped chat tools, naming assist. 19 tests. |
| `packages/pipeline` | The upload → structure → map → approve → report flow, framework-free. |
| `packages/mockdata` | Generates the messy sample files; `e2e` drives the live pipeline as a real user. |
| `apps/reporter` | The Next.js screen. Server actions are thin wrappers over `@azentio/pipeline`. |
| `supabase/` | Schema, RLS, 12 templates. |

## Production

```bash
pnpm build && pnpm start          # never build while `pnpm dev` is running — they share .next/
pnpm e2e:prod                     # redirects, headers, validation, rate limit
pnpm e2e && pnpm e2e:ui           # pipeline + HTTP suite; real-browser upload / DB connect
```

What production mode enforces that development does not:

- **Auth in middleware.** Signed-out requests get a real `307` to `/login` before any rendering; signed-in visitors on `/login` go to the workspace.
- **Server actions return results, never throw.** Next redacts thrown messages in production, so every action returns `{ ok, data | error }` and the UI shows the real reason.
- **Security headers** on every response: `nosniff`, `X-Frame-Options: DENY`, strict referrer, and a `Permissions-Policy` that grants the microphone (push-to-talk) and nothing else.
- **Chat guardrails:** 30 questions/minute per user, 2,000-character messages, UUID-validated ids.
- **Uploads:** `.xlsx`/`.csv` only, 10 MB cap.
- **Database connections** to loopback/private/metadata addresses are refused unless `ALLOW_PRIVATE_DB_HOSTS=true` — set that only for local development.
- `error.tsx`, `global-error.tsx`, `not-found.tsx` and `loading.tsx` — no blank pages.
- Startup fails loudly if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing and warns if `OPENROUTER_KEY` or `SOURCE_ENCRYPTION_KEY` are.

## Verify

```bash
pnpm test                                 # unit tests
pnpm typecheck && pnpm build              # every package and the app
pnpm --filter @azentio/mockdata e2e       # live: upload → structure → approve → report → chat
```

## Design notes worth knowing

- **Formulas are parsed, not eval'd.** Derived fields are user-editable and stored, so an
  evaluator that could reach host objects would be remote code execution. The grammar
  covers arithmetic, comparisons and eleven functions (`YEARS_BETWEEN`, `BUCKET`, `EMI`…).
- **Chart colours are not the brand colours.** The sage palette fails the chroma floor as
  data marks. Charts use a validated eight-hue companion palette (adjacent CVD ΔE ≥ 8,
  ≥ 3:1 on the surface) with slot 1 a forest green; every mark is directly labelled.
- **Two colours were added to the palette**: an ochre and a terracotta, because
  approved / pending / rejected cannot be three greens.
- **Numeric columns are not Excel dates.** Any integer is a valid Excel serial; a column
  becomes a date only with a date-named header or textual date evidence.
- **Totals rows stay in the data** with a pending exclusion. They leave when you approve.

## Known gaps

POC scope. No audit trail, no file storage beyond parsed rows, single role. Tables
over ~50k rows would need streaming and server-side aggregation; everything here
loads a dataset into memory per request.
