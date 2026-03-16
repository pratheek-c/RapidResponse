import { ShieldAlert, ShieldCheck, RadioTower, Loader2, ChevronDown } from "lucide-react";
import { DeptIcon } from "@/components/common/DeptIcon";
import { Navigate, useNavigate } from "react-router-dom";
import type { Department } from "@/types/dashboard";
import { useAuth } from "@/hooks/useAuth";
import { useSession } from "@/context/SessionContext";
import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const DEPARTMENTS: { id: Department; label: string; description: string }[] = [
    { id: "patrol", label: "Garda", description: "An Garda Síochána — DMR patrol" },
    { id: "fire", label: "DFB", description: "Dublin Fire Brigade — fire & rescue" },
    { id: "medical", label: "NAS", description: "National Ambulance Service — EMS" },
    { id: "hazmat", label: "Hazmat", description: "Hazardous materials response unit" },
];

const STATIONS = [
    { id: "dublin", name: "Dublin Central" },
    { id: "cork", name: "Cork Central" },
    { id: "galway", name: "Galway Central" },
];

type AvailableUnit = {
    id: string;
    unit_code: string;
    type: string;
    status: string;
};

// Map DB unit type → Department tab
function unitTypeToDept(type: string): Department {
    if (type === "police") return "patrol";
    if (type === "ems") return "medical";
    if (type === "hazmat") return "hazmat";
    return "fire"; // fire + rescue → fire tab
}

// ---------------------------------------------------------------------------
// Role selector step (shown after successful auth)
// ---------------------------------------------------------------------------

type RoleSelectorProps = {
    authUserName: string;
    authUserEmail: string;
    onConfirm: (role: "dispatcher" | "unit_officer", stationId?: string, unit?: { id: string; type: string; label: string }) => void;
};

