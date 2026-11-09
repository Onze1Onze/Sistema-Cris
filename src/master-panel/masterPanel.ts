import type { CharacterSheet, TokenBinding } from "../cris/crisTypes";
import { connectCrisLink } from "../cris/crisClient";
import { reconcileRemoteSheet, diffResourceValues } from "../cris/crisSync";
import { persistence } from "../storage/persistence";
import { readTokenBinding } from "../owlbear/metadata";
import { getCharacterTokens, syncSharedSnapshotsForSheet } from "../owlbear/tokenBinding";
import OBR, { type SceneItem } from "../owlbear/obr";
import { appendSessionEvent } from "../history/sessionHistory";
import type { RosterFilter } from "./rosterFilters";
import { matchesRosterFilter } from "./rosterFilters";

const lastRemoteCheck = new Map<string, number>();

export type RosterSyncState = "SYNCED" | "SYNCING" | "OFFLINE" | "ERROR";

export interface MasterRosterEntry {
  tokenId: string;
  tokenName: string;
  binding: TokenBinding;
  sheet?: CharacterSheet;
  status: RosterSyncState;
  lastSyncAt?: number;
  error?: string;
}

export async function locateToken(tokenId: string): Promise<void> {
  const bounds = await OBR.scene.items.getItemBounds([tokenId]);
  await OBR.viewport.animateToBounds(bounds);
}

export async function loadMasterRoster(force = false): Promise<MasterRosterEntry[]> {
  const tokens = await getCharacterTokens();
  const linked = tokens.map((token) => ({
    token,
    binding: readTokenBinding(token),
  })).filter((entry): entry is { token: SceneItem; binding: TokenBinding } => Boolean(entry.binding));

  const bySheet = new Map<string, { binding: TokenBinding; sheet?: CharacterSheet; status: RosterSyncState; lastSyncAt?: number; error?: string }>();
  const unique = new Map<string, TokenBinding>();
  for (const entry of linked) unique.set(entry.binding.sheetId, entry.binding);

  const work = [...unique.entries()];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, work.length) }, async () => {
    while (cursor < work.length) {
      const index = cursor++;
      const [sheetId, binding] = work[index];
      const previousSheet = persistence.get(sheetId) ?? binding.snapshot;
      let sheet = previousSheet;
      let lastSyncAt = lastRemoteCheck.get(sheetId);
      let status: RosterSyncState = "SYNCED";
      let error: string | undefined;

      if (force || !sheet || Date.now() - (lastSyncAt ?? 0) > 30_000) {
        status = "SYNCING";
        try {
          const result = await connectCrisLink(binding.sourceUrl);
          const reconciliation = reconcileRemoteSheet(previousSheet, result.sheet);
          sheet = reconciliation.sheet;
          lastSyncAt = Date.now();
          lastRemoteCheck.set(sheetId, lastSyncAt);
          if (reconciliation.changed) {
            persistence.save(sheet);
            const deltas = diffResourceValues(previousSheet?.resources, sheet.resources);
            const previousConditions = new Map((previousSheet?.conditions ?? []).map((condition) => [condition.name.toLocaleLowerCase("pt-BR"), condition]));
            const currentConditions = new Map((sheet.conditions ?? []).map((condition) => [condition.name.toLocaleLowerCase("pt-BR"), condition]));
            for (const [key, condition] of currentConditions) {
              if (!previousConditions.has(key)) {
                await appendSessionEvent({
                  characterId: sheetId,
                  characterName: sheet.identity.name,
                  tokenId: linked.find((entry) => entry.binding.sheetId === sheetId)?.token.id,
                  kind: "CONDITION_ADDED",
                  field: condition.name,
                  source: "C.R.I.S.",
                  detail: condition.description ?? condition.duration,
                });
              }
            }
            for (const [key, condition] of previousConditions) {
              if (!currentConditions.has(key)) {
                await appendSessionEvent({
                  characterId: sheetId,
                  characterName: sheet.identity.name,
                  tokenId: linked.find((entry) => entry.binding.sheetId === sheetId)?.token.id,
                  kind: "CONDITION_REMOVED",
                  field: condition.name,
                  source: "C.R.I.S.",
                });
              }
            }
            for (const delta of deltas) {
              await appendSessionEvent({
                characterId: sheetId,
                characterName: sheet.identity.name,
                tokenId: linked.find((entry) => entry.binding.sheetId === sheetId)?.token.id,
                kind: "RESOURCE_CHANGED",
                field: delta.resource.toUpperCase(),
                before: delta.previous,
                after: delta.current,
                source: "C.R.I.S.",
              });
            }
            if (linked.some((entry) => entry.binding.sheetId === sheetId && entry.binding.shareWithPlayers)) {
              await syncSharedSnapshotsForSheet(sheetId, sheet);
            }
          } else if (!previousSheet && sheet) {
            persistence.save(sheet);
          }
          status = "SYNCED";
        } catch (caught) {
          status = caught instanceof Error && "code" in caught && ["NETWORK_OR_CORS", "TIMEOUT", "REMOTE_UNAVAILABLE"].includes(String((caught as {code:unknown}).code))
            ? "OFFLINE"
            : "ERROR";
          error = caught instanceof Error ? caught.message : "Falha ao consultar a ficha.";
        }
      }
      bySheet.set(sheetId, { binding, sheet, status, lastSyncAt, error });
    }
  });

  await Promise.all(workers);
  return linked.map(({ token, binding }) => {
    const data = bySheet.get(binding.sheetId);
    return {
      tokenId: token.id,
      tokenName: token.name ?? data?.sheet?.identity.name ?? binding.displayName ?? "Token",
      binding,
      sheet: data?.sheet,
      status: data?.status ?? "ERROR",
      ...(data?.lastSyncAt ? { lastSyncAt: data.lastSyncAt } : {}),
      ...(data?.error ? { error: data.error } : {}),
    };
  });
}
