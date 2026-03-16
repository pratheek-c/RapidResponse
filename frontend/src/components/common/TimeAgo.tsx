import { useEffect, useMemo, useState } from "react";

type TimeAgoProps = {
  isoTime: string;
};

function formatAgo(isoTime: string, now: number): string {
  const then = Date.parse(isoTime);
  if (!Number.isFinite(then)) return "now";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TimeAgo({ isoTime }: TimeAgoProps) {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const label = useMemo(() => formatAgo(isoTime, tick), [isoTime, tick]);
  return <span className="text-xs text-slate-400">{label}</span>;
}
