import { useState } from "react";
import { X } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type BackupModalProps = {
  incidentId: string;
  requestingUnit: string;
  onClose: () => void;
};

const UNIT_TYPE_OPTIONS = [
  { id: "patrol", label: "More patrol units" },
  { id: "fire", label: "Fire department" },
  { id: "medical", label: "Medical / EMS" },
  { id: "hazmat", label: "Hazmat" },
];

type Urgency = "routine" | "urgent" | "emergency";

const URGENCY_OPTIONS: { id: Urgency; label: string; color: string; dot: string }[] = [
  {
    id: "routine",
    label: "Routine",
    color: "border-yellow-700/60 bg-yellow-900/20 text-yellow-300",
    dot: "bg-yellow-400",
  },
  {
    id: "urgent",
    label: "Urgent",
    color: "border-orange-700/60 bg-orange-900/20 text-orange-300",
    dot: "bg-orange-400",
  },
  {
    id: "emergency",
    label: "EMERGENCY",
    color: "border-red-700/60 bg-red-900/20 text-red-300",
    dot: "bg-red-500 animate-pulse",
  },
];

export function BackupModal({ incidentId, requestingUnit, onClose }: BackupModalProps) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [urgency, setUrgency] = useState<Urgency>("urgent");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleType(id: string) {
    setSelectedTypes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleSend() {
    if (selectedTypes.length === 0) {
      setError("Select at least one unit type to request.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/dispatch/backup-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incidentId,
          requesting_unit: requestingUnit,
          requested_types: selectedTypes,
          urgency,
          message: message.trim(),
        }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send backup request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-modal-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <p id="backup-modal-title" className="text-sm font-bold text-red-300">
            REQUEST BACKUP
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close backup modal"
            className="rounded border border-slate-700 p-1 text-slate-400 transition-colors hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Unit type checkboxes */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Request
            </p>
            <div className="space-y-2">
              {UNIT_TYPE_OPTIONS.map(({ id, label }) => {
                const checked = selectedTypes.includes(id);
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-700/60 bg-slate-950/60 px-3 py-2 transition-colors hover:border-slate-600"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleType(id)}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    <span className="text-sm text-slate-200">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Urgency selector */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Urgency
            </p>
            <div className="flex gap-2">
              {URGENCY_OPTIONS.map(({ id, label, color, dot }) => {
                const selected = urgency === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setUrgency(id)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors ${
                      selected ? color : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${selected ? dot : "bg-slate-600"}`} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Message */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Message (optional)
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Brief message for responding units…"
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-500 focus:ring-1 placeholder:text-slate-600"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md border border-red-700/60 bg-red-950/60 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-700/70 bg-red-600/20 px-3 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send Alert"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
