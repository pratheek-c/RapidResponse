import { useState } from "react";
import { ShieldAlert, ShieldCheck, RadioTower } from "lucide-react";
import { Navigate } from "react-router-dom";
import type { Department } from "@/types/dashboard";
import { DeptIcon } from "@/components/common/DeptIcon";
import { useAuth } from "@/hooks/useAuth";

const DEPARTMENTS: { id: Department; label: string; description: string }[] = [
  { id: "patrol", label: "Garda", description: "An Garda Síochána — DMR patrol" },
  { id: "fire", label: "DFB", description: "Dublin Fire Brigade — fire & rescue" },
  { id: "medical", label: "NAS", description: "National Ambulance Service — EMS" },
  { id: "hazmat", label: "Hazmat", description: "Hazardous materials response unit" },
];

export function LoginPage() {
  const { isAuthenticated, department, setDepartment, signInWithGoogle, signInDev, hasFirebaseConfig } =
    useAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSignIn() {
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // onAuthStateChanged fires → isAuthenticated → Navigate to /dashboard
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <main className="animated-grid flex min-h-screen flex-col items-center justify-center bg-command-bg px-4 py-12">
      {/* Brand bar */}
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2 rounded-xl border border-blue-900/60 bg-blue-950/40 px-4 py-2">
          <ShieldAlert className="h-5 w-5 text-blue-300" />
          <span className="text-base font-bold tracking-wide text-slate-100">
            RapidResponse Command
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Dublin Emergency Communications Centre · DECC-01
        </p>
      </div>

      {/* Login card */}
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/90 shadow-glow">
        {/* Card header */}
        <div className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800">
            <ShieldCheck className="h-4 w-4 text-blue-300" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-100">DECC Dispatcher Sign-In</h1>
            <p className="text-xs text-slate-400">
              Select your service, then authenticate with your Google work account.
            </p>
          </div>
        </div>

        <div className="p-6">
          {/* Department selection */}
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-slate-500">
            Department
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {DEPARTMENTS.map(({ id, label, description }) => {
              const selected = id === department;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDepartment(id)}
                  className={`group flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors ${
                    selected
                      ? "border-blue-500/70 bg-blue-500/10"
                      : "border-slate-700/80 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-900"
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                      selected
                        ? "border-blue-500/40 bg-blue-500/15"
                        : "border-slate-700 bg-slate-800"
                    }`}
                  >
                    <DeptIcon department={id} />
                  </div>
                  <div>
                    <p
                      className={`text-sm font-semibold leading-tight ${
                        selected ? "text-blue-100" : "text-slate-200"
                      }`}
                    >
                      {label}
                    </p>
                    <p className="mt-0.5 text-xs leading-tight text-slate-500">{description}</p>
                  </div>
                  {selected && (
                    <span className="mt-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                      Selected
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Sign-in button */}
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={!department || !hasFirebaseConfig || signingIn}
            className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-xl border border-blue-700/70 bg-blue-600/20 px-4 py-2.5 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-600/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {/* Google "G" icon */}
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
            {signingIn ? "Signing in…" : "Continue with Google"}
          </button>

          {/* Sign-in error */}
          {authError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2.5">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-400" />
              <p className="text-xs text-red-300">{authError}</p>
            </div>
          )}

          {/* Dev bypass */}
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() => { if (department) { signInDev(); } }}
              disabled={!department}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Skip sign-in (dev only)
            </button>
          )}

          {/* Firebase config warning */}
          {!hasFirebaseConfig && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2.5">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <p className="text-xs text-amber-300">
                Firebase env vars are missing. Set{" "}
                <code className="rounded bg-amber-900/40 px-1 font-mono">VITE_FIREBASE_*</code>{" "}
                in your <code className="rounded bg-amber-900/40 px-1 font-mono">.env</code> to
                enable sign-in.
              </p>
            </div>
          )}
        </div>

        {/* Card footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <RadioTower className="h-3.5 w-3.5" />
            Authorized personnel only
          </div>
          <span className="text-xs text-slate-600">RapidResponse.ai</span>
        </div>
      </section>

      <div className="mt-6 flex flex-col items-center gap-1.5">
        <p className="text-center text-xs text-slate-600">
          Secured with Google SSO · Access controlled by DECC administration
        </p>
        <p className="text-center text-[10px] text-slate-700">
          Authorized personnel only — all access is logged and audited
        </p>
      </div>
    </main>
  );
}
