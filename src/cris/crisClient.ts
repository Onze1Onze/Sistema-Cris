import type { CrisLink, CharacterSheet } from "./crisTypes";
import { parseFirestoreCharacterDocument } from "./crisParser";

const CRIS_HOSTS = new Set(["crisordemparanormal.com", "www.crisordemparanormal.com"]);
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;
const FIRESTORE_PROJECT_ID = "cris-ordem-paranormal";
const FIRESTORE_COLLECTION = "characters";
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Chave pública de cliente Firebase usada em integrações públicas do C.R.I.S.
 * Ela identifica o projeto web, não autentica o usuário nem substitui as regras
 * de segurança do Firestore. Não é uma senha ou token de sessão.
 */
const CRIS_PUBLIC_FIREBASE_API_KEY = "AIzaSyADXkE6U5j_hlSRxK3nfqyylmPXgUeGWsQ";

export class CrisLinkError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_URL"
      | "INVALID_HOST"
      | "INVALID_PATH"
      | "INVALID_ID"
      | "DOCUMENT_NOT_FOUND"
      | "ACCESS_DENIED"
      | "PRIVATE_SHEET"
      | "REMOTE_UNAVAILABLE"
      | "NETWORK_OR_CORS"
      | "TIMEOUT"
      | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "CrisLinkError";
  }
}

/** Valida apenas o host e a rota pública conhecida /agente/{id}. */
export function validateCrisUrl(input: string): CrisLink {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new CrisLinkError("Informe o endereço completo de uma ficha do C.R.I.S.", "INVALID_URL");
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
    throw new CrisLinkError("O link não está no formato de uma ficha de agente (/agente/...).", "INVALID_PATH");
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

  return { id, url: `https://crisordemparanormal.com/agente/${id}` };
}

export interface LinkConnectionResult {
  link: CrisLink;
  sheet: CharacterSheet;
  state: "CONNECTED";
  dataRead: true;
  message: string;
}

/** Monta a URL REST pública do documento Firestore associado à ficha. */
export function buildFirestoreDocumentUrl(characterId: string): string {
  const path =
    `/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${FIRESTORE_COLLECTION}/${encodeURIComponent(characterId)}`;
  const url = new URL(path, "https://firestore.googleapis.com");
  url.searchParams.set("key", CRIS_PUBLIC_FIREBASE_API_KEY);
  return url.href;
}

/**
 * Lê a ficha pública diretamente do Firestore utilizado pelo C.R.I.S.
 * Faz somente GET; não altera fichas, não usa cookies/sessões e não contorna
 * regras de leitura. O caminho é observado em integrações públicas existentes,
 * não uma API oficial documentada/garantida pelo C.R.I.S.
 */
export async function connectCrisLink(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<LinkConnectionResult> {
  const link = validateCrisUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(buildFirestoreDocumentUrl(link.id), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 404) {
      throw new CrisLinkError("Ficha não encontrada, removida ou indisponível para consulta pública.", "DOCUMENT_NOT_FOUND");
    }
    if (response.status === 401 || response.status === 403) {
      throw new CrisLinkError("O C.R.I.S. negou a leitura desta ficha. Ela pode ser privada ou exigir uma permissão que a extensão não possui.", "ACCESS_DENIED");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new CrisLinkError("O serviço do C.R.I.S. está temporariamente indisponível. Tente novamente em instantes.", "REMOTE_UNAVAILABLE");
    }
    if (!response.ok) {
      throw new CrisLinkError("O C.R.I.S. recusou a consulta desta ficha. Verifique o link e tente novamente.", "REMOTE_UNAVAILABLE");
    }

    let document: unknown;
    try {
      document = await response.json() as unknown;
    } catch {
      throw new CrisLinkError("O C.R.I.S. retornou uma resposta que não pôde ser interpretada.", "INVALID_RESPONSE");
    }

    let sheet: CharacterSheet;
    try {
      sheet = parseFirestoreCharacterDocument(document, link.id, link.url, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("marcada como privada")) {
        throw new CrisLinkError(message, "PRIVATE_SHEET");
      }
      throw new CrisLinkError(
        message || "A estrutura dos dados desta ficha não é compatível com a extensão.",
        "INVALID_RESPONSE",
      );
    }

    return {
      link,
      sheet,
      state: "CONNECTED",
      dataRead: true,
      message: `Ficha de ${sheet.identity.name} encontrada. Dados importados automaticamente do C.R.I.S.`,
    };
  } catch (error) {
    if (error instanceof CrisLinkError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") {
      throw new CrisLinkError("A consulta ao C.R.I.S. excedeu o tempo limite. Tente atualizar novamente.", "TIMEOUT");
    }
    throw new CrisLinkError(
      "Não foi possível acessar o Firestore do C.R.I.S. Verifique sua conexão; o navegador também pode estar bloqueando a consulta por CORS.",
      "NETWORK_OR_CORS",
    );
  } finally {
    clearTimeout(timeout);
  }
}
