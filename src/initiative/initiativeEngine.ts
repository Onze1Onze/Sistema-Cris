import type { CharacterSheet, AttributeKey, SkillEntry } from "../cris/crisTypes";
import type { SceneItem } from "../owlbear/obr";
import { getSkillAttribute } from "../rolls/rollService";

export const INITIATIVE_TOKEN_KEY = "com.onze1onze.sistema-cris/initiative-combatant";
export const INITIATIVE_SCENE_KEY = "com.onze1onze.sistema-cris/initiative-scene";
export const LEGACY_INITIATIVE_TOKEN_KEY = "com.onze1onze.sistema-iniciativa/combatant";
export const LEGACY_INITIATIVE_SCENE_KEY = "com.onze1onze.sistema-iniciativa/combat";

export type InitiativeRole = "AGENT" | "THREAT";
export type InitiativeKeep = "highest" | "lowest";

export interface InitiativeRollSnapshot {
  dice: number[];
  selected: number;
  keep: InitiativeKeep;
  bonus: number;
  total: number;
  completedAt: number;
  rollerName: string;
  formula: string;
}

export interface InitiativeCombatant {
  version: 1;
  role: InitiativeRole;
  groupId: string;
  groupName: string;
  displayName: string;
  modifier: number;
  threatBonus: number;
  initiative: number | null;
  roll: InitiativeRollSnapshot | null;
  surprised: boolean;
  availableFromRound: number;
  conditions: string[];
  note: string;
  addedAt: number;
}

export interface InitiativeSceneState {
  started: boolean;
  round: number;
  activeId: string | null;
  changedAt: number;
}

export interface InitiativeProfile {
  skill: SkillEntry;
  attribute: AttributeKey;
  attributeValue: number;
  bonus: number;
}

export interface InitiativeEntry {
  id: string;
  groupId: string;
  name: string;
  combatant: InitiativeCombatant;
  members: SceneItem[];
  tokenIds: string[];
  sheet?: CharacterSheet;
  profile?: InitiativeProfile;
  threatProfile?: InitiativeProfile;
  derivedThreatBonus?: number;
  conditions: string[];
  initiativeError?: string;
}

export interface InitiativeTokenMetadata {
  version: 1;
  combatant: InitiativeCombatant;
}

