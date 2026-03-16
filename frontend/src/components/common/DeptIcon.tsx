import { Biohazard, Flame, Shield, Stethoscope } from "lucide-react";
import type { Department } from "@/types/dashboard";

type DeptIconProps = {
  department: Department;
  className?: string;
};

export function DeptIcon({ department, className }: DeptIconProps) {
  if (department === "fire") {
    return <Flame className={className ?? "h-4 w-4 text-red-500"} />;
  }
  if (department === "medical") {
    return <Stethoscope className={className ?? "h-4 w-4 text-emerald-500"} />;
  }
  if (department === "hazmat") {
    return <Biohazard className={className ?? "h-4 w-4 text-amber-500"} />;
  }
  return <Shield className={className ?? "h-4 w-4 text-blue-500"} />;
}
