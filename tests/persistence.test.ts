import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistence } from "../src/storage/persistence";
import type { CharacterSheet } from "../src/cris/crisTypes";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
};

const makeSheet = (id: string, name = id): CharacterSheet => ({
  schemaVersion: 1,
  id,
  sourceUrl: `https://crisordemparanormal.com/agente/${id}`,
  updatedAt: 100,
  identity: { name },
});

describe("cache local de fichas", () => {
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("salva, recupera e lista fichas por identificador", () => {
    persistence.save(makeSheet("ABC123", "Eleanor"));
    persistence.save(makeSheet("DEF456", "Ingrid"));
    expect(persistence.get("ABC123")?.identity.name).toBe("Eleanor");
    expect(persistence.list().map((sheet) => sheet.id).sort()).toEqual(["ABC123", "DEF456"]);
  });

  it("remove apenas o registro indicado", () => {
    persistence.save(makeSheet("ABC123"));
    persistence.save(makeSheet("DEF456"));
    persistence.remove("ABC123");
    expect(persistence.get("ABC123")).toBeUndefined();
    expect(persistence.get("DEF456")).toBeDefined();
  });

  it("trata cache corrompido sem derrubar a extensão", () => {
    memory.set("com.onze1onze.sistema-cris/cache/v1", "não é JSON");
    expect(persistence.list()).toEqual([]);
    expect(persistence.get("ABC123")).toBeUndefined();
  });

  it("apresenta erro legível quando o navegador bloqueia a gravação", () => {
    vi.stubGlobal("localStorage", { ...storage, setItem: () => { throw new Error("quota"); } });
    expect(() => persistence.save(makeSheet("ABC123"))).toThrow("espaço disponível");
  });
});
