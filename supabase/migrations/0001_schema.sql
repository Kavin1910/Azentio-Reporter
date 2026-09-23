-- =============================================================================
-- 0001_schema.sql — Reporting platform
--
-- The shape of this schema follows one rule: nothing inferred by a machine
-- reaches a report until a human approves it. Inference lands in
-- `customisations` with status 'pending'; report queries read 'approved' only.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.dataset_status as enum ('uploaded', 'structuring', 'structured', 'failed');

-- 'currency' is kept distinct from 'number' so reports can format ₹ correctly
-- without re-guessing from the column name.
create type public.column_type as enum ('text', 'number', 'currency', 'date', 'boolean');

create type public.customisation_kind as enum (
  'column_rename',    -- 'Sanction Amt (Rs.)' -> sanctioned_amount
  'type_conflict',    -- column is 94% numeric, 6% 'N/A'
  'value_coercion',   -- 37 unparseable dates, proposed format dd-mm-yyyy
  'text_split',       -- 'Rajesh Kumar, 34, Pune' -> name / age / city
  'row_exclusion',    -- totals rows, blank spacers, repeated headers
  'field_mapping',    -- template field <- structured column
  'unmapped_field',   -- template field with no candidate at all
  'derived_field'     -- age <- date_of_birth, via a formula
);

create type public.customisation_status as enum ('pending', 'approved', 'rejected');
create type public.field_role      as enum ('dimension', 'measure', 'date');
create type public.chat_role       as enum ('user', 'assistant', 'tool');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- datasets — one uploaded sheet
-- ---------------------------------------------------------------------------
create table public.datasets (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles(id) on delete cascade,
  name                  text not null,
  source_filename       text not null,
  sheet_name            text,
  status                public.dataset_status not null default 'uploaded',
  raw_row_count         int not null default 0,
  structured_row_count  int not null default 0,
  -- Index of the row the structurer believes holds the real headers. Files
  -- exported from banking systems routinely carry title and spacer rows above it.
  header_row_index      int,
  structure_notes       text,
  structure_model       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  structured_at         timestamptz
);

create trigger datasets_touch before update on public.datasets
  for each row execute function public.touch_updated_at();

create index datasets_owner_idx on public.datasets (owner_id, created_at desc);

