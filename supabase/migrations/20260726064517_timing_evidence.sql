create table public.timing_observations (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  scenario_id text not null,
  paper_seconds integer not null check (paper_seconds > 0 and paper_seconds <= 7200),
  vaanaya_seconds integer not null check (vaanaya_seconds > 0 and vaanaya_seconds <= 7200),
  paper_corrections integer not null check (paper_corrections >= 0),
  vaanaya_corrections integer not null check (vaanaya_corrections >= 0),
  notes text not null default '',
  observed_by uuid not null references auth.users(id) on delete restrict,
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, scenario_id)
);

alter table public.timing_observations enable row level security;

create policy "organization members can read timing evidence"
on public.timing_observations for select
to authenticated
using (
  exists (
    select 1 from public.organization_members member
    where member.organization_id = timing_observations.organization_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinical staff can create timing evidence"
on public.timing_observations for insert
to authenticated
with check (
  observed_by = (select auth.uid())
  and exists (
    select 1 from public.organization_members member
    where member.organization_id = timing_observations.organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "clinical staff can update timing evidence"
on public.timing_observations for update
to authenticated
using (
  exists (
    select 1 from public.organization_members member
    where member.organization_id = timing_observations.organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
)
with check (
  observed_by = (select auth.uid())
  and exists (
    select 1 from public.organization_members member
    where member.organization_id = timing_observations.organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);
