-- =============================================================================
-- 0004_sources.sql — Data sources
--
-- Every dataset now records where it came from: a file the user dropped, or a
-- database they connected. Connections are saved so they can be tested and
-- re-imported later. The password is NOT stored in the clear: `secret_enc` is
-- AES-256-GCM ciphertext under a server-side key (SOURCE_ENCRYPTION_KEY); the
-- database never sees the plaintext and the browser never receives it back.
-- =============================================================================

create type public.source_kind as enum ('upload', 'postgres');

create table public.data_sources (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles(id) on delete cascade,
  kind              public.source_kind not null,
  name              text not null,
  -- Non-secret settings only: host, port, database, user, ssl, default table /
  -- query for a connection; filename, size and sheet for an upload.
  config            jsonb not null default '{}',
  secret_enc        text,
  last_tested_at    timestamptz,
  last_test_ok      boolean,
  last_test_note    text,
  last_imported_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger data_sources_touch before update on public.data_sources
  for each row execute function public.touch_updated_at();

create index data_sources_owner_idx on public.data_sources (owner_id, created_at desc);

alter table public.datasets
  add column source_id uuid references public.data_sources(id) on delete set null;

alter table public.data_sources enable row level security;

create policy data_sources_own on public.data_sources
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.data_sources to authenticated;
