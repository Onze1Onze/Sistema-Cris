import type { CrisSheetReference, TokenBinding } from "../cris/crisTypes";
import OBR, { type SceneItem } from "./obr";

export const EXTENSION_ID = "com.onze1onze.sistema-cris";
export const TOKEN_METADATA_KEY = `${EXTENSION_ID}/binding`;
export const SCENE_LIBRARY_KEY = `${EXTENSION_ID}/library`;

export interface RoomLibrary {
  version: 1;
  sheets: CrisSheetReference[];
}

export function readTokenBinding(item: SceneItem | undefined): TokenBinding | undefined {
  if (!item?.metadata) return undefined;
  const value = item.metadata[TOKEN_METADATA_KEY];
  if (!value || typeof value !== "object") return undefined;
  const binding = value as Partial<TokenBinding>;
  if (binding.version !== 1 || typeof binding.sheetId !== "string" || typeof binding.sourceUrl !== "string") {
    return undefined;
  }
  return binding as TokenBinding;
}

export async function getRoomLibrary(): Promise<RoomLibrary> {
  const metadata = await OBR.scene.getMetadata();
  const raw = metadata[SCENE_LIBRARY_KEY] as Partial<RoomLibrary> | undefined;
  if (raw?.version === 1 && Array.isArray(raw.sheets)) {
    return { version: 1, sheets: raw.sheets.filter((entry) => entry && typeof entry.id === "string") };
  }
  return { version: 1, sheets: [] };
}

export async function saveRoomLibrary(library: RoomLibrary): Promise<void> {
  await OBR.scene.setMetadata({ [SCENE_LIBRARY_KEY]: library });
}

export async function upsertRoomSheet(reference: CrisSheetReference): Promise<void> {
  const library = await getRoomLibrary();
  const index = library.sheets.findIndex((sheet) => sheet.id === reference.id);
  if (index >= 0) library.sheets[index] = { ...library.sheets[index], ...reference };
  else library.sheets.unshift(reference);
  await saveRoomLibrary(library);
}

export async function removeRoomSheet(sheetId: string): Promise<void> {
  const library = await getRoomLibrary();
  await saveRoomLibrary({ version: 1, sheets: library.sheets.filter((sheet) => sheet.id !== sheetId) });
}
