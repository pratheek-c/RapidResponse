import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import type { IncidentStatus } from "@/types/dashboard";

type ActionButtonsProps = {
  onAccept: () => Promise<void>;
  onEscalate: () => Promise<void>;
  onComplete: () => Promise<void>;
  incidentStatus?: IncidentStatus;
  selectedUnitIds?: string[];
};

type ToastMessage = {
  id: number;
  text: string;
  kind: "success" | "error" | "warn";
};

type ConfirmAction = "escalate" | "complete" | null;

let toastCounter = 0;

function Toast({ messages }: { messages: ToastMessage[] }) {
  if (messages.length === 0) return null;
  const kindStyle: Record<ToastMessage["kind"], string> = {
    success: "border-emerald-700/60 bg-emerald-950/80 text-emerald-200",
    error:   "border-red-700/60 bg-red-950/80 text-red-200",
    warn:    "border-amber-700/60 bg-amber-950/80 text-amber-200",
  };
  const kindIcon: Record<ToastMessage["kind"], React.ReactNode> = {
    success: <CheckCircle className="h-3.5 w-3.5 shrink-0" />,
    error:   <XCircle className="h-3.5 w-3.5 shrink-0" />,
    warn:    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />,
  };
  return (
    <div className="mt-2 space-y-1.5">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${kindStyle[m.kind]}`}
        >
          {kindIcon[m.kind]}
          {m.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------------

type ConfirmModalProps = {
  action: "escalate" | "complete";
  onConfirm: () => void;
  onCancel: () => void;
};

function ConfirmModal({ action, onConfirm, onCancel }: ConfirmModalProps) {
  const isComplete = action === "complete";
  const title = isComplete ? "Complete Incident" : "Escalate Incident";
  const warning = isComplete
    ? "This action cannot be undone."
    : "This will escalate to additional units.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <p
          id="confirm-modal-title"
          className="mb-1 text-base font-bold text-slate-100"
        >
          {title}
        </p>
        <p className="mb-5 text-sm text-slate-400">{warning}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
              isComplete
                ? "border-red-700 bg-red-900/40 text-red-200 hover:bg-red-900/70"
                : "border-amber-600 bg-amber-900/40 text-amber-200 hover:bg-amber-900/70"
            }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ActionButtons({
  onAccept,
  onEscalate,
  onComplete,
  incidentStatus,
  selectedUnitIds = [],
}: ActionButtonsProps) {
  const [accepting, setAccepting] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  // Debounce guard: track timestamp of last keyboard trigger per key
  const lastKeyFire = useRef<Record<string, number>>({});

  function addToast(text: string, kind: ToastMessage["kind"]) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }

  const isTerminal =
    incidentStatus === "completed" ||
    incidentStatus === "resolved" ||
    incidentStatus === "cancelled";

  const isAlreadyDispatched =
    incidentStatus === "dispatched" ||
    incidentStatus === "en_route" ||
    incidentStatus === "on_scene";

  const noUnitsSelected = selectedUnitIds.length === 0;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleAccept = useCallback(async () => {
    setAccepting(true);
    try {
      await onAccept();
      addToast("Incident accepted — units en route", "success");
    } catch {
      addToast("Accept failed — check connection", "error");
    } finally {
      setAccepting(false);
    }
  }, [onAccept]);

  // Escalate: open modal first
  const handleEscalate = useCallback(() => {
    setConfirmAction("escalate");
  }, []);

  const confirmEscalate = useCallback(async () => {
    setConfirmAction(null);
    setEscalating(true);
    try {
      await onEscalate();
      addToast("Escalation request sent to supervisor", "warn");
    } catch {
      addToast("Escalation failed — retry or contact supervisor", "error");
    } finally {
      setEscalating(false);
    }
  }, [onEscalate]);

  // Complete: open modal first
  const handleComplete = useCallback(() => {
    setConfirmAction("complete");
  }, []);

  const confirmComplete = useCallback(async () => {
    setConfirmAction(null);
    setCompleting(true);
    try {
      await onComplete();
      addToast("Incident closed and logged", "success");
    } catch {
      addToast("Could not close incident — try again", "error");
    } finally {
      setCompleting(false);
    }
  }, [onComplete]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts: F4=Accept, F6=Escalate, F8=Complete (300ms debounce)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTerminal) return;
      const now = Date.now();
      const DEBOUNCE_MS = 300;

      if (e.key === "F4") {
        e.preventDefault();
        if ((now - (lastKeyFire.current["F4"] ?? 0)) < DEBOUNCE_MS) return;
        lastKeyFire.current["F4"] = now;
        void handleAccept();
      }
      if (e.key === "F6") {
        e.preventDefault();
        if ((now - (lastKeyFire.current["F6"] ?? 0)) < DEBOUNCE_MS) return;
        lastKeyFire.current["F6"] = now;
        handleEscalate();
      }
      if (e.key === "F8") {
        e.preventDefault();
        if ((now - (lastKeyFire.current["F8"] ?? 0)) < DEBOUNCE_MS) return;
        lastKeyFire.current["F8"] = now;
        handleComplete();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isTerminal, handleAccept, handleEscalate, handleComplete]);

  return (
    <>
      {/* Confirmation modal */}
      {confirmAction && (
        <ConfirmModal
          action={confirmAction}
          onConfirm={
            confirmAction === "escalate" ? () => void confirmEscalate() : () => void confirmComplete()
          }
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <div>
        <div className="grid grid-cols-3 gap-2">
          {/* Accept / Dispatch */}
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={accepting || isTerminal || isAlreadyDispatched || noUnitsSelected}
            title={
              noUnitsSelected
                ? "Select at least one unit before dispatching"
                : isAlreadyDispatched
                  ? "Units already dispatched"
                  : isTerminal
                    ? "Incident is closed"
                    : "Accept & dispatch selected units (F4)"
            }
            className="group flex flex-col items-center rounded-md border border-emerald-700 bg-emerald-500/20 px-2 py-2 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {accepting ? (
              <Loader2 className="mb-0.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle className="mb-0.5 h-3.5 w-3.5" />
            )}
            <span>{accepting ? "Dispatching…" : "Accept"}</span>
            <span className="text-[9px] font-normal opacity-60">F4</span>
          </button>

          {/* Escalate */}
          <button
            type="button"
            onClick={handleEscalate}
            disabled={escalating || isTerminal}
            title={
              isTerminal
                ? "Incident is closed"
                : "Escalate to additional departments (F6)"
            }
            className="group flex flex-col items-center rounded-md border border-amber-700 bg-amber-500/20 px-2 py-2 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {escalating ? (
              <Loader2 className="mb-0.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <AlertTriangle className="mb-0.5 h-3.5 w-3.5" />
            )}
            <span>{escalating ? "Escalating…" : "Escalate"}</span>
            <span className="text-[9px] font-normal opacity-60">F6</span>
          </button>

          {/* Complete / Close */}
          <button
            type="button"
            onClick={handleComplete}
            disabled={completing || isTerminal}
            title={
              isTerminal
                ? "Incident is already closed"
                : "Mark incident as completed (F8)"
            }
            className="group flex flex-col items-center rounded-md border border-blue-700 bg-blue-500/20 px-2 py-2 text-xs font-semibold text-blue-100 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {completing ? (
              <Loader2 className="mb-0.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="mb-0.5 h-3.5 w-3.5" />
            )}
            <span>{completing ? "Closing…" : "Complete"}</span>
            <span className="text-[9px] font-normal opacity-60">F8</span>
          </button>
        </div>

        <Toast messages={toasts} />
      </div>
    </>
  );
}