function RoleSelector({ authUserName, authUserEmail, onConfirm }: RoleSelectorProps) {
    const [selectedRole, setSelectedRole] = useState<"dispatcher" | "unit_officer" | null>(null);
    const [selectedStation, setSelectedStation] = useState<string>("dublin");
    const [activeDept, setActiveDept] = useState<Department>("patrol");
    const [availableUnits, setAvailableUnits] = useState<AvailableUnit[]>([]);
    const [loadingUnits, setLoadingUnits] = useState(false);
    const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

    // Fetch available units when unit_officer role is selected or dept tab changes
    useEffect(() => {
        if (selectedRole !== "unit_officer") return;
        setLoadingUnits(true);
        setSelectedUnitId(null);
        void fetch(`${API_BASE}/units?status=available`)
            .then((r) => r.json())
            .then((payload: { ok: boolean; data: AvailableUnit[] }) => {
                if (payload.ok) setAvailableUnits(payload.data);
            })
            .catch(() => setAvailableUnits([]))
            .finally(() => setLoadingUnits(false));
    }, [selectedRole]);

    const filteredUnits = availableUnits.filter((u) => unitTypeToDept(u.type) === activeDept);

    const canEnter =
        selectedRole === "dispatcher"
            ? Boolean(selectedStation)
            : Boolean(selectedUnitId);

    function handleEnter() {
        if (!canEnter || !selectedRole) return;
        if (selectedRole === "dispatcher") {
            onConfirm("dispatcher", selectedStation, undefined);
        } else {
            const unit = availableUnits.find((u) => u.id === selectedUnitId);
            if (!unit) return;
            onConfirm("unit_officer", undefined, {
                id: unit.id,
                type: unit.type,
                label: unit.unit_code,
            });
        }
    }

    return (
        <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900/90 shadow-glow">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800">
                    <ShieldCheck className="h-4 w-4 text-blue-300" />
                </div>
                <div>
                    <h1 className="text-sm font-semibold text-slate-100">Select Your Role</h1>
                    <p className="text-xs text-slate-400">
                        Signed in as{" "}
                        <span className="font-medium text-slate-200">{authUserName || authUserEmail}</span>
                    </p>
                </div>
            </div>

            <div className="p-6 space-y-5">
                {/* Role cards */}
                <div>
                    <p className="mb-3 text-xs font-medium uppercase tracking-widest text-slate-500">
                        Role
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        {(["dispatcher", "unit_officer"] as const).map((role) => {
                            const isSelected = selectedRole === role;
                            const icon = role === "dispatcher" ? "📡" : "🚔";
                            const title = role === "dispatcher" ? "DISPATCHER" : "UNIT OFFICER";
                            const subtitle = role === "dispatcher" ? "Command Center" : "Field Responder";
                            return (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => {
                                        setSelectedRole(role);
                                        setSelectedUnitId(null);
                                    }}
                                    className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
                                        isSelected
                                            ? "border-blue-500/70 bg-blue-500/10"
                                            : "border-slate-700/80 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-900"
                                    }`}
                                >
                                    <span className="text-xl">{icon}</span>
                                    <div>
                                        <p className={`text-sm font-bold ${isSelected ? "text-blue-100" : "text-slate-200"}`}>
                                            {title}
                                        </p>
                                        <p className="text-xs text-slate-500">{subtitle}</p>
                                    </div>
                                    {isSelected && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                                            Selected
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Dispatcher: station selector */}
                {selectedRole === "dispatcher" && (
                    <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">
                            Station
                        </p>
                        <div className="relative">
                            <select
                                value={selectedStation}
                                onChange={(e) => setSelectedStation(e.target.value)}
                                className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 pr-9 text-sm text-slate-100 outline-none ring-blue-500 focus:ring-1"
                            >
                                {STATIONS.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        </div>
                    </div>
                )}

                {/* Unit Officer: department tabs + unit list */}
                {selectedRole === "unit_officer" && (
                    <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">
                            Your Unit
                        </p>
                        {/* Dept tabs */}
                        <div className="mb-3 flex gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
                            {DEPARTMENTS.map(({ id, label }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => { setActiveDept(id); setSelectedUnitId(null); }}
                                    className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                                        activeDept === id
                                            ? "bg-slate-700 text-slate-100"
                                            : "text-slate-500 hover:text-slate-300"
                                    }`}
                                >
                                    <DeptIcon department={id} />
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Unit list */}
                        <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950">
                            {loadingUnits ? (
                                <div className="flex items-center justify-center gap-2 py-6">
                                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                                    <span className="text-xs text-slate-500">Loading units…</span>
                                </div>
                            ) : filteredUnits.length === 0 ? (
                                <div className="py-4 text-center text-xs text-slate-500">
                                    No available units in this department
                                </div>
                            ) : (
                                filteredUnits.map((unit) => {
                                    const isSelected = selectedUnitId === unit.id;
                                    return (
                                        <button
                                            key={unit.id}
                                            type="button"
                                            onClick={() => setSelectedUnitId(unit.id)}
                                            className={`flex w-full items-center justify-between border-b border-slate-800 px-3 py-2.5 text-left last:border-b-0 transition-colors ${
                                                isSelected
                                                    ? "bg-blue-500/10"
                                                    : "hover:bg-slate-900"
                                            }`}
                                        >
                                            <div>
                                                <p className={`text-sm font-semibold ${isSelected ? "text-blue-200" : "text-slate-200"}`}>
                                                    {unit.unit_code}
                                                </p>
                                                <p className="text-[11px] capitalize text-slate-500">
                                                    {unit.type}
                                                </p>
                                            </div>
                                            <span className="rounded border border-emerald-700/60 bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                                                Available
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}

                {/* Enter button */}
                <button
                    type="button"
                    onClick={handleEnter}
                    disabled={!canEnter}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-700/70 bg-blue-600/20 px-4 py-2.5 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-600/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Enter Dashboard
                </button>
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Main LoginPage
// ---------------------------------------------------------------------------

export function LoginPage() {
    const { isAuthenticated, loading, signInWithGoogle, signInDev, hasFirebaseConfig, user } =
        useAuth();
    const { session, setSession } = useSession();
    const navigate = useNavigate();
    const [authError, setAuthError] = useState<string | null>(null);
    const [signingIn, setSigningIn] = useState(false);

    // Step 1 = select department + sign in, Step 2 = select role (after auth)
    const [step, setStep] = useState<1 | 2>(1);

    // Once authenticated, proceed to role selection (step 2) — but only if no
    // session is already stored (returning user goes straight to dashboard).
    useEffect(() => {
        if (isAuthenticated && session) {
            void navigate("/dashboard", { replace: true });
        } else if (isAuthenticated && !session) {
            setStep(2);
        }
    }, [isAuthenticated, session, navigate]);

    if (loading) {
        return (
            <main className="animated-grid flex min-h-screen flex-col items-center justify-center bg-command-bg">
                <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                <p className="mt-3 text-xs text-slate-500">Checking credentials…</p>
            </main>
        );
    }

    // Already has a complete session → go straight to dashboard
    if (isAuthenticated && session) {
        return <Navigate to="/dashboard" replace />;
    }

    async function handleSignIn() {
        setAuthError(null);
        setSigningIn(true);
        try {
            await signInWithGoogle();
            // onAuthStateChanged fires → isAuthenticated → useEffect above sets step=2
        } catch (err) {
            setAuthError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
        } finally {
            setSigningIn(false);
        }
    }

    function handleRoleConfirm(
        role: "dispatcher" | "unit_officer",
        stationId?: string,
        unit?: { id: string; type: string; label: string }
    ) {
        const station = stationId
            ? STATIONS.find((s) => s.id === stationId)
            : undefined;

        const newSession = {
            user: {
                id: user?.uid ?? "dev-user",
                name: user?.displayName ?? user?.email ?? "Dispatcher",
                email: user?.email ?? "",
                avatar: user?.photoURL ?? "",
            },
            role,
            unit,
            station: station ? { id: station.id, name: station.name } : undefined,
        };
        setSession(newSession);
        void navigate("/dashboard", { replace: true });
    }

    // Step 2: role selector (user is authenticated but has no session yet)
    if (step === 2 && isAuthenticated) {
        return (
            <main className="animated-grid flex min-h-screen flex-col items-center justify-center bg-command-bg px-4 py-12">
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

                <RoleSelector
                    authUserName={user?.displayName ?? ""}
                    authUserEmail={user?.email ?? ""}
                    onConfirm={handleRoleConfirm}
                />
            </main>
        );
    }

    // Step 1: sign in only
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
            <section className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900/90 shadow-glow">
                <div className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800">
                        <ShieldCheck className="h-4 w-4 text-blue-300" />
                    </div>
                    <div>
                        <h1 className="text-sm font-semibold text-slate-100">DECC Sign-In</h1>
                        <p className="text-xs text-slate-400">Authenticate with your Google work account.</p>
                    </div>
                </div>

                <div className="p-6">
                    <button
                        type="button"
                        onClick={() => void handleSignIn()}
                        disabled={!hasFirebaseConfig || signingIn}
                        className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-blue-700/70 bg-blue-600/20 px-4 py-2.5 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-600/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
                        </svg>
                        {signingIn ? "Signing in…" : "Continue with Google"}
                    </button>

                    {authError && (
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2.5">
                            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-400" />
                            <p className="text-xs text-red-300">{authError}</p>
                        </div>
                    )}

                    {import.meta.env.DEV && (
                        <button
                            type="button"
                            onClick={() => signInDev()}
                            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800"
                        >
                            Skip sign-in (dev only)
                        </button>
                    )}

                    {!hasFirebaseConfig && (
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2.5">
                            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                            <p className="text-xs text-amber-300">
                                Firebase env vars missing —{" "}
                                <code className="rounded bg-amber-900/40 px-1 font-mono">VITE_FIREBASE_*</code> required.
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <RadioTower className="h-3.5 w-3.5" />
                        Authorized personnel only
                    </div>
                    <span className="text-xs text-slate-600">RapidResponse.ai</span>
                </div>
            </section>
        </main>
    );
}
