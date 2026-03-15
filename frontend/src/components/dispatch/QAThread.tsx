import type { QAEntry } from "@/types/dashboard";

type QAThreadProps = {
  entries: QAEntry[];
};

export function QAThread({ entries }: QAThreadProps) {
  return (
    <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      {entries.length === 0 && <p className="text-xs text-slate-500">No dispatch Q&A yet.</p>}
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-md border border-slate-800 bg-slate-900/70 p-2">
          <p className="text-xs font-semibold text-slate-200">Q: {entry.question}</p>
          <p className="mt-1 text-xs text-blue-200">A: {entry.answer ?? "Awaiting response..."}</p>
        </div>
      ))}
    </div>
  );
}
