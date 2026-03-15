type LiveIndicatorProps = {
  connected: boolean;
};

export function LiveIndicator({ connected }: LiveIndicatorProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/80 px-3 py-1 text-xs font-semibold tracking-wide text-slate-300">
      <span
        className={`h-2 w-2 rounded-full ${connected ? "animate-pulse-soft bg-emerald-400" : "bg-rose-400"}`}
      />
      {connected ? "LIVE" : "OFFLINE"}
    </div>
  );
}
