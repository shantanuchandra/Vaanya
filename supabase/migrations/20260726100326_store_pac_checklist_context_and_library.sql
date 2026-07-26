set local lock_timeout = '5s';

alter table public.encounters
  add column checklist_template_id text not null default 'synthetic-pac',
  add column checklist_version text not null default 'synthetic-pac-v1',
  add column checklist_context_flags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checklist_context_flags) = 'array'),
  add column checklist_library_procedure text,
  add column checklist_library_version integer check (checklist_library_version > 0),
  add column checklist_library_source text
    check (checklist_library_source = 'clinician_reviewed_synthetic'),
  add constraint encounters_checklist_library_reference_complete check (
    (checklist_library_procedure is null
      and checklist_library_version is null
      and checklist_library_source is null)
    or
    (checklist_library_procedure is not null
      and checklist_library_version is not null
      and checklist_library_source is not null)
  );

create table public.pac_checklist_library_versions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_procedure text not null,
  version integer not null check (version > 0),
  source text not null check (source = 'clinician_reviewed_synthetic'),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  unique (organization_id, normalized_procedure, version)
);

create index pac_checklist_library_lookup_idx
  on public.pac_checklist_library_versions
  (organization_id, normalized_procedure, version desc);

create table public.pac_checklist_suggestions (
  id text primary key,
  encounter_id bigint not null references public.encounters(id) on delete cascade,
  model_run_id text not null,
  procedure_name text not null,
  category_id text not null,
  question text not null,
  rationale text not null,
  approval_state text not null check (
    approval_state in ('pending_clinician_review', 'approved', 'rejected')
  ),
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (approval_state = 'pending_clinician_review' and decided_by is null and decided_at is null)
    or
    (approval_state in ('approved', 'rejected') and decided_by is not null and decided_at is not null)
  )
);

create index pac_checklist_suggestions_encounter_idx
  on public.pac_checklist_suggestions (encounter_id, created_at);

alter table public.pac_checklist_library_versions enable row level security;
alter table public.pac_checklist_suggestions enable row level security;

create policy "organization members can read checklist library"
on public.pac_checklist_library_versions for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members member
    where member.organization_id = pac_checklist_library_versions.organization_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinicians can publish checklist library versions"
on public.pac_checklist_library_versions for insert
to authenticated
with check (
  published_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id = pac_checklist_library_versions.organization_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
);

create policy "organization members can read checklist suggestions"
on public.pac_checklist_suggestions for select
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_checklist_suggestions.encounter_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinical staff can create checklist suggestions"
on public.pac_checklist_suggestions for insert
to authenticated
with check (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_checklist_suggestions.encounter_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "clinicians can decide checklist suggestions"
on public.pac_checklist_suggestions for update
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_checklist_suggestions.encounter_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
)
with check (
  decided_by = (select auth.uid())
);

grant select, insert on public.pac_checklist_library_versions to authenticated;
grant select, insert, update on public.pac_checklist_suggestions to authenticated;
grant usage, select on all sequences in schema public to authenticated;
