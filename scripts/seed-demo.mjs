import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("Supabase server environment is required.");

const client = createClient(url, secret, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const clinicianEmail =
  process.env.SURUCHI_DEMO_EMAIL ??
  process.env.DEMO_CLINICIAN_EMAIL ??
  "suruchi.patel@artemis.com";
const clinicianPassword =
  process.env.SURUCHI_DEMO_PASSWORD ?? process.env.DEMO_CLINICIAN_PASSWORD;
if (!clinicianPassword) {
  throw new Error("SURUCHI_DEMO_PASSWORD is required.");
}
const users = must(
  await client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  "list demo users"
).users;
let clinician = users.find(user => user.email === clinicianEmail);

if (!clinician) {
  clinician = must(
    await client.auth.admin.createUser({
      email: clinicianEmail,
      password: clinicianPassword,
      email_confirm: true,
      user_metadata: { synthetic: true, product: "Vaanaya" }
    }),
    "create synthetic clinician"
  ).user;
} else {
  clinician = must(
    await client.auth.admin.updateUserById(clinician.id, {
      password: clinicianPassword,
      email_confirm: true
    }),
    "update synthetic clinician password"
  ).user;
}

let organization = must(
  await client
    .from("organizations")
    .select("id,name")
    .eq("name", "Vaanaya Buildathon Demo")
    .maybeSingle(),
  "find demo organization"
);
if (!organization) {
  organization = must(
    await client
      .from("organizations")
      .insert({ name: "Vaanaya Buildathon Demo" })
      .select("id,name")
      .single(),
    "create demo organization"
  );
}

must(
  await client.from("organization_members").upsert(
    {
      organization_id: organization.id,
      user_id: clinician.id,
      role: "clinician"
    },
    { onConflict: "organization_id,user_id" }
  ),
  "upsert synthetic clinician membership"
);

let encounter = must(
  await client
    .from("encounters")
    .select("id,patient_reference,state")
    .eq("organization_id", organization.id)
    .eq("patient_reference", "SYN-PAC-042")
    .maybeSingle(),
  "find demo encounter"
);

if (!encounter) {
  encounter = must(
    await client
      .from("encounters")
      .insert({
        organization_id: organization.id,
        patient_reference: "SYN-PAC-042",
        procedure_name: "Elective abdominal procedure",
        preferred_language: "hi-IN",
        state: "clinician_review",
        created_by: clinician.id,
        assigned_clinician_id: clinician.id
      })
      .select("id,patient_reference,state")
      .single(),
    "create demo encounter"
  );

  must(
    await client.from("consent_events").insert([
      {
        encounter_id: encounter.id,
        consent_type: "transcription",
        granted: true,
        recorded_by: clinician.id
      },
      {
        encounter_id: encounter.id,
        consent_type: "translation",
        granted: true,
        recorded_by: clinician.id
      }
    ]),
    "record demo consent"
  );

  const transcript = must(
    await client
      .from("transcript_segments")
      .insert([
        {
          encounter_id: encounter.id,
          sequence_number: 1,
          speaker_role: "clinician",
          source_language: "en-IN",
          original_text: "Do you take any regular medicines?",
          translated_text: "क्या आप कोई नियमित दवा लेते हैं?",
          confidence: 0.99,
          offset_seconds: 11
        },
        {
          encounter_id: encounter.id,
          sequence_number: 2,
          speaker_role: "patient",
          source_language: "hi-IN",
          original_text:
            "Woh khoon patla karne wali goli leta hoon… naam yaad nahi… kal bhi li thi.",
          translated_text:
            "I take a blood-thinning tablet; I do not remember the name; I took it yesterday.",
          confidence: 0.92,
          offset_seconds: 18
        },
        {
          encounter_id: encounter.id,
          sequence_number: 3,
          speaker_role: "clinician",
          source_language: "en-IN",
          original_text: "Do you have the strip or prescription with you?",
          translated_text: "क्या आपके पास दवा की स्ट्रिप या पर्चा है?",
          confidence: 0.99,
          offset_seconds: 27
        },
        {
          encounter_id: encounter.id,
          sequence_number: 4,
          speaker_role: "patient",
          source_language: "hi-IN",
          original_text: "Koi allergy yaad nahi hai.",
          translated_text: "I do not recall any allergy.",
          confidence: 0.95,
          offset_seconds: 42
        },
        {
          encounter_id: encounter.id,
          sequence_number: 5,
          speaker_role: "patient",
          source_language: "hi-IN",
          original_text:
            "Pehle operation hua tha, anesthesia mein problem yaad nahi.",
          translated_text:
            "I had an operation before and do not recall a problem with anesthesia.",
          confidence: 0.93,
          offset_seconds: 58
        },
        {
          encounter_id: encounter.id,
          sequence_number: 6,
          speaker_role: "patient",
          source_language: "hi-IN",
          original_text: "Raat ke khane ke baad kuch nahi liya.",
          translated_text: "I had nothing after the evening meal.",
          confidence: 0.94,
          offset_seconds: 76
        }
      ])
      .select("id,sequence_number"),
    "seed demo transcript"
  );

  const proposals = must(
    await client
      .from("pac_field_proposals")
      .insert([
        {
          encounter_id: encounter.id,
          field_key: "medications",
          field_label: "Current medicines",
          field_state: "uncertain",
          proposed_value:
            "Patient describes a blood-thinning tablet; name unknown; last reported use was yesterday.",
          required: true,
          model_name: "deterministic-demo"
        },
        {
          encounter_id: encounter.id,
          field_key: "allergies",
          field_label: "Allergies",
          field_state: "captured",
          proposed_value: "No allergy recalled in this synthetic encounter.",
          required: true,
          model_name: "deterministic-demo"
        },
        {
          encounter_id: encounter.id,
          field_key: "prior_anesthesia",
          field_label: "Previous anesthesia",
          field_state: "captured",
          proposed_value:
            "Previous procedure reported; no complication recalled.",
          required: true,
          model_name: "deterministic-demo"
        },
        {
          encounter_id: encounter.id,
          field_key: "fasting",
          field_label: "Fasting and readiness",
          field_state: "captured",
          proposed_value:
            "Patient reports no intake after the stated evening meal.",
          required: false,
          model_name: "deterministic-demo"
        }
      ])
      .select("id,field_key"),
    "seed demo proposals"
  );

  const segmentBySequence = new Map(
    transcript.map(segment => [segment.sequence_number, segment.id])
  );
  const proposalByKey = new Map(
    proposals.map(proposal => [proposal.field_key, proposal.id])
  );
  must(
    await client.from("pac_field_sources").insert([
      {
        proposal_id: proposalByKey.get("medications"),
        transcript_segment_id: segmentBySequence.get(2)
      },
      {
        proposal_id: proposalByKey.get("allergies"),
        transcript_segment_id: segmentBySequence.get(4)
      },
      {
        proposal_id: proposalByKey.get("prior_anesthesia"),
        transcript_segment_id: segmentBySequence.get(5)
      },
      {
        proposal_id: proposalByKey.get("fasting"),
        transcript_segment_id: segmentBySequence.get(6)
      }
    ]),
    "link proposal provenance"
  );

  must(
    await client.from("audit_events").insert({
      organization_id: organization.id,
      encounter_id: encounter.id,
      actor_id: clinician.id,
      action: "synthetic_demo_seeded",
      detail: { corpus_case: "SYN-PAC-042", synthetic: true }
    }),
    "append seed audit event"
  );
}

const proof = {};
for (const table of [
  "consent_events",
  "transcript_segments",
  "pac_field_proposals",
  "audit_events"
]) {
  const result = await client
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("encounter_id", encounter.id);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  proof[table] = result.count;
}
const persistedProposals = must(
  await client
    .from("pac_field_proposals")
    .select("id")
    .eq("encounter_id", encounter.id),
  "read proposal identifiers"
);
const sourceProof = await client
  .from("pac_field_sources")
  .select("*", { count: "exact", head: true })
  .in("proposal_id", persistedProposals.map(proposal => proposal.id));
if (sourceProof.error)
  throw new Error(`pac_field_sources: ${sourceProof.error.message}`);
proof.pac_field_sources = sourceProof.count;

console.log(
  JSON.stringify(
    {
      encounterId: encounter.id,
      patientReference: encounter.patient_reference,
      state: encounter.state,
      proof
    },
    null,
    2
  )
);
