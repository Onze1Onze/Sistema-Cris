import type { CharacterSheet, CrisSheetReference, TokenBinding } from "../cris/crisTypes";
import OBR, { type SceneItem } from "./obr";
import { readTokenBinding, TOKEN_METADATA_KEY } from "./metadata";

export async function getCharacterTokens(): Promise<SceneItem[]> {
  return OBR.scene.items.getItems((item) => item.layer === "CHARACTER");
}

export async function getTokenById(tokenId: string): Promise<SceneItem | undefined> {
  const items = await OBR.scene.items.getItems([tokenId]);
  return items.find((item) => item.layer === "CHARACTER");
}

export async function getBinding(tokenId: string): Promise<TokenBinding | undefined> {
  return readTokenBinding(await getTokenById(tokenId));
}

export async function bindTokenToSheet(
  tokenId: string,
  reference: CrisSheetReference,
  shareWithPlayers: boolean,
  snapshot?: CharacterSheet,
): Promise<void> {
  const item = await getTokenById(tokenId);
  if (!item) throw new Error("O Token selecionado não existe mais ou não está na camada de personagens.");

  const binding: TokenBinding = {
    version: 1,
    sheetId: reference.id,
    sourceUrl: reference.url,
    displayName: shareWithPlayers && snapshot ? snapshot.identity.name : reference.name,
    boundAt: Date.now(),
    shareWithPlayers,
    ...(shareWithPlayers && snapshot ? { snapshot } : {}),
  };

  await OBR.scene.items.updateItems([item], (items) => {
    for (const draft of items) {
      draft.metadata = { ...(draft.metadata ?? {}), [TOKEN_METADATA_KEY]: binding };
    }
  });
}

export async function updateTokenSnapshot(
  tokenId: string,
  snapshot: CharacterSheet,
  shareWithPlayers: boolean,
): Promise<void> {
  const item = await getTokenById(tokenId);
  const existing = readTokenBinding(item);
  if (!item || !existing) throw new Error("Este Token ainda não possui uma ficha vinculada.");
  const { snapshot: _privateSnapshot, ...base } = existing;
  const updated: TokenBinding = {
    ...base,
    displayName: shareWithPlayers ? snapshot.identity.name : `Agente ${existing.sheetId.slice(0, 6)}`,
    shareWithPlayers,
    ...(shareWithPlayers ? { snapshot } : {}),
  };
  await OBR.scene.items.updateItems([item], (items) => {
    for (const draft of items) {
      draft.metadata = { ...(draft.metadata ?? {}), [TOKEN_METADATA_KEY]: updated };
    }
  });
}

export async function unbindToken(tokenId: string): Promise<void> {
  const item = await getTokenById(tokenId);
  if (!item) throw new Error("O Token não foi encontrado na cena.");
  await OBR.scene.items.updateItems([item], (items) => {
    for (const draft of items) {
      const metadata = { ...(draft.metadata ?? {}) };
      delete metadata[TOKEN_METADATA_KEY];
      draft.metadata = metadata;
    }
  });
}

export async function getCurrentSelection(): Promise<SceneItem[]> {
  const selectedIds = await OBR.player.getSelection();
  if (!selectedIds?.length) return [];
  const items = await OBR.scene.items.getItems(selectedIds);
  return items.filter((item) => item.layer === "CHARACTER");
}


/** Remove os vínculos de todos os Tokens associados ao mesmo registro. */
export async function unbindAllTokensForSheet(sheetId: string): Promise<void> {
  const tokens = await getCharacterTokens();
  const matching = tokens.filter((item) => readTokenBinding(item)?.sheetId === sheetId);
  if (!matching.length) return;
  await OBR.scene.items.updateItems(matching, (items) => {
    for (const draft of items) {
      const metadata = { ...(draft.metadata ?? {}) };
      delete metadata[TOKEN_METADATA_KEY];
      draft.metadata = metadata;
    }
  });
}
