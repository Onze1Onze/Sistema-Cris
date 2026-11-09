import type { CrisLink } from "./crisTypes";

const CRIS_HOSTS = new Set(["crisordemparanormal.com", "www.crisordemparanormal.com"]);
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;

export class CrisLinkError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_URL" | "INVALID_HOST" | "INVALID_PATH" | "INVALID_ID",
  ) {
    super(message);
    this.name = "CrisLinkError";
  }
}

/**
 * Valida apenas o formato público conhecido da URL /agente/{id}.
 * Não faz uma requisição ao C.R.I.S. e não afirma que a ficha existe ou está pública.
 */
export function validateCrisUrl(input: string): CrisLink {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new CrisLinkError("Informe um endereço completo de uma ficha do C.R.I.S.", "INVALID_URL");
  }

  if (parsed.protocol !== "https:") {
    throw new CrisLinkError("Use o endereço HTTPS oficial do C.R.I.S.", "INVALID_URL");
  }
  if (parsed.username || parsed.password) {
    throw new CrisLinkError("O link não pode conter credenciais de acesso.", "INVALID_URL");
  }
  if (!CRIS_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new CrisLinkError("O endereço precisa pertencer a crisordemparanormal.com.", "INVALID_HOST");
  }

  const match = parsed.pathname.match(/^\/agente\/([^/]+)\/?$/i);
  if (!match) {
    throw new CrisLinkError("O link não está no formato de uma ficha pública (/agente/...).", "INVALID_PATH");
  }

  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    throw new CrisLinkError("O identificador da ficha está malformado.", "INVALID_ID");
  }
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new CrisLinkError("O identificador da ficha possui um formato inválido.", "INVALID_ID");
  }

  return {
    id,
    url: `https://crisordemparanormal.com/agente/${id}`,
  };
}

export interface LinkConnectionResult {
  link: CrisLink;
  state: "LINK_VALIDATED";
  dataRead: false;
  message: string;
}

/**
 * O C.R.I.S. não possui API pública documentada verificada neste projeto.
 * A etapa de conexão, portanto, valida o endereço e prepara o vínculo sem
 * consultar endpoints internos, fazer scraping ou contornar CORS/autenticação.
 */
export async function connectCrisLink(input: string): Promise<LinkConnectionResult> {
  const link = validateCrisUrl(input);
  return {
    link,
    state: "LINK_VALIDATED",
    dataRead: false,
    message:
      "Link reconhecido. A leitura automática ainda não está disponível: importe um JSON no formato do Sistema C.R.I.S. ou abra a ficha no site oficial.",
  };
}
