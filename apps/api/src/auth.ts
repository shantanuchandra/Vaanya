import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthenticatedActor = {
  id: string;
  email: string | null;
  organizationId: string;
  role: "clinician" | "coordinator" | "auditor";
};

export type Authenticator = {
  authenticate(token: string): Promise<AuthenticatedActor | null>;
};

export class SupabaseAuthenticator implements Authenticator {
  constructor(private readonly client: SupabaseClient) {}

  static fromEnvironment(): SupabaseAuthenticator | null {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) return null;
    return new SupabaseAuthenticator(
      createClient(url, secret, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      })
    );
  }

  async authenticate(token: string): Promise<AuthenticatedActor | null> {
    const userResult = await this.client.auth.getUser(token);
    const user = userResult.data.user;
    if (userResult.error || !user) return null;

    const membership = await this.client
      .from("organization_members")
      .select("organization_id,role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (membership.error || !membership.data) return null;

    return {
      id: user.id,
      email: user.email ?? null,
      organizationId: String(membership.data.organization_id),
      role: membership.data.role as AuthenticatedActor["role"]
    };
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
