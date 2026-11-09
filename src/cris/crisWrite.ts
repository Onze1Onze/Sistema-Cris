import type { ResourceKey } from "./crisTypes";

/**
 * A existência de um PATCH no Firestore REST não prova autorização para alterar
 * fichas do C.R.I.S. Até que o C.R.I.S. publique um contrato de escrita ou
 * forneça um fluxo de autorização externa verificável, todos os recursos ficam
 * explicitamente em somente leitura.
 */
export type CrisWritableField = "currentPv" | "currentPe" | "currentSan";

export interface CrisWriteCapability {
  resource: ResourceKey;
  remoteField: CrisWritableField;
  supported: false;
  reason: string;
}

export const CRIS_WRITE_CAPABILITIES: Record<ResourceKey, CrisWriteCapability> = {
  pv: {
    resource: "pv",
    remoteField: "currentPv",
    supported: false,
    reason: "O C.R.I.S. não documenta uma API externa de escrita nem disponibiliza um fluxo de autorização para atualizar este campo.",
  },
  pe: {
    resource: "pe",
    remoteField: "currentPe",
    supported: false,
    reason: "O C.R.I.S. não documenta uma API externa de escrita nem disponibiliza um fluxo de autorização para atualizar este campo.",
  },
  san: {
    resource: "san",
    remoteField: "currentSan",
    supported: false,
    reason: "O C.R.I.S. não documenta uma API externa de escrita nem disponibiliza um fluxo de autorização para atualizar este campo.",
  },
};

export class CrisWriteUnavailableError extends Error {
  readonly code = "CRIS_WRITE_UNAVAILABLE";

  constructor(resource: ResourceKey) {
    super(CRIS_WRITE_CAPABILITIES[resource].reason);
    this.name = "CrisWriteUnavailableError";
  }
}

/**
 * Bloqueio explícito para impedir que uma edição local seja apresentada como
 * salva no C.R.I.S. Não realiza fetch, PATCH, fila offline ou alteração em cache.
 */
export async function writeResourceToCris(
  resource: ResourceKey,
  _value: number,
): Promise<never> {
  throw new CrisWriteUnavailableError(resource);
}

export function isCrisResourceWritable(_resource: ResourceKey): false {
  return false;
}
