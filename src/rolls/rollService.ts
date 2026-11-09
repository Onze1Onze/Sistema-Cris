import type { AttributeKey, CharacterSheet, SkillEntry } from "../cris/crisTypes";
import type { RollRequest, RollResult, RollType } from "./rollTypes";
import { rollD20Test } from "./rollEngine";

export const ROLL_CHANNEL = "com.onze1onze.sistema-cris/rolls";

const SKILL_ATTRIBUTE: Record<string, AttributeKey> = {
  acrobacia: "AGI",
  adestramento: "PRE",
  artes: "PRE",
  atletismo: "FOR",
  atualidades: "INT",
  ciencias: "INT",
  "ciências": "INT",
  crime: "AGI",
  diplomacia: "PRE",
  enganacao: "PRE",
  "enganação": "PRE",
  fortitude: "VIG",
  furtividade: "AGI",
  iniciativa: "AGI",
  intimidacao: "PRE",
  "intimidação": "PRE",
  intuicao: "PRE",
  "intuição": "PRE",
  investigacao: "INT",
  "investigação": "INT",
  luta: "FOR",
  medicina: "INT",
  ocultismo: "INT",
  percepcao: "PRE",
  "percepção": "PRE",
  pilotagem: "AGI",
  pontaria: "AGI",
  profissao: "INT",
  "profissão": "INT",
  reflexos: "AGI",
  religiao: "PRE",
  "religião": "PRE",
  sobrevivencia: "INT",
  "sobrevivência": "INT",
  tatica: "INT",
  "tática": "INT",
  tecnologia: "INT",
  vontade: "PRE",
};

function normalizeSkillName(name: string): string {
  return name.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function getSkillAttribute(skill: SkillEntry): AttributeKey | undefined {
  if (skill.attribute) return skill.attribute;
  return SKILL_ATTRIBUTE[normalizeSkillName(skill.name)];
}

function numericBonus(value: SkillEntry["bonus"]): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.trim().match(/^([+-]?\d+)$/);
    if (match) return Number(match[1]);
  }
  return 0;
}

export function buildAttributeRollRequest(
  sheet: CharacterSheet,
  attribute: AttributeKey,
  tokenId?: string,
  difficulty?: number,
  modifiers: RollRequest["modifiers"] = [],
): RollRequest {
  const attributeValue = sheet.attributes?.[attribute];
  if (attributeValue === undefined) throw new Error(`O atributo ${attribute} não está disponível na ficha.`);
  return {
    id: createRollId(),
    characterId: sheet.id,
    characterName: sheet.identity.name,
    tokenId,
    type: "ATTRIBUTE",
    label: attributeLabel(attribute),
    attribute,
    attributeValue,
    skillBonus: 0,
    modifiers,
    ...(difficulty !== undefined ? { difficulty } : {}),
    createdAt: Date.now(),
  };
}

export function buildSkillRollRequest(
  sheet: CharacterSheet,
  skill: SkillEntry,
  tokenId?: string,
  difficulty?: number,
  modifiers: RollRequest["modifiers"] = [],
): RollRequest {
  const attribute = getSkillAttribute(skill);
  if (!attribute) throw new Error(`Não foi possível identificar o atributo-base de ${skill.name}. A rolagem foi bloqueada para evitar um cálculo incorreto.`);
  const attributeValue = sheet.attributes?.[attribute];
  if (attributeValue === undefined) throw new Error(`O atributo ${attribute} necessário para ${skill.name} não está disponível na ficha.`);

  return {
    id: createRollId(),
    characterId: sheet.id,
    characterName: sheet.identity.name,
    tokenId,
    type: "SKILL",
    label: skill.name,
    attribute,
    attributeValue,
    skillBonus: numericBonus(skill.bonus),
    modifiers,
    ...(difficulty !== undefined ? { difficulty } : {}),
    createdAt: Date.now(),
  };
}

export function createRollId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `roll-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function performRoll(request: RollRequest, rollerName: string): RollResult {
  return rollD20Test(request, rollerName);
}

export function attributeLabel(attribute: AttributeKey): string {
  return ({ AGI: "Agilidade", FOR: "Força", INT: "Intelecto", PRE: "Presença", VIG: "Vigor" })[attribute];
}

export function rollFormula(result: RollResult): string {
  const base = result.attributeValue === 0 ? "2d20 (menor)" : `${result.attributeValue}d20 (maior)`;
  const modifiers = [result.skillBonus, ...result.modifiers.map((item) => item.value)].filter((value) => value !== 0);
  const bonus = modifiers.reduce((sum, value) => sum + value, 0);
  return bonus === 0 ? base : `${base} ${bonus >= 0 ? "+" : "−"} ${Math.abs(bonus)}`;
}

export function formatRollSummary(result: RollResult): string {
  const dice = result.dice.join(", ");
  const status = result.outcome === "SUCCESS" ? "SUCESSO" : result.outcome === "FAILURE" ? "FALHA" : "SEM DT";
  const dt = result.difficulty !== undefined ? ` · DT ${result.difficulty}` : "";
  const bonus = result.totalBonus >= 0 ? `+ ${result.totalBonus}` : `− ${Math.abs(result.totalBonus)}`;
  return `${result.characterName} — ${result.label}: [${dice}] → ${result.chosenDie} ${bonus} = ${result.total}${dt} · ${status}`;
}

export type { RollRequest, RollResult, RollType };
