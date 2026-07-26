create table public.golden_case_reviews (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  case_id text not null,
  verdict text not null check (verdict in ('approved', 'needs_revision', 'unsafe')),
  notes text not null default '',
  confidence smallint not null check (confidence between 1 and 5),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, case_id)
);

create index golden_case_reviews_org_reviewed_idx
  on public.golden_case_reviews (organization_id, reviewed_at desc);

alter table public.golden_case_reviews enable row level security;

create policy "organization members can read golden reviews"
on public.golden_case_reviews for select
to authenticated
using (
  exists (
    select 1 from public.organization_members member
    where member.organization_id = golden_case_reviews.organization_id
      and member.user_id = (select auth.uid())
  )
);

create policy "clinicians can create golden reviews"
on public.golden_case_reviews for insert
to authenticated
with check (
  reviewer_id = (select auth.uid())
  and exists (
    select 1 from public.organization_members member
    where member.organization_id = golden_case_reviews.organization_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
);

create policy "clinicians can update golden reviews"
on public.golden_case_reviews for update
to authenticated
using (
  exists (
    select 1 from public.organization_members member
    where member.organization_id = golden_case_reviews.organization_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
)
with check (
  reviewer_id = (select auth.uid())
  and exists (
    select 1 from public.organization_members member
    where member.organization_id = golden_case_reviews.organization_id
      and member.user_id = (select auth.uid())
      and member.role = 'clinician'
  )
);
