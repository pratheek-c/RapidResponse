import { useState, useMemo } from "react";
import type { Incident, IncidentStatus } from "@/types";
import { PriorityBadge, StatusBadge, TypeChip } from "./Badges";

type FilterTab = "all" | IncidentStatus;

type Props = {
  incidents: Incident[];
  onSelect: (id: string) => void;
  selectedId: string | null;
};

export function IncidentList({ incidents, onSelect, selectedId }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("active");

  const filtered = useMemo(() => {
    let list = incidents;
    if (filter !== "all") {
      list = list.filter((i) => i.status === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.id.toLowerCase().includes(q) ||
          i.caller_location.toLowerCase().includes(q) ||
          (i.caller_address ?? "").toLowerCase().includes(q) ||
          (i.type ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [incidents, filter, search]);

  const tabs: { label: string; value: FilterTab }[] = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Dispatched", value: "dispatched" },
    { label: "On Scene", value: "on_scene" },
    { label: "Resolved", value: "resolved" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Search */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #e5e5e5" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search incidents..."
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "1px solid #d0d0d0",
            borderRadius: 4,
            padding: "6px 10px",
            fontSize: 12,
            background: "#fafafa",
            color: "#111",
            outline: "none",
          }}
        />
      </div>

      {/* Filter tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid #e5e5e5",
          background: "#fff",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            style={{
              flex: 1,
              padding: "7px 0",
              fontSize: 11,
              fontWeight: filter === tab.value ? 700 : 400,
              background: "none",
              border: "none",
              borderBottom: filter === tab.value ? "2px solid #000" : "2px solid transparent",
              color: filter === tab.value ? "#000" : "#888",
              cursor: "pointer",
              letterSpacing: 0.3,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, flex: 1, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <li
            style={{
              color: "#aaa",
              padding: "20px 16px",
              textAlign: "center",
              fontSize: 13,
            }}
          >
            No incidents
          </li>
        ) : (
          filtered.map((inc) => {
            const isSelected = selectedId === inc.id;
            return (
              <li
                key={inc.id}
                onClick={() => onSelect(inc.id)}
                style={{
                  padding: "11px 14px",
                  borderBottom: "1px solid #eeeeee",
                  cursor: "pointer",
                  background: isSelected ? "#000" : "#fff",
                  transition: "background 0.1s",
                }}
              >
                {/* Row 1: ID + badges */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 5,
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 12,
                      color: isSelected ? "#fff" : "#111",
                      fontFamily: "monospace",
                      flexShrink: 0,
                    }}
                  >
                    #{inc.id.slice(0, 8).toUpperCase()}
                  </span>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {inc.priority && <PriorityBadge priority={inc.priority} />}
                    <StatusBadge status={inc.status} />
                  </div>
                </div>

                {/* Row 2: Location */}
                <div
                  style={{
                    fontSize: 12,
                    color: isSelected ? "#ccc" : "#444",
                    marginBottom: 4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {inc.caller_address || inc.caller_location}
                </div>

                {/* Row 3: Type + time */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  {inc.type ? (
                    <TypeChip type={inc.type} />
                  ) : (
                    <span style={{ fontSize: 11, color: isSelected ? "#777" : "#bbb" }}>
                      Unclassified
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 11,
                      color: isSelected ? "#aaa" : "#999",
                      fontFamily: "monospace",
                    }}
                  >
                    {new Date(inc.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