export const DEFAULT_INITIATIVE_SCENE: InitiativeSceneState = Object.freeze({
  started: false,
  round: 1,
  activeId: null,
  changedAt: 0,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? clamp(parsed, min, max) : fallback;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function normalizeRoll(value: unknown): InitiativeRollSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<InitiativeRollSnapshot>;
  if (!Array.isArray(row.dice) || !row.dice.length) return null;
  const dice = row.dice.map((die) => finiteInteger(die, 1, 1, 20)).slice(0, 24);
  const selected = finiteInteger(row.selected, dice[0], 1, 20);
  const total = Number(row.total);
  if (!Number.isFinite(total)) return null;
  return {
    dice,
    selected,
    keep: row.keep === "lowest" ? "lowest" : "highest",
    bonus: finiteNumber(row.bonus, 0, -999, 999),
    total,
    completedAt: finiteNumber(row.completedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    rollerName: String(row.rollerName ?? "Mestre").slice(0, 80),
    formula: String(row.formula ?? "").slice(0, 240),
  };
}

export function normalizeInitiativeCombatant(value: unknown): InitiativeCombatant {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const role: InitiativeRole = row.role === "THREAT" ? "THREAT" : "AGENT";
  const initiativeValue = row.initiative === null || row.initiative === undefined || row.initiative === ""
    ? null
    : Number(row.initiative);
  return {
    version: 1,
    role,
    groupId: String(row.groupId ?? "").slice(0, 100),
    groupName: String(row.groupName ?? "").trim().slice(0, 80),
    displayName: String(row.displayName ?? "").trim().slice(0, 120),
    modifier: finiteNumber(row.modifier, 0, -99, 99),
    threatBonus: finiteNumber(row.threatBonus, 0, -99, 99),
    initiative: initiativeValue !== null && Number.isFinite(initiativeValue)
      ? clamp(initiativeValue, -999, 9999)
      : null,
    roll: normalizeRoll(row.roll),
    surprised: row.surprised === true,
    availableFromRound: finiteInteger(row.availableFromRound, 1, 1, 99999),
    conditions: Array.isArray(row.conditions)
      ? row.conditions.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
      : [],
    note: String(row.note ?? "").slice(0, 500),
    addedAt: finiteNumber(row.addedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function normalizeInitiativeScene(value: unknown): InitiativeSceneState {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    started: row.started === true,
    round: finiteInteger(row.round, 1, 1, 99999),
    activeId: typeof row.activeId === "string" ? row.activeId : null,
    changedAt: finiteNumber(row.changedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function readInitiativeCombatant(item: SceneItem | undefined): InitiativeCombatant | undefined {
  const current = item?.metadata?.[INITIATIVE_TOKEN_KEY] as Partial<InitiativeTokenMetadata> | undefined;
  if (current?.version === 1 && current.combatant && typeof current.combatant === "object") {
    return normalizeInitiativeCombatant(current.combatant);
  }

  // Compatibilidade com o namespace da extensão Sistema-Iniciativa anterior.
  // Os campos antigos de AGI/treinamento nunca substituem os dados da ficha C.R.I.S.
  const legacy = item?.metadata?.[LEGACY_INITIATIVE_TOKEN_KEY];
  if (!legacy || typeof legacy !== "object") return undefined;
  const value = legacy as Record<string, unknown>;
  return normalizeInitiativeCombatant({
    ...value,
    modifier: value.modifier ?? value.bonus ?? 0,
    threatBonus: value.threatBonus ?? 0,
  });
}

function normalizeSkillName(name: string): string {
  return name.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function numberFromBonus(value: SkillEntry["bonus"]): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

/** Usa exatamente a perícia Iniciativa e o bônus total já normalizado pelo C.R.I.S. */
export function getInitiativeProfile(sheet: CharacterSheet): InitiativeProfile {
  const skill = (sheet.skills ?? []).find((entry) => normalizeSkillName(entry.name) === "iniciativa");
  if (!skill) {
    throw new Error("A ficha não contém a perícia Iniciativa. Atualize a ficha no C.R.I.S. ou vincule a ficha correta.");
  }
  const attribute = getSkillAttribute(skill);
  if (!attribute) throw new Error("O C.R.I.S. não identificou o atributo-base da perícia Iniciativa.");
  if (attribute !== "AGI") {
    throw new Error("A perícia Iniciativa desta ficha não está associada à Agilidade. O teste foi bloqueado.");
  }
  const attributeValue = sheet.attributes?.AGI;
  if (!Number.isInteger(attributeValue) || attributeValue === undefined || attributeValue < 0) {
    throw new Error("A Agilidade não está disponível ou é inválida na ficha vinculada.");
  }
  const bonus = numberFromBonus(skill.bonus);
  if (bonus === undefined) {
    throw new Error("O bônus total da perícia Iniciativa não é numérico. Verifique a ficha no C.R.I.S.");
  }
  return { skill, attribute, attributeValue, bonus };
}

export function buildInitiativeEntries(
  items: SceneItem[],
  resolveSheet: (item: SceneItem) => CharacterSheet | undefined,
): InitiativeEntry[] {
  const groups = new Map<string, InitiativeEntry>();
  for (const item of items) {
    if (item.type !== "IMAGE" || item.layer !== "CHARACTER") continue;
    const combatant = readInitiativeCombatant(item);
    if (!combatant) continue;
    const groupId = combatant.role === "THREAT" ? combatant.groupId || item.id : item.id;
    const id = groupId;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        groupId,
        name: combatant.displayName || item.name || "Envolvido",
        combatant: { ...combatant, groupId },
        members: [],
        tokenIds: [],
        conditions: [],
      });
    }
    const entry = groups.get(id)!;
    entry.members.push(item);
    entry.tokenIds.push(item.id);
    if (!entry.combatant.displayName && item.name) entry.name = item.name;
  }

  for (const entry of groups.values()) {
    const sheets = entry.members.map(resolveSheet);
    const validSheets = sheets.filter((sheet): sheet is CharacterSheet => Boolean(sheet));
    entry.conditions = [
      ...new Set([
        ...entry.combatant.conditions,
        ...validSheets.flatMap((sheet) => (sheet.conditions ?? []).map((condition) => condition.name)),
      ]),
    ].slice(0, 20);

    if (entry.combatant.role === "AGENT") {
      entry.sheet = sheets[0];
      if (!entry.sheet) {
        entry.initiativeError = "Token sem ficha C.R.I.S. compartilhada ou disponível no cache do Mestre.";
        continue;
      }
      try {
        entry.profile = getInitiativeProfile(entry.sheet);
      } catch (error) {
        entry.initiativeError = error instanceof Error ? error.message : "Não foi possível ler a perícia Iniciativa.";
      }
    } else {
      if (sheets.length && sheets.every((sheet): sheet is CharacterSheet => Boolean(sheet))) {
        try {
          const profiles = sheets.map((sheet) => getInitiativeProfile(sheet));
          entry.derivedThreatBonus = Math.min(...profiles.map((profile) => profile.bonus));
          entry.threatProfile = profiles[0];
        } catch {
          // Ameaças sem ficha completa usam o bônus definido pelo Mestre no registro do grupo.
        }
      }
    }
  }

  return sortInitiativeEntries([...groups.values()]);
}

export function effectiveThreatBonus(entry: InitiativeEntry): number {
  return entry.derivedThreatBonus ?? entry.combatant.threatBonus;
}

export function sortInitiativeEntries(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((left, right) => {
    const a = left.combatant.initiative ?? Number.NEGATIVE_INFINITY;
    const b = right.combatant.initiative ?? Number.NEGATIVE_INFINITY;
    if (a !== b) return b - a;
    if (left.combatant.addedAt !== right.combatant.addedAt) {
      return left.combatant.addedAt - right.combatant.addedAt;
    }
    return left.id.localeCompare(right.id, "pt-BR", { sensitivity: "base" });
  });
}

export function findInitiativeTies(entries: InitiativeEntry[]): InitiativeEntry[][] {
  const byScore = new Map<number, InitiativeEntry[]>();
  for (const entry of entries) {
    const score = entry.combatant.initiative;
    if (score === null || !entry.combatant.roll) continue;
    const group = byScore.get(score) ?? [];
    group.push(entry);
    byScore.set(score, group);
  }
  return [...byScore.values()].filter((group) => group.length > 1);
}

export function isInitiativeEligible(entry: InitiativeEntry, round: number): boolean {
  return entry.combatant.availableFromRound <= round
    && (!entry.combatant.surprised || round > 1);
}

export function eligibleInitiativeEntries(entries: InitiativeEntry[], round: number): InitiativeEntry[] {
  return sortInitiativeEntries(entries).filter((entry) => isInitiativeEligible(entry, round));
}

export function advanceInitiativeTurn(
  entries: InitiativeEntry[],
  sceneState: InitiativeSceneState,
  direction = 1,
  now = Date.now(),
): InitiativeSceneState {
  const state = normalizeInitiativeScene(sceneState);
  const ordered = sortInitiativeEntries(entries);
  if (!ordered.length) return { ...state, started: false, activeId: null, changedAt: now };
  const maxRound = Math.max(state.round + 2, ...ordered.map((entry) => entry.combatant.availableFromRound + 1));

  if (direction >= 0) {
    for (let round = state.round; round <= maxRound; round += 1) {
      const eligible = eligibleInitiativeEntries(ordered, round);
      if (!eligible.length) continue;
      const index = round === state.round ? eligible.findIndex((entry) => entry.id === state.activeId) : -1;
      const nextIndex = index < 0 ? 0 : index + 1;
      if (nextIndex < eligible.length) {
        return { started: true, round, activeId: eligible[nextIndex].id, changedAt: now };
      }
    }
  } else {
    for (let round = state.round; round >= 1; round -= 1) {
      const eligible = eligibleInitiativeEntries(ordered, round);
      if (!eligible.length) continue;
      const index = round === state.round ? eligible.findIndex((entry) => entry.id === state.activeId) : -1;
      const previousIndex = index < 0 ? eligible.length - 1 : index - 1;
      if (previousIndex >= 0) {
        return { started: true, round, activeId: eligible[previousIndex].id, changedAt: now };
      }
    }
  }
  return { ...state, changedAt: now };
}

export function selectInitiativeTurn(
  entries: InitiativeEntry[],
  sceneState: InitiativeSceneState,
  id: string,
  now = Date.now(),
): InitiativeSceneState {
  const state = normalizeInitiativeScene(sceneState);
  const entry = entries.find((candidate) => candidate.id === id);
  return !entry || !isInitiativeEligible(entry, state.round)
    ? state
    : { ...state, started: true, activeId: id, changedAt: now };
}

export function initiativeProgress(entries: InitiativeEntry[], sceneState: InitiativeSceneState): number {
  const state = normalizeInitiativeScene(sceneState);
  const eligible = eligibleInitiativeEntries(entries, state.round);
  if (!eligible.length || !state.activeId) return 0;
  const index = eligible.findIndex((entry) => entry.id === state.activeId);
  return index < 0 ? 0 : Math.round(((index + 1) / eligible.length) * 100);
}

export function createInitiativeRollSnapshot(
  dice: number[],
  selected: number,
  keep: InitiativeKeep,
  bonus: number,
  total: number,
  rollerName: string,
  formula: string,
  completedAt = Date.now(),
): InitiativeRollSnapshot {
  return { dice, selected, keep, bonus, total, rollerName, formula, completedAt };
}
