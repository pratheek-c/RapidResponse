import { useEffect, useState } from "react";
import { RadioTower, ShieldAlert, Clock, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { Department } from "@/types/dashboard";
import { DeptIcon } from "@/components/common/DeptIcon";
import { LiveIndicator } from "@/components/common/LiveIndicator";

type HeaderProps = {
  connected: boolean;
  department: Department;
  userLabel: string;
  onSignOut: () => Promise<void>;
};

function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hh = time.getHours().toString().padStart(2, "0");
  const mm = time.getMinutes().toString().padStart(2, "0");
  const ss = time.getSeconds().toString().padStart(2, "0");
  const dateStr = time.toLocaleDateString("en-IE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  return (
    <div className="hidden items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 font-mono text-xs text-slate-200 md:flex">
      <Clock className="h-3 w-3 text-slate-400" />
      <span className="text-slate-400">{dateStr}</span>
      <span className="tabular-nums tracking-wider">
        {hh}:{mm}
        <span className="text-slate-500">:{ss}</span>
      </span>
    </div>
  );
}

function ShiftBadge() {
  const hour = new Date().getHours();
  let shift: string;
  let color: string;

  if (hour >= 7 && hour < 15) {
    shift = "Day Shift · 07:00–15:00";
    color = "text-sky-300";
  } else if (hour >= 15 && hour < 23) {
    shift = "Evening Shift · 15:00–23:00";
    color = "text-amber-300";
  } else {
    shift = "Night Shift · 23:00–07:00";
    color = "text-slate-400";
  }

  return (
    <span className={`hidden text-[11px] font-medium md:inline ${color}`}>
      {shift}
    </span>
  );
}

export function Header({ connected, department, userLabel, onSignOut }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-command-panel px-4 text-command-text shadow-glow">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-blue-900/60 bg-blue-950/40 px-2 py-1">
          <ShieldAlert className="h-4 w-4 text-blue-300" />
          <span className="text-sm font-bold tracking-wide">RapidResponse</span>
          <span className="hidden text-[10px] font-semibold uppercase tracking-widest text-blue-400 sm:inline">
            CAD
          </span>
        </div>
        <div className="hidden flex-col md:flex">
          <span className="text-xs font-semibold text-slate-200">
            Dublin Emergency Communications Centre
          </span>
          <ShiftBadge />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <LiveClock />

        <LiveIndicator connected={connected} />

        <div className="hidden items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 md:flex">
          <DeptIcon department={department} />
          <span className="font-semibold uppercase tracking-wide">
            {department === "patrol"
              ? "Garda"
              : department === "fire"
                ? "DFB"
                : department === "medical"
                  ? "NAS"
                  : department.toUpperCase()}
          </span>
        </div>

        <div className="hidden items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 sm:flex">
          <RadioTower className="h-3.5 w-3.5 text-sky-300" />
          <span className="max-w-[120px] truncate">{userLabel}</span>
        </div>

        <div className="hidden items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 lg:flex">
          <Users className="h-3.5 w-3.5 text-slate-400" />
          <span>DECC</span>
        </div>

        <Link
          to="/"
          title="Open caller simulation view (F2)"
          className="rounded-md border border-red-800/70 bg-red-900/30 px-2 py-1 text-xs font-semibold text-red-200 transition-colors hover:bg-red-900/50"
        >
          Simulate 112 Call
        </Link>
        <button
          type="button"
          onClick={() => void onSignOut()}
          title="Sign out (F12)"
          className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
