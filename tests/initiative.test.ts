import { describe, expect, it } from "vitest";
import type { InitiativeEntry } from "../src/initiative/initiativeEngine";
import {
  advanceInitiativeTurn,
  buildInitiativeEntries,
  findInitiativeTies,
  getInitiativeProfile,
  isInitiativeEligible,
  LEGACY_INITIATIVE_TOKEN_KEY,
  normalizeInitiativeCombatant,
  normalizeInitiativeScene,
  sortInitiativeEntries,
} from "../src/initiative/initiativeEngine";
import type { CharacterSheet } from "../src/cris/crisTypes";
import type { SceneItem } from "../src/owlbear/obr";

const profileSheet = (agi: number, bonus: number): CharacterSheet => ({
  schemaVersion: 1,
  id: "sheet-123",
  sourceUrl: "https://crisordemparanormal.com/agente/sheet-123",
  updatedAt: 1,
  identity: { name: "Agente de Teste" },
  attributes: { AGI: agi },
  skills: [{ name: "Iniciativa", bonus: bonus }],
});

const entry = (id: string, initiative: number, addedAt = 1, surprised = false, availableFromRound = 1): InitiativeEntry => ({
  id,
  groupId: id,
  name: id,
  combatant: normalizeInitiativeCombatant({
    role: "AGENT", groupId: id, displayName: id, initiative,
    roll: { dice: [initiative], selected: initiative, keep: "highest", bonus: 0, total: initiative, completedAt: 1, rollerName: "Mestre", formula: "1d20" },
    addedAt, surprised, availableFromRound,
  }),
  members: [],
  tokenIds: [id],
  conditions: [],
});

describe("integração da iniciativa com dados do C.R.I.S.", () => {
  it("usa o bônus total da perícia Iniciativa sem somar treinamento novamente", () => {
    expect(getInitiativeProfile(profileSheet(3, 12))).toMatchObject({
      attribute: "AGI",
      attributeValue: 3,
      bonus: 12,
      skill: { name: "Iniciativa", bonus: 12 },
    });
  });

  it("bloqueia perfil sem perícia Iniciativa em vez de adivinhar o modificador", () => {
    expect(() => getInitiativeProfile({
      ...profileSheet(2, 5),
      skills: [{ name: "Furtividade", bonus: 5 }],
    })).toThrow(/não contém a perícia Iniciativa/i);
  });

  it("bloqueia atributo-base diferente de Agilidade", () => {
    expect(() => getInitiativeProfile({
      ...profileSheet(2, 5),
      skills: [{ name: "Iniciativa", attribute: "FOR", bonus: 5 }],
    })).toThrow(/associada à Agilidade/i);
  });

  it("lê participantes da antiga extensão e converte o bônus manual sem reutilizar AGI/treinamento antigos", () => {
    const legacyToken = {
      id: "legacy-token",
      type: "IMAGE",
      layer: "CHARACTER",
      metadata: {
        [LEGACY_INITIATIVE_TOKEN_KEY]: {
          role: "AGENT",
          displayName: "Agente legado",
          groupId: "legacy-token",
          agility: 5,
          training: 15,
          bonus: 2,
          initiative: 18,
          roll: { dice: [16], selected: 16, keep: "highest", bonus: 2, total: 18 },
        },
      },
    } as unknown as SceneItem;
    const entries = buildInitiativeEntries([legacyToken], () => undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0].combatant.modifier).toBe(2);
    expect(entries[0].combatant.initiative).toBe(18);
    expect(entries[0].combatant.roll?.total).toBe(18);
    expect(entries[0].initiativeError).toMatch(/ficha C.R.I.S./i);
  });

  it("normaliza e limita os modificadores independentes da ficha", () => {
    const actor = normalizeInitiativeCombatant({ modifier: 4, threatBonus: 500, initiative: 17 });
    expect(actor.modifier).toBe(4);
    expect(actor.threatBonus).toBe(99);
    expect(actor.initiative).toBe(17);
  });

  it("preserva regras de surpresa e entrada tardia", () => {
    const surprised = entry("surprised", 20, 1, true);
    const late = entry("late", 15, 2, false, 3);
    expect(isInitiativeEligible(surprised, 1)).toBe(false);
    expect(isInitiativeEligible(surprised, 2)).toBe(true);
    expect(isInitiativeEligible(late, 2)).toBe(false);
    expect(isInitiativeEligible(late, 3)).toBe(true);
  });

  it("ordena em ordem decrescente e identifica empates com testes válidos", () => {
    const entries = [entry("a", 12, 1), entry("b", 19, 2), entry("c", 12, 3)];
    expect(sortInitiativeEntries(entries).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(findInitiativeTies(entries).map((group) => group.map((item) => item.id))).toEqual([["a", "c"]]);
  });

  it("avança para a próxima rodada quando todos os restantes estão impedidos", () => {
    const entries = [entry("surprised", 20, 1, true), entry("normal", 10)];
    const first = advanceInitiativeTurn(entries, { started: true, round: 1, activeId: "normal", changedAt: 1 }, 1, 2);
    expect(first).toMatchObject({ started: true, round: 2, activeId: "surprised" });
  });

  it("normaliza estado de cena inválido", () => {
    expect(normalizeInitiativeScene({ round: -10 })).toMatchObject({ round: 1, started: false, activeId: null });
  });
});
