import type { CharacterSheet } from "../cris/crisTypes";

const CACHE_KEY = "com.onze1onze.sistema-cris/cache/v1";

function readStore(): Record<string, CharacterSheet> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, CharacterSheet>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, CharacterSheet>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    throw new Error("Não foi possível salvar o cache local. Verifique o espaço disponível no navegador.");
  }
}

/** Cache é privado a este navegador; não substitui metadata sincronizada da sala. */
export const persistence = {
  get(sheetId: string): CharacterSheet | undefined {
    return readStore()[sheetId];
  },
  save(sheet: CharacterSheet): void {
    const store = readStore();
    store[sheet.id] = sheet;
    writeStore(store);
  },
  remove(sheetId: string): void {
    const store = readStore();
    delete store[sheetId];
    writeStore(store);
  },
  list(): CharacterSheet[] {
    return Object.values(readStore());
  },
};
