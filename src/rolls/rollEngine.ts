import type { RollRequest, RollResult } from "./rollTypes";

/**
 * Ordem Paranormal RPG 1.2:
 * - role um d20 por ponto do atributo-base e escolha o maior;
 * - se o atributo for 0, role 2d20 e escolha o menor;
 * - some o bônus da perícia e modificadores declarados.
 *
 * Não aplica regras de ataque, dano, crítico ou habilidades que ainda não foram
 * explicitamente modeladas na ficha.
 */
function secureD20(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const limit = Math.floor(0x1_0000_0000 / 20) * 20;
    const buffer = new Uint32Array(1);
    do {
      crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return (buffer[0] % 20) + 1;
  }
  return Math.floor(Math.random() * 20) + 1;
}

export function rollD20Test(
  request: RollRequest,
  rollerName: string,
  random?: () => number,
  completedAt = Date.now(),
): RollResult {
  if (!Number.isInteger(request.attributeValue) || request.attributeValue < 0) {
    throw new Error("O atributo-base precisa ser um inteiro igual ou maior que zero.");
  }
  if (!Number.isFinite(request.skillBonus) || request.modifiers.some((modifier) => !Number.isFinite(modifier.value))) {
    throw new Error("O bônus ou modificador informado não é válido.");
  }
  if (request.difficulty !== undefined && (!Number.isInteger(request.difficulty) || request.difficulty < 0)) {
    throw new Error("A DT precisa ser um número inteiro igual ou maior que zero.");
  }

  const attribute = Math.trunc(request.attributeValue);
  const diceCount = attribute === 0 ? 2 : attribute;
  const dice = Array.from({ length: diceCount }, () => {
    if (!random) return secureD20();
    const raw = random();
    if (!Number.isFinite(raw) || raw < 0 || raw >= 1) {
      throw new Error("O gerador de dados retornou um valor inválido.");
    }
    return Math.floor(raw * 20) + 1;
  });

  const chosenDie = attribute === 0 ? Math.min(...dice) : Math.max(...dice);
  const totalBonus = request.skillBonus + request.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
  const total = chosenDie + totalBonus;

  return {
    ...request,
    dice,
    chosenDie,
    totalBonus,
    total,
    ...(request.difficulty !== undefined
      ? { outcome: total >= request.difficulty ? "SUCCESS" as const : "FAILURE" as const }
      : {}),
    completedAt,
    rollerName,
  };
}
