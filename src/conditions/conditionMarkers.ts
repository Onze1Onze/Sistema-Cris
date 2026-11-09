import { buildLabel, type Item } from "@owlbear-rodeo/sdk";
import OBR from "../owlbear/obr";
import type { CharacterSheet, ConditionEntry, TokenBinding } from "../cris/crisTypes";
import { persistence } from "../storage/persistence";
import { readTokenBinding } from "../owlbear/metadata";
import { getCharacterTokens } from "../owlbear/tokenBinding";

const CONDITION_MARKER_KEY = "com.onze1onze.sistema-cris/condition-marker";

function signature(conditions: ConditionEntry[]): string {
  return JSON.stringify(conditions.map((item) => ({
    name: item.name,
    description: item.description,
    duration: item.duration,
  })));
}

function markerText(conditions: ConditionEntry[]): string {
  const names = conditions.map((condition) => condition.name.trim()).filter(Boolean);
  return names.length > 3
    ? `⚠ ${names.slice(0, 3).join(" · ")} +${names.length - 3}`
    : `⚠ ${names.join(" · ")}`;
}

function sheetForBinding(binding: TokenBinding, role: "GM" | "PLAYER"): CharacterSheet | undefined {
  if (role === "PLAYER" && !binding.shareWithPlayers) return undefined;
  return persistence.get(binding.sheetId) ?? binding.snapshot;
}

/** Renderiza marcadores locais anexados ao Token; eles não alteram a arte original. */
export async function syncConditionMarkers(role: "GM" | "PLAYER"): Promise<void> {
  const [tokens, existing] = await Promise.all([
    getCharacterTokens(),
    OBR.scene.local.getItems((item) => item.metadata?.[CONDITION_MARKER_KEY] !== undefined),
  ]);

  const current = new Map<string, { item: Item; token: Item; conditions: ConditionEntry[]; sig: string }>();
  for (const token of tokens) {
    const binding = readTokenBinding(token);
    if (!binding) continue;
    const sheet = sheetForBinding(binding, role);
    const conditions = sheet?.conditions ?? [];
    if (!conditions.length) continue;
    current.set(token.id, { item: token, token, conditions, sig: signature(conditions) });
  }

  const existingByToken = new Map<string, Item>();
  for (const item of existing) {
    const data = item.metadata?.[CONDITION_MARKER_KEY] as { tokenId?: string; signature?: string } | undefined;
    if (data?.tokenId) existingByToken.set(data.tokenId, item);
  }

  const deleteIds: string[] = [];
  const addItems: Item[] = [];

  for (const [tokenId, old] of existingByToken) {
    const next = current.get(tokenId);
    const metadata = old.metadata?.[CONDITION_MARKER_KEY] as { signature?: string } | undefined;
    if (!next || metadata?.signature !== next.sig) deleteIds.push(old.id);
  }

  for (const [tokenId, value] of current) {
    const old = existingByToken.get(tokenId);
    const oldMeta = old?.metadata?.[CONDITION_MARKER_KEY] as { signature?: string } | undefined;
    if (old && oldMeta?.signature === value.sig) continue;

    addItems.push(
      buildLabel()
        .plainText(markerText(value.conditions))
        .fontSize(12)
        .backgroundColor("#25151b")
        .backgroundOpacity(0.92)
        .cornerRadius(5)
        .position({ x: 0, y: -56 })
        .layer("TEXT")
        .attachedTo(tokenId)
        .disableHit(true)
        .disableAttachmentBehavior(["ROTATION", "SCALE"])
        .metadata({
          [CONDITION_MARKER_KEY]: {
            tokenId,
            signature: value.sig,
            conditions: value.conditions,
          },
        })
        .build(),
    );
  }

  if (deleteIds.length) await OBR.scene.local.deleteItems(deleteIds);
  if (addItems.length) await OBR.scene.local.addItems(addItems);
}

export function readConditionMarker(item: Item): ConditionEntry[] {
  const value = item.metadata?.[CONDITION_MARKER_KEY] as { conditions?: ConditionEntry[] } | undefined;
  return Array.isArray(value?.conditions) ? value.conditions : [];
}
