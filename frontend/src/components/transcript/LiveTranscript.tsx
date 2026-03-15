import { useEffect, useRef } from "react";
import type { TranscriptLine } from "@/types/dashboard";

type LiveTranscriptProps = {
  lines: TranscriptLine[];
};

export function LiveTranscript({ lines }: LiveTranscriptProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  return (
    <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      {lines.length === 0 && <p className="text-xs text-slate-500">No transcript lines yet.</p>}
      {lines.map((line) => (
        <div
          key={line.id}
          className={`max-w-[90%] rounded-lg px-2 py-1 text-sm ${
            line.role === "caller"
              ? "bg-slate-700/60 text-slate-100"
              : "ml-auto bg-blue-600/20 text-blue-100"
          }`}
        >
          {line.text}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
