import { RadioTower, ShieldAlert } from "lucide-react";
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

export function Header({ connected, department, userLabel, onSignOut }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-command-panel px-4 text-command-text shadow-glow">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-blue-900/60 bg-blue-950/40 px-2 py-1">
          <ShieldAlert className="h-4 w-4 text-blue-300" />
          <span className="text-sm font-bold tracking-wide">RapidResponse Command</span>
        </div>
        <span className="hidden text-xs text-slate-400 md:inline">Springfield Emergency Communications</span>
      </div>

      <div className="flex items-center gap-3">
        <LiveIndicator connected={connected} />
        <div className="hidden items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 md:flex">
          <DeptIcon department={department} />
          {department.toUpperCase()}
        </div>
        <div className="hidden items-center gap-2 text-xs text-slate-300 sm:flex">
          <RadioTower className="h-4 w-4 text-sky-300" />
          {userLabel}
        </div>
        <Link to="/" className="rounded-md border border-red-800/70 bg-red-900/30 px-2 py-1 text-xs font-semibold text-red-200">
          Simulate Call
        </Link>
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
