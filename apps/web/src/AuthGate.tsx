import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { AuthFacade, ClinicianSession } from "./auth";
import { setAccessTokenProvider } from "./api";

export function AuthGate({
  auth,
  children
}: {
  auth: AuthFacade | null;
  children: ReactNode;
}) {
  const [session, setSession] = useState<ClinicianSession | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth) {
      setAccessTokenProvider(async () => null);
      setReady(true);
      return;
    }
    let active = true;
    auth.getSession().then(next => {
      if (!active) return;
      setAccessTokenProvider(async () => next?.accessToken ?? null);
      setSession(next);
      setReady(true);
    });
    const unsubscribe = auth.onChange(next => {
      setAccessTokenProvider(async () => next?.accessToken ?? null);
      setSession(next);
      setReady(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError(null);
    const result = await auth.signIn(email.trim(), password);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  if (!ready) {
    return <main className="auth-loading">Checking clinician session…</main>;
  }
  if (session) return <>{children}</>;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-seal"><ShieldCheck size={25} /></div>
        <span className="section-label">Clinician-controlled access</span>
        <h1>Review what was said.<br />Sign only what is known.</h1>
        <p>
          Vaanaya keeps transcript evidence, clinical corrections, and sign-off
          under an authorized clinician account.
        </p>
        {!auth ? (
          <div className="auth-error" role="alert">
            Browser authentication is not configured for this deployment.
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Clinician email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              <KeyRound size={16} />
              {busy ? "Opening workspace…" : "Open review workspace"}
            </button>
            {error && <div className="auth-error" role="alert">{error}</div>}
          </form>
        )}
        <small>Synthetic buildathon cases only · clinician sign-off required</small>
      </section>
    </main>
  );
}
