/**
 * Pré-verificação de concorrência para uma futura integração de escrita.
 * Não envia alterações. O valor remoto atual sempre vence uma colisão quando
 * ele mudou desde a leitura-base; nada é sobrescrito silenciosamente.
 */
export type ConflictCheck<T> =
  | { state: "SAFE_TO_WRITE"; base: T; proposed: T; remote: T }
  | { state: "ALREADY_APPLIED"; value: T }
  | { state: "CONFLICT"; base: T; proposed: T; remote: T };

function equalValue<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkConcurrentValue<T>(
  base: T,
  proposed: T,
  currentRemote: T,
): ConflictCheck<T> {
  if (equalValue(currentRemote, proposed)) {
    return { state: "ALREADY_APPLIED", value: currentRemote };
  }

  if (equalValue(currentRemote, base)) {
    return { state: "SAFE_TO_WRITE", base, proposed, remote: currentRemote };
  }

  return { state: "CONFLICT", base, proposed, remote: currentRemote };
}