-- Defined after datasets because a SQL-language function body is validated at
-- CREATE time and must find the tables it reads.
create or replace function public.owns_dataset(ds uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.datasets d where d.id = ds and d.owner_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- raw_rows — the file exactly as parsed, before anything is cleaned.
-- Kept so the Structure step can show a real before/after rather than a claim.
-- ---------------------------------------------------------------------------
create table public.raw_rows (
  id         bigserial primary key,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  row_index  int not null,
  cells      jsonb not null,          -- positional array of raw cell values
  unique (dataset_id, row_index)
);

create index raw_rows_dataset_idx on public.raw_rows (dataset_id, row_index);

-- ---------------------------------------------------------------------------
-- dataset_columns — the canonical schema produced by structuring
-- ---------------------------------------------------------------------------
create table public.dataset_columns (
  id            uuid primary key default gen_random_uuid(),
  dataset_id    uuid not null references public.datasets(id) on delete cascade,
  key           text not null,                 -- snake_case canonical name
  label         text not null,                 -- human label for the report
  data_type     public.column_type not null default 'text',
  source_header text,                          -- header as it appeared in the file
  source_index  int,                           -- positional index in raw cells
  is_derived    boolean not null default false,
  formula       text,                          -- set when is_derived
  sample_values jsonb not null default '[]',
  null_count    int not null default 0,
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  unique (dataset_id, key),
  constraint derived_has_formula check (not is_derived or formula is not null)
);

create index dataset_columns_dataset_idx on public.dataset_columns (dataset_id, position);

-- ---------------------------------------------------------------------------
-- dataset_rows — structured data, one jsonb object keyed by column key.
-- jsonb rather than real columns because every uploaded file has a different
-- shape; the canonical schema lives in dataset_columns.
-- ---------------------------------------------------------------------------
create table public.dataset_rows (
  id         bigserial primary key,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  row_index  int not null,
  data       jsonb not null,
  unique (dataset_id, row_index)
);

create index dataset_rows_dataset_idx on public.dataset_rows (dataset_id, row_index);
create index dataset_rows_data_gin    on public.dataset_rows using gin (data jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- report_templates — global catalogue, readable by everyone
--
-- fields jsonb: [{ key, label, type, role, required, aggregation, description }]
-- ---------------------------------------------------------------------------
create table public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text not null,
  category    text not null,
  icon        text,
  fields      jsonb not null default '[]',
  position    int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- mappings — one per (dataset, template). A container; the decisions live in
-- customisations so there is exactly one place where approval is recorded.
-- ---------------------------------------------------------------------------
create table public.mappings (
  id          uuid primary key default gen_random_uuid(),
  dataset_id  uuid not null references public.datasets(id) on delete cascade,
  template_id uuid not null references public.report_templates(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (dataset_id, template_id)
);

create trigger mappings_touch before update on public.mappings
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- customisations — THE APPROVAL GATE
--
-- Every uncertain decision, whether made by the structurer or the auto-mapper,
-- is written here as 'pending'. Report generation reads status = 'approved'
-- only. A rejected item is never applied; an overridden item carries the user's
-- own value in `override` and counts as approved once they decide it.
--
-- mapping_id is null for dataset-level items (renames, coercions, row
-- exclusions) which apply to every template built on that dataset.
-- =============================================================================
create table public.customisations (
  id            uuid primary key default gen_random_uuid(),
  dataset_id    uuid not null references public.datasets(id) on delete cascade,
  mapping_id    uuid references public.mappings(id) on delete cascade,
  kind          public.customisation_kind not null,
  target_key    text not null,               -- column key, or template field key
  proposal      jsonb not null,              -- what the system suggests
  override      jsonb,                       -- what the user changed it to
  confidence    numeric(5,2),                -- 0-100; null when not inferred
  affected_rows int not null default 0,
  rationale     text not null,               -- why, in plain English
  status        public.customisation_status not null default 'pending',
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id)
);

create index customisations_dataset_idx on public.customisations (dataset_id, status);
create index customisations_mapping_idx on public.customisations (mapping_id, status);

-- Stamp the decision time automatically so the UI cannot forget to.
create or replace function public.stamp_customisation_decision()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.decided_at := now();
    new.decided_by := coalesce(new.decided_by, auth.uid());
  elsif new.status = 'pending' then
    new.decided_at := null;
    new.decided_by := null;
  end if;
  return new;
end;
$$;

create trigger customisations_stamp before update on public.customisations
  for each row execute function public.stamp_customisation_decision();

-- ---------------------------------------------------------------------------
-- reports — a generated run, kept so a report can be reopened as produced
-- ---------------------------------------------------------------------------
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  dataset_id   uuid not null references public.datasets(id) on delete cascade,
  template_id  uuid not null references public.report_templates(id),
  filters      jsonb not null default '{}',   -- { date_column, from, to, where: [] }
  summary      jsonb not null default '{}',
  row_count    int not null default 0,
  generated_at timestamptz not null default now()
);

create index reports_dataset_idx on public.reports (dataset_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- chat — scoped to a dataset, so the assistant can only ever see one
-- ---------------------------------------------------------------------------
create table public.chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      uuid not null references public.datasets(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index chat_sessions_dataset_idx on public.chat_sessions (dataset_id, last_message_at desc);

create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.chat_sessions(id) on delete cascade,
  role              public.chat_role not null,
  content           text not null default '',
  -- A chart the assistant produced, as a spec the client renders.
  chart             jsonb,
  tool_calls        jsonb,
  ttft_ms           int,
  latency_ms        int,
  input_tokens      int,
  output_tokens     int,
  cache_read_tokens int,
  created_at        timestamptz not null default now()
);

create index chat_messages_session_idx on public.chat_messages (session_id, created_at);
