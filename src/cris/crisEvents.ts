/**
 * Não foi localizada documentação oficial do C.R.I.S. para WebSocket, webhook
 * ou feed de alterações. A única estratégia ativa no Sistema C.R.I.S. é
 * consultar novamente o documento público de leitura enquanto o dossiê está
 * aberto e visível.
 */
export const CRIS_EVENT_CAPABILITIES = {
  officialWebSocket: false,
  officialWebhook: false,
  officialChangeFeed: false,
  pollingSupported: true,
  pollingIntervalMs: 15_000,
} as const;

export type CrisEventTransport = "OFFICIAL_WEBSOCKET" | "OFFICIAL_WEBHOOK" | "POLLING";

export function getCrisEventTransport(): CrisEventTransport {
  return "POLLING";
}
