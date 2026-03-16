import type { Severity } from "@/types/dashboard";

type SeverityBadgeProps = {
  severity: Severity;
};

const palette: Record<Severity, string> = {
  1: "bg-green-500/20 text-green-300 ring-1 ring-green-500/40",
  2: "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40",
  3: "bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/40",
  4: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40",
  5: "bg-red-500/20 text-red-300 ring-1 ring-red-500/40",
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${palette[severity]}`}>
      S{severity}
    </span>
  );
}
