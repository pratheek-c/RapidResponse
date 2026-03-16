import { useEffect, useMemo, useRef } from "react";
import type { TranscriptAnnotation, TranscriptLine } from "@/types/dashboard";

type LiveTranscriptProps = {
  lines: TranscriptLine[];
  annotations?: TranscriptAnnotation[];
};

// ---------------------------------------------------------------------------
// Color → Tailwind class mapping
// ---------------------------------------------------------------------------

const COLOR_CLASSES: Record<string, { bg: string; text: string; border: string }> = {
  blue: {
    bg: "bg-blue-950/60",
    text: "text-blue-300",
    border: "border-blue-800/50",
  },
  green: {
    bg: "bg-green-950/60",
    text: "text-green-300",
    border: "border-green-800/50",
  },
  yellow: {
    bg: "bg-yellow-950/60",
    text: "text-yellow-300",
    border: "border-yellow-800/50",
  },
  cyan: {
    bg: "bg-cyan-950/60",
    text: "text-cyan-300",
    border: "border-cyan-800/50",
  },
  red: {
    bg: "bg-red-950/60",
    text: "text-red-300",
    border: "border-red-800/50",
  },
};

const DEFAULT_COLOR_CLASSES = {
  bg: "bg-slate-800/60",
  text: "text-slate-300",
  border: "border-slate-700/50",
};

// ---------------------------------------------------------------------------
// Unified timeline item
// ---------------------------------------------------------------------------

type TimelineItem =
  | { kind: "line"; line: TranscriptLine }
  | { kind: "annotation"; annotation: TranscriptAnnotation };

export function LiveTranscript({ lines, annotations = [] }: LiveTranscriptProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Build a unified timeline sorted by timestamp
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...lines.map((line): TimelineItem => ({ kind: "line", line })),
      ...annotations.map((annotation): TimelineItem => ({ kind: "annotation", annotation })),
    ];
    items.sort((a, b) => {
      const ta = a.kind === "line" ? a.line.timestamp : a.annotation.timestamp;
      const tb = b.kind === "line" ? b.line.timestamp : b.annotation.timestamp;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    return items;
  }, [lines, annotations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [timeline]);

  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      {timeline.length === 0 && (
        <p className="text-xs text-slate-500">No transcript lines yet.</p>
      )}

      {timeline.map((item, idx) => {
        if (item.kind === "line") {
          const line = item.line;
          return (
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
          );
        }

        // annotation pill
        const annotation = item.annotation;
        const cls = COLOR_CLASSES[annotation.color] ?? DEFAULT_COLOR_CLASSES;
        const time = new Date(annotation.timestamp).toLocaleTimeString("en-IE", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return (
          <div
            key={`annotation-${idx}`}
            className="flex items-center gap-2 py-1 px-2 my-0.5"
          >
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls.bg} ${cls.text} border ${cls.border}`}
            >
              <span>{annotation.icon}</span>
              <span>{annotation.label}</span>
            </div>
            <span className="text-[10px] text-slate-600">{time}</span>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
