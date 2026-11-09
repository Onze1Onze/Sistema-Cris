import OBR from "./obr";
import { EXTENSION_ID } from "./metadata";

const PAGES_BASE = "/Sistema-Cris/";
const OPEN_MENU_ID = `${EXTENSION_ID}/open-token`;
const BIND_MENU_ID = `${EXTENSION_ID}/bind-token`;

async function openTokenPopover(tokenId: string, anchorElementId: string): Promise<void> {
  const query = new URLSearchParams({ mode: "token", token: tokenId });
  await OBR.popover.open({
    id: `${EXTENSION_ID}/token/${tokenId}`,
    url: `${PAGES_BASE}?${query.toString()}`,
    width: 420,
    height: 720,
    anchorElementId,
  });
}

export async function registerContextMenu(): Promise<void> {
  // Remover registro antigo, se existir, para evitar duplicidade ao reabrir o iframe.
  await Promise.all([
    OBR.contextMenu.remove(OPEN_MENU_ID).catch(() => undefined),
    OBR.contextMenu.remove(BIND_MENU_ID).catch(() => undefined),
  ]);

  await OBR.contextMenu.create({
    id: OPEN_MENU_ID,
    icons: [
      {
        icon: `${PAGES_BASE}icon.svg`,
        label: "Abrir ficha C.R.I.S.",
        filter: { min: 1, max: 1, every: [{ key: "layer", value: "CHARACTER" }] },
      },
    ],
    onClick: async (context, elementId) => {
      const token = context.items.find((item) => item.layer === "CHARACTER");
      if (!token) return;
      try {
        await openTokenPopover(token.id, elementId);
      } catch (error) {
        console.error("Sistema C.R.I.S. — falha ao abrir popover", error);
        OBR.notification.show("Não foi possível abrir o dossiê C.R.I.S.");
      }
    },
  });

  await OBR.contextMenu.create({
    id: BIND_MENU_ID,
    icons: [
      {
        icon: `${PAGES_BASE}icon.svg`,
        label: "Vincular / substituir ficha C.R.I.S.",
        filter: {
          min: 1,
          max: 1,
          roles: ["GM"],
          every: [{ key: "layer", value: "CHARACTER" }],
        },
      },
    ],
    onClick: async (context, elementId) => {
      const token = context.items.find((item) => item.layer === "CHARACTER");
      if (!token) return;
      try {
        const query = new URLSearchParams({ mode: "bind", token: token.id });
        await OBR.popover.open({
          id: `${EXTENSION_ID}/bind/${token.id}`,
          url: `${PAGES_BASE}?${query.toString()}`,
          width: 420,
          height: 720,
          anchorElementId: elementId,
        });
      } catch (error) {
        console.error("Sistema C.R.I.S. — falha ao abrir vínculo", error);
        OBR.notification.show("Não foi possível abrir a configuração do vínculo.");
      }
    },
  });
}
