import { useState } from "react";

type SummaryModalProps = {
  open: boolean;
  initialSummary: string;
  onSave: (summary: string) => Promise<void>;
  onClose: () => void;
};

export function SummaryModal({ open, initialSummary, onSave, onClose }: SummaryModalProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(summary.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-700 bg-command-panel p-4 shadow-glow">
        <h2 className="text-lg font-semibold text-slate-100">Finalize Incident Summary</h2>
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={8}
          className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md border border-emerald-700 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Report"}
          </button>
        </div>
      </div>
    </div>
  );
}
