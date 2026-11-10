import { Logo } from "./Logo";
import { KeyRound, Lock, ShieldCheck, Smartphone } from "lucide-react";
import "./signin.css";

export type SignInMode = "checking" | "callback" | "signedOut" | "noAccess" | "failed";

/** Shown instead of the app until someone is signed in. The sign-in itself happens on the Cognito page; this screen says what to expect. */
export function SignIn({ mode, error, onSignIn, onSignOut }: { mode: SignInMode; error?: string; onSignIn: () => void; onSignOut: () => void }) {
  const working = mode === "checking" || mode === "callback";
  return (
    <main className="si-page">
      <section className="si-card" aria-live="polite">
        <div className="si-brand"><Logo size={56} /><span className="si-word">lifta<span>.</span></span></div>
        <p className="si-eyebrow">WORKSHOP SUITE</p>
        {working && (
          <>
            <div className="si-spinner" role="status" aria-label="Loading" />
            <h1>{mode === "callback" ? "Signing you in" : "One moment"}</h1>
            <p className="si-lead">{mode === "callback" ? "Finishing your sign-in…" : "Checking your session…"}</p>
          </>
        )}
        {mode === "noAccess" && (
          <>
            <h1>No access yet</h1>
            <p className="si-lead">You are signed in, but this account is not set up for the workshop. Ask the owner to add you as a mechanic or owner, then sign in again.</p>
            <button className="si-button" onClick={onSignOut}>Sign out</button>
          </>
        )}
        {(mode === "signedOut" || mode === "failed") && (
          <>
            <h1>{mode === "failed" ? "Sign-in did not finish" : "Welcome back"}</h1>
            <p className="si-lead">{mode === "failed" ? "Nothing was lost. Try signing in again." : "Sign in to manage jobs, invoices and stock for your workshop."}</p>
            {error && <p className="si-error" role="alert">{error}</p>}
            <button className="si-button" onClick={onSignIn} autoFocus><Lock size={18} aria-hidden="true" />{mode === "failed" ? "Try again" : "Sign in securely"}</button>
            <ul className="si-notes">
              <li><KeyRound size={18} aria-hidden="true" /><span><b>Password</b> from your account</span></li>
              <li><Smartphone size={18} aria-hidden="true" /><span><b>6-digit code</b> from your authenticator app</span></li>
              <li><ShieldCheck size={18} aria-hidden="true" /><span>Stays signed in on this device for 30 days</span></li>
            </ul>
            <p className="si-help">First time? Use the temporary password from your email, then scan the QR code with Google or Microsoft Authenticator. No account? Ask the owner.</p>
          </>
        )}
      </section>
    </main>
  );
}
