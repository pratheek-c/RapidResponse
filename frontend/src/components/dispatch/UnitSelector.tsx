import type { DashboardUnit } from "@/types/dashboard";

type UnitSelectorProps = {
  units: DashboardUnit[];
  selectedUnitIds: string[];
  onToggle: (unitId: string) => void;
};

export function UnitSelector({ units, selectedUnitIds, onToggle }: UnitSelectorProps) {
  const available = units.filter((unit) => unit.status === "available");

  return (
    <div className="grid grid-cols-2 gap-2">
      {available.map((unit) => {
        const selected = selectedUnitIds.includes(unit.id);
        return (
          <button
            key={unit.id}
            type="button"
            onClick={() => onToggle(unit.id)}
            className={`rounded-md border px-2 py-2 text-left text-xs ${
              selected
                ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-100"
                : "border-slate-700 bg-slate-900 text-slate-300"
            }`}
          >
            <p className="font-semibold">{unit.unit_code}</p>
            <p className="text-[11px] opacity-80">{unit.department}</p>
          </button>
        );
      })}
      {available.length === 0 && <p className="col-span-2 text-xs text-slate-500">No available units.</p>}
    </div>
  );
}
