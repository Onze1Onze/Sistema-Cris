import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSheet, CrisSheetReference } from "../src/cris/crisTypes";

const mocks = vi.hoisted(() => ({
  items: [] as any[],
  sceneMetadata: {} as Record<string, unknown>,
  selection: [] as string[],
}));

vi.mock("../src/owlbear/obr", () => ({
  default: {
    scene: {
      getMetadata: async () => mocks.sceneMetadata,
      setMetadata: async (update: Record<string, unknown>) => { Object.assign(mocks.sceneMetadata, update); },
      items: {
        getItems: async (filter?: string[] | ((item: any) => boolean)) => {
          if (Array.isArray(filter)) return mocks.items.filter((item: any) => filter.includes(item.id));
          if (typeof filter === "function") return mocks.items.filter(filter);
          return [...mocks.items];
        },
        updateItems: async (filterOrItems: any[], update: (items: any[]) => void) => {
          const ids = filterOrItems.map((item) => typeof item === "string" ? item : item.id);
          const selected = mocks.items.filter((item: any) => ids.includes(item.id));
          const draft = selected.map((item: any) => ({ ...item, metadata: { ...(item.metadata ?? {}) } }));
          update(draft);
          for (const replacement of draft) {
            const index = mocks.items.findIndex((item: any) => item.id === replacement.id);
            if (index >= 0) mocks.items[index] = replacement;
          }
        },
      },
    },
    player: { getSelection: async () => mocks.selection },
  },
}));

import { getRoomLibrary, removeRoomSheet, SCENE_LIBRARY_KEY, upsertRoomSheet } from "../src/owlbear/metadata";
import { bindTokenToSheet, getBinding, unbindAllTokensForSheet, unbindToken, updateTokenSnapshot } from "../src/owlbear/tokenBinding";

const reference: CrisSheetReference = {
  id: "ABC123",
  url: "https://crisordemparanormal.com/agente/ABC123",
  name: "Agente ABC123",
  status: "link-only",
  addedAt: 1,
};
const sheet: CharacterSheet = {
  schemaVersion: 1,
  id: "ABC123",
  sourceUrl: reference.url,
  updatedAt: 2,
  identity: { name: "Eleanor Hale" },
};

beforeEach(() => {
  mocks.items.splice(0, mocks.items.length,
    { id: "token-1", layer: "CHARACTER", metadata: { "another.extension/data": { keep: true } } },
    { id: "token-2", layer: "CHARACTER", metadata: {} },
  );
  mocks.sceneMetadata = { "another.extension/scene": { keep: true } };
  mocks.selection = [];
});

describe("metadata da sala", () => {
  it("mantém a metadata de outras extensões ao salvar a biblioteca", async () => {
    await upsertRoomSheet(reference);
    const library = await getRoomLibrary();
    expect(library.sheets[0].id).toBe("ABC123");
    expect(mocks.sceneMetadata["another.extension/scene"]).toEqual({ keep: true });
  });

  it("remove um registro sem apagar os demais", async () => {
    await upsertRoomSheet(reference);
    await upsertRoomSheet({ ...reference, id: "DEF456", name: "Agente DEF456", url: "https://crisordemparanormal.com/agente/DEF456" });
    await removeRoomSheet("ABC123");
    expect((mocks.sceneMetadata[SCENE_LIBRARY_KEY] as any).sheets.map((entry: any) => entry.id)).toEqual(["DEF456"]);
  });
});

describe("vínculos por Token", () => {
  it("associa o Token correto e mantém a ficha privada por padrão", async () => {
    await bindTokenToSheet("token-1", reference, false, sheet);
    const binding = await getBinding("token-1");
    expect(binding?.sheetId).toBe("ABC123");
    expect(binding?.shareWithPlayers).toBe(false);
    expect(binding?.snapshot).toBeUndefined();
    expect(binding?.displayName).toBe("Agente ABC123");
    expect(mocks.items[0].metadata["another.extension/data"]).toEqual({ keep: true });
  });

  it("inclui uma cópia no Token apenas quando o Mestre ativa o compartilhamento", async () => {
    await bindTokenToSheet("token-1", reference, true, sheet);
    expect((await getBinding("token-1"))?.snapshot?.identity.name).toBe("Eleanor Hale");
  });

  it("remove a cópia compartilhada quando a opção é desligada", async () => {
    await bindTokenToSheet("token-1", reference, true, sheet);
    await updateTokenSnapshot("token-1", sheet, false);
    const binding = await getBinding("token-1");
    expect(binding?.snapshot).toBeUndefined();
    expect(binding?.shareWithPlayers).toBe(false);
    expect(binding?.displayName).toBe("Agente ABC123");
  });

  it("desvincula um Token sem apagar metadata de terceiros", async () => {
    await bindTokenToSheet("token-1", reference, false, sheet);
    await unbindToken("token-1");
    expect(await getBinding("token-1")).toBeUndefined();
    expect(mocks.items[0].metadata["another.extension/data"]).toEqual({ keep: true });
  });

  it("permite fichas diferentes em Tokens diferentes e remove somente os vínculos da ficha escolhida", async () => {
    await bindTokenToSheet("token-1", reference, false);
    const second = { ...reference, id: "DEF456", name: "Agente DEF456", url: "https://crisordemparanormal.com/agente/DEF456" };
    await bindTokenToSheet("token-2", second, false);
    await unbindAllTokensForSheet("ABC123");
    expect(await getBinding("token-1")).toBeUndefined();
    expect((await getBinding("token-2"))?.sheetId).toBe("DEF456");
  });
});
