set local lock_timeout = '5s';

alter table public.transcript_segments
  drop constraint if exists transcript_segments_speaker_role_check;

alter table public.transcript_segments
  add constraint transcript_segments_speaker_role_check
  check (speaker_role in ('clinician', 'patient', 'caregiver', 'system'));

grant insert on public.pac_field_proposals, public.pac_field_sources
to authenticated;

create policy "clinical staff can create PAC proposals"
on public.pac_field_proposals for insert
to authenticated
with check (
  exists (
    select 1
    from public.encounters encounter
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where encounter.id = pac_field_proposals.encounter_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "clinical staff can create PAC sources"
on public.pac_field_sources for insert
to authenticated
with check (
  exists (
    select 1
    from public.pac_field_proposals proposal
    join public.encounters encounter on encounter.id = proposal.encounter_id
    join public.organization_members member
      on member.organization_id = encounter.organization_id
    where proposal.id = pac_field_sources.proposal_id
      and member.user_id = (select auth.uid())
      and member.role in ('clinician', 'coordinator')
  )
);

create policy "clinical staff can reset PAC sources"
on public.pac_field_sources for delete
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
      and member.role in ('clinician', 'coordinator')
  )
);

grant delete on public.pac_field_sources to authenticated;
