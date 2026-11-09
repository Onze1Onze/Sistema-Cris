import type { CharacterSheet, ResourceKey, ResourceValue } from "./crisTypes";

export type CrisSyncState =
  | "SYNCED"
  | "SYNCING"
  | "REMOTE_CHANGE"
  | "OFFLINE"
  | "ERROR";

export interface ResourceDelta {
  resource: ResourceKey;
  previous: number;
  current: number;
}

export interface SheetReconciliation {
  sheet: CharacterSheet;
  changedPaths: string[];
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equalValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function collectChangedPaths(
  previous: unknown,
  next: unknown,
  path = "",
): string[] {
  if (equalValue(previous, next)) return [];

  if (isRecord(previous) && isRecord(next)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    const changed: string[] = [];
    for (const key of keys) {
      if (path === "" && key === "updatedAt") continue;
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in next) || !(key in previous)) {
        changed.push(childPath);
      } else {
        changed.push(...collectChangedPaths(previous[key], next[key], childPath));
      }
    }
    return changed;
  }

  return path ? [path] : [];
}

/** Reconcilia pelo conteúdo, ignorando updatedAt isolado para não gerar falso delta. */
export function reconcileRemoteSheet(
  previous: CharacterSheet | undefined,
  incoming: CharacterSheet,
): SheetReconciliation {
  if (!previous) {
    return {
      sheet: incoming,
      changedPaths: Object.keys(incoming).filter((key) => key !== "updatedAt"),
      changed: true,
    };
  }

  const changedPaths = collectChangedPaths(previous, incoming);
  if (!changedPaths.length) {
    return { sheet: previous, changedPaths: [], changed: false };
  }

  return { sheet: incoming, changedPaths, changed: true };
}

export function diffResourceValues(
  previous: CharacterSheet["resources"],
  current: CharacterSheet["resources"],
): ResourceDelta[] {
  const keys: ResourceKey[] = ["pv", "pe", "san"];
  const changes: ResourceDelta[] = [];

  for (const resource of keys) {
    const before = previous?.[resource] as ResourceValue | undefined;
    const after = current?.[resource] as ResourceValue | undefined;
    if (!before || !after || before.current === after.current) continue;
    changes.push({
      resource,
      previous: before.current,
      current: after.current,
    });
  }

  return changes;
}

export function isCrisNetworkFailure(error: unknown): boolean {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  return ["NETWORK_OR_CORS", "TIMEOUT", "REMOTE_UNAVAILABLE"].includes(code);
}
