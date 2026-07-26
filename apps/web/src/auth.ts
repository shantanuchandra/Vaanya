import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ClinicianSession = {
  accessToken: string;
  email: string | null;
};

export type AuthFacade = {
  getSession(): Promise<ClinicianSession | null>;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  onChange(listener: (session: ClinicianSession | null) => void): () => void;
};

function toSession(
  session: { access_token: string; user: { email?: string } } | null
): ClinicianSession | null {
  return session
    ? {
        accessToken: session.access_token,
        email: session.user.email ?? null
      }
    : null;
}

export function createSupabaseAuth(): AuthFacade | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;

  const client: SupabaseClient = createClient(url, publishableKey);
  return {
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session);
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    async signOut() {
      await client.auth.signOut();
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toSession(session));
      });
      return () => data.subscription.unsubscribe();
    }
  };
}
