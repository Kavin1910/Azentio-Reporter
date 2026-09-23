-- =============================================================================
-- 0002_rls.sql — Row level security
--
-- Every table hangs off a dataset, and every dataset has an owner. One rule,
-- applied consistently: you reach a row only if you own the dataset it belongs
-- to. Templates are the single exception — a global, read-only catalogue.
-- =============================================================================

alter table public.profiles         enable row level security;
alter table public.datasets         enable row level security;
alter table public.raw_rows         enable row level security;
alter table public.dataset_columns  enable row level security;
alter table public.dataset_rows     enable row level security;
alter table public.report_templates enable row level security;
alter table public.mappings         enable row level security;
alter table public.customisations   enable row level security;
alter table public.reports          enable row level security;
alter table public.chat_sessions    enable row level security;
alter table public.chat_messages    enable row level security;

-- ---------------------------------------------------------------------------
create policy profiles_own on public.profiles
  for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy datasets_own on public.datasets
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Template catalogue: readable by any signed-in user, writable by nobody
-- through the API. Seeded by migration.
create policy templates_read on public.report_templates
  for select to authenticated
  using (active);

-- ---------------------------------------------------------------------------
-- Everything below reaches its owner through owns_dataset().
-- ---------------------------------------------------------------------------
create policy raw_rows_own on public.raw_rows
  for all to authenticated
  using (public.owns_dataset(dataset_id)) with check (public.owns_dataset(dataset_id));

create policy dataset_columns_own on public.dataset_columns
  for all to authenticated
  using (public.owns_dataset(dataset_id)) with check (public.owns_dataset(dataset_id));

create policy dataset_rows_own on public.dataset_rows
  for all to authenticated
  using (public.owns_dataset(dataset_id)) with check (public.owns_dataset(dataset_id));

create policy mappings_own on public.mappings
  for all to authenticated
  using (public.owns_dataset(dataset_id)) with check (public.owns_dataset(dataset_id));

create policy customisations_own on public.customisations
  for all to authenticated
  using (public.owns_dataset(dataset_id)) with check (public.owns_dataset(dataset_id));

create policy reports_own on public.reports
  for all to authenticated
  using (public.owns_dataset(dataset_id)) with check (public.owns_dataset(dataset_id));

create policy chat_sessions_own on public.chat_sessions
  for all to authenticated
  using (public.owns_dataset(dataset_id)) with check (public.owns_dataset(dataset_id));

create policy chat_messages_own on public.chat_messages
  for all to authenticated
  using (
    exists (select 1 from public.chat_sessions s
             where s.id = session_id and public.owns_dataset(s.dataset_id))
  )
  with check (
    exists (select 1 from public.chat_sessions s
             where s.id = session_id and public.owns_dataset(s.dataset_id))
  );

-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.report_templates to authenticated;
grant select, insert, update, delete on
  public.profiles, public.datasets, public.raw_rows, public.dataset_columns,
  public.dataset_rows, public.mappings, public.customisations, public.reports,
  public.chat_sessions, public.chat_messages
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;
