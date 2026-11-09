import type { MasterRosterEntry } from "./masterPanel";

export type RosterFilter = "ALL" | "ALIVE" | "INCAPACITATED" | "INJURED" | "CONDITIONS" | "ERROR";

function hasCriticalCondition(entry: MasterRosterEntry): boolean {
  return Boolean(entry.sheet?.conditions?.some((condition) => /morrendo|inconsciente|incapacitado/i.test(condition.name)));
}

export function matchesRosterFilter(entry: MasterRosterEntry, filter: RosterFilter): boolean {
  const pv = entry.sheet?.resources?.pv?.current;
  const max = entry.sheet?.resources?.pv?.max;
  const injured = pv !== undefined && max !== undefined && pv < max;

  switch (filter) {
    case "ALL": return true;
    case "ALIVE": return pv === undefined || pv > 0;
    case "INCAPACITATED": return pv === 0 || hasCriticalCondition(entry);
    case "INJURED": return injured;
    case "CONDITIONS": return Boolean(entry.sheet?.conditions?.length);
    case "ERROR": return entry.status === "ERROR" || entry.status === "OFFLINE";
  }
}
