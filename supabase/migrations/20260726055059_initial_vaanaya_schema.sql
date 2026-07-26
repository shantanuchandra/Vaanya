create schema if not exists private;

create table public.organizations (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id bigint not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('clinician', 'coordinator', 'auditor')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx
  on public.organization_members (user_id);

create table public.encounters (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete restrict,
  patient_reference text not null,
  procedure_name text not null,
  preferred_language text not null,
  state text not null default 'created'
    check (
      state in (
        'created',
        'consented',
        'recording',
        'processing',
        'clinician_review',
        'signed',
        'summary_approved',
        'shared'
      )
    ),
  created_by uuid not null references auth.users(id) on delete restrict,
  assigned_clinician_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index encounters_organization_state_created_idx
  on public.encounters (organization_id, state, created_at desc);
create index encounters_created_by_idx on public.encounters (created_by);
create index encounters_assigned_clinician_idx
  on public.encounters (assigned_clinician_id)
  where assigned_clinician_id is not null;

create table public.consent_events (
  id bigint generated always as identity primary key,
  encounter_id bigint not null references public.encounters(id) on delete cascade,
  consent_type text not null check (consent_type in ('transcription', 'translation')),
  granted boolean not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index consent_events_encounter_occurred_idx
  on public.consent_events (encounter_id, occurred_at desc);

create table public.transcript_segments (
  id bigint generated always as identity primary key,
  encounter_id bigint not null references public.encounters(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  speaker_role text not null check (speaker_role in ('clinician', 'patient', 'caregiver')),
  source_language text not null,
  original_text text not null,
  translated_text text,
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  offset_seconds numeric(10, 3) not null check (offset_seconds >= 0),
  created_at timestamptz not null default now(),
  unique (encounter_id, sequence_number)
);

create index transcript_segments_encounter_sequence_idx
  on public.transcript_segments (encounter_id, sequence_number);

create table public.pac_field_proposals (
  id bigint generated always as identity primary key,
  encounter_id bigint not null references public.encounters(id) on delete cascade,
  field_key text not null,
  field_label text not null,
  field_state text not null
    check (
      field_state in (
        'captured',
        'uncertain',
        'missing',
        'intentionally_skipped',
        'clinician_entered'
      )
    ),
  proposed_value text,
  required boolean not null default false,
  model_name text,
  model_run_id text,
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (encounter_id, field_key)
);

create index pac_field_proposals_encounter_state_idx
  on public.pac_field_proposals (encounter_id, field_state);

create table public.pac_field_sources (
  proposal_id bigint not null references public.pac_field_proposals(id) on delete cascade,
  transcript_segment_id bigint not null references public.transcript_segments(id) on delete restrict,
  primary key (proposal_id, transcript_segment_id)
);

create index pac_field_sources_segment_idx
  on public.pac_field_sources (transcript_segment_id);

create table public.clinician_edits (
  id bigint generated always as identity primary key,
  encounter_id bigint not null references public.encounters(id) on delete cascade,
  proposal_id bigint references public.pac_field_proposals(id) on delete set null,
  before_value text,
  after_value text,
  reason text,
  edited_by uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index clinician_edits_encounter_occurred_idx
  on public.clinician_edits (encounter_id, occurred_at);
create index clinician_edits_proposal_idx
  on public.clinician_edits (proposal_id)
  where proposal_id is not null;

create table public.pac_note_versions (
  id bigint generated always as identity primary key,
  encounter_id bigint not null references public.encounters(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  content jsonb not null,
  status text not null check (status in ('draft', 'signed')),
  signed_by uuid references auth.users(id) on delete restrict,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (encounter_id, version_number),
  check (
    (status = 'draft' and signed_by is null and signed_at is null)
    or
    (status = 'signed' and signed_by is not null and signed_at is not null)
  )
);

create index pac_note_versions_encounter_version_idx
  on public.pac_note_versions (encounter_id, version_number desc);

create unique index pac_note_versions_one_signed_idx
  on public.pac_note_versions (encounter_id)
  where status = 'signed';

create table public.patient_summary_versions (
  id bigint generated always as identity primary key,
  encounter_id bigint not null references public.encounters(id) on delete restrict,
  pac_note_version_id bigint not null references public.pac_note_versions(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  language_code text not null,
  content jsonb not null,
  status text not null check (status in ('draft', 'approved', 'shared')),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (encounter_id, version_number)
);

create index patient_summary_versions_encounter_version_idx
  on public.patient_summary_versions (encounter_id, version_number desc);
create index patient_summary_versions_note_idx
  on public.patient_summary_versions (pac_note_version_id);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete restrict,
  encounter_id bigint not null references public.encounters(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_events_encounter_occurred_idx
  on public.audit_events (encounter_id, occurred_at);
create index audit_events_organization_occurred_idx
  on public.audit_events (organization_id, occurred_at desc);

create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable record cannot be modified';
end;
$$;

revoke all on function private.reject_mutation() from public, anon, authenticated;

create trigger signed_note_versions_are_immutable
before update or delete on public.pac_note_versions
for each row
when (old.status = 'signed')
execute function private.reject_mutation();

create trigger audit_events_are_append_only
before update or delete on public.audit_events
for each row
execute function private.reject_mutation();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.encounters enable row level security;
alter table public.consent_events enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.pac_field_proposals enable row level security;
alter table public.pac_field_sources enable row level security;
alter table public.clinician_edits enable row level security;
alter table public.pac_note_versions enable row level security;
alter table public.patient_summary_versions enable row level security;
alter table public.audit_events enable row level security;

create policy "members can read their organizations"
on public.organizations for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members member
    where member.organization_id = organizations.id
      and member.user_id = (select auth.uid())
  )
);

create policy "members can read their own membership"
on public.organization_members for select
to authenticated
using (user_id = (select auth.uid()));

create policy "members can read organization encounters"
on public.encounters for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members member
    where member.organization_id = encounters.organization_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinicians and coordinators can create encounters"
on public.encounters for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id = encounters.organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "clinicians and coordinators can update encounters"
on public.encounters for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members member
    where member.organization_id = encounters.organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
)
with check (
  exists (
    select 1
    from public.organization_members member
    where member.organization_id = encounters.organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "organization members can read consent events"
on public.consent_events for select
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = consent_events.encounter_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinical staff can create consent events"
on public.consent_events for insert
to authenticated
with check (
  recorded_by = (select auth.uid())
  and exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = consent_events.encounter_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "organization members can read transcript segments"
on public.transcript_segments for select
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = transcript_segments.encounter_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinical staff can create transcript segments"
on public.transcript_segments for insert
to authenticated
with check (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = transcript_segments.encounter_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "organization members can read PAC proposals"
on public.pac_field_proposals for select
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_field_proposals.encounter_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinicians can update PAC proposals"
on public.pac_field_proposals for update
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_field_proposals.encounter_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_field_proposals.encounter_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
);

create policy "organization members can read PAC sources"
on public.pac_field_sources for select
to authenticated
using (
  exists (
    select 1
    from public.pac_field_proposals proposal
    join public.encounters encounter on encounter.id = proposal.encounter_id
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where proposal.id = pac_field_sources.proposal_id
      and member.user_id = (select auth.uid())
  )
);

create policy "organization members can read clinician edits"
on public.clinician_edits for select
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = clinician_edits.encounter_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinicians can create clinician edits"
on public.clinician_edits for insert
to authenticated
with check (
  edited_by = (select auth.uid())
  and exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = clinician_edits.encounter_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
);

create policy "organization members can read note versions"
on public.pac_note_versions for select
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_note_versions.encounter_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinicians can create note versions"
on public.pac_note_versions for insert
to authenticated
with check (
  (status = 'draft' or signed_by = (select auth.uid()))
  and exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_note_versions.encounter_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
);

create policy "organization members can read patient summaries"
on public.patient_summary_versions for select
to authenticated
using (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = patient_summary_versions.encounter_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinicians can create patient summaries"
on public.patient_summary_versions for insert
to authenticated
with check (
  (status = 'draft' or approved_by = (select auth.uid()))
  and exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = patient_summary_versions.encounter_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
);

create policy "organization members can read audit events"
on public.audit_events for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members member
    where member.organization_id = audit_events.organization_id
      and member.user_id = (select auth.uid())
  )
);

grant usage on schema public to authenticated;
grant select on
  public.organizations,
  public.organization_members,
  public.encounters,
  public.consent_events,
  public.transcript_segments,
  public.pac_field_proposals,
  public.pac_field_sources,
  public.clinician_edits,
  public.pac_note_versions,
  public.patient_summary_versions,
  public.audit_events
to authenticated;

grant insert, update on public.encounters to authenticated;
grant insert on public.consent_events, public.transcript_segments to authenticated;
grant update on public.pac_field_proposals to authenticated;
grant insert on
  public.clinician_edits,
  public.pac_note_versions,
  public.patient_summary_versions
to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on all tables in schema public from anon;
