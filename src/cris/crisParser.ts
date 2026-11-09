import type {
  AbilityEntry,
  AttackEntry,
  AttributeKey,
  CharacterSheet,
  InventoryEntry,
  ResourceKey,
  SkillEntry,
} from "./crisTypes";

const MAX_JSON_LENGTH = 500_000;
const ATTRIBUTE_KEYS: AttributeKey[] = ["AGI", "FOR", "INT", "PRE", "VIG"];
const RESOURCE_KEYS: ResourceKey[] = ["pv", "pe", "san"];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, max = 8000): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseList<T>(value: unknown, parser: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(parser).filter((item): item is T => item !== undefined);
  return result;
}

function parseSkills(value: unknown): SkillEntry[] | undefined {
  return parseList(value, (item) => {
    const row = record(item);
    const name = text(row?.name, 100);
    if (!row || !name) return undefined;
    const attr = text(row.attribute, 3)?.toUpperCase() as AttributeKey | undefined;
    const bonus = numeric(row.bonus) ?? text(row.bonus, 30);
    return {
      name,
      ...(attr && ATTRIBUTE_KEYS.includes(attr) ? { attribute: attr } : {}),
      ...(bonus !== undefined ? { bonus } : {}),
      ...(text(row.training, 80) ? { training: text(row.training, 80) } : {}),
      ...(text(row.notes, 500) ? { notes: text(row.notes, 500) } : {}),
    };
  });
}

function parseAttacks(value: unknown): AttackEntry[] | undefined {
  return parseList(value, (item) => {
    const row = record(item);
    const name = text(row?.name, 120);
    if (!row || !name) return undefined;
    return {
      name,
      ...(text(row.test, 100) ? { test: text(row.test, 100) } : {}),
      ...(text(row.damage, 100) ? { damage: text(row.damage, 100) } : {}),
      ...(text(row.critical, 100) ? { critical: text(row.critical, 100) } : {}),
      ...(text(row.range, 100) ? { range: text(row.range, 100) } : {}),
      ...(text(row.effects, 1000) ? { effects: text(row.effects, 1000) } : {}),
    };
  });
}

function parseInventory(value: unknown): InventoryEntry[] | undefined {
  return parseList(value, (item) => {
    const row = record(item);
    const name = text(row?.name, 120);
    if (!row || !name) return undefined;
    const quantity = numeric(row.quantity);
    return {
      name,
      ...(text(row.category, 80) ? { category: text(row.category, 80) } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(text(row.weight, 60) ? { weight: text(row.weight, 60) } : {}),
      ...(text(row.detail, 1000) ? { detail: text(row.detail, 1000) } : {}),
    };
  });
}

function parseAbilities(value: unknown): AbilityEntry[] | undefined {
  return parseList(value, (item) => {
    const row = record(item);
    const name = text(row?.name, 120);
    if (!row || !name) return undefined;
    return {
      name,
      ...(text(row.category, 80) ? { category: text(row.category, 80) } : {}),
      ...(text(row.detail, 2000) ? { detail: text(row.detail, 2000) } : {}),
    };
  });
}

function parseResources(value: unknown): CharacterSheet["resources"] {
  const source = record(value);
  if (!source) return undefined;
  const result: NonNullable<CharacterSheet["resources"]> = {};
  for (const key of RESOURCE_KEYS) {
    const row = record(source[key]);
    const current = numeric(row?.current);
    const max = numeric(row?.max);
    if (current !== undefined && max !== undefined && max >= 0) {
      result[key] = { current, max };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

/** Interpreta somente o esquema normalizado documentado neste projeto. */
export function parseCharacterJson(raw: string, fallbackId: string, sourceUrl: string, now = Date.now()): CharacterSheet {
  if (raw.length > MAX_JSON_LENGTH) throw new Error("O arquivo JSON ultrapassa o limite de 500 KB.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("O conteúdo não é um JSON válido.");
  }

  const root = record(parsed);
  const identity = record(root?.identity);
  const name = text(identity?.name, 120);
  if (!root || !identity || !name) {
    throw new Error("A ficha precisa conter identity.name no formato de importação do Sistema C.R.I.S.");
  }

  const attributesSource = record(root.attributes);
  const attributes: NonNullable<CharacterSheet["attributes"]> = {};
  for (const key of ATTRIBUTE_KEYS) {
    const value = numeric(attributesSource?.[key]);
    if (value !== undefined) attributes[key] = value;
  }

  const combatSource = record(root.combat);
  const additional = record(root.additional);
  // O ID canônico vem da URL já validada; o JSON importado não pode trocar o vínculo.
  const sourceId = fallbackId;

  const sheet: CharacterSheet = {
    schemaVersion: 1,
    id: sourceId,
    sourceUrl,
    updatedAt: now,
    identity: {
      name,
      ...(text(identity.player, 120) ? { player: text(identity.player, 120) } : {}),
      ...(text(identity.origin, 120) ? { origin: text(identity.origin, 120) } : {}),
      ...(text(identity.className, 120) ? { className: text(identity.className, 120) } : {}),
      ...(text(identity.nex, 30) ? { nex: text(identity.nex, 30) } : {}),
      ...(text(identity.rank, 80) ? { rank: text(identity.rank, 80) } : {}),
      ...(text(identity.age, 40) ? { age: text(identity.age, 40) } : {}),
      ...(text(identity.appearance, 2000) ? { appearance: text(identity.appearance, 2000) } : {}),
      ...(text(identity.description, 4000) ? { description: text(identity.description, 4000) } : {}),
    },
  };

  const portrait = text(root.portraitUrl, 2000);
  if (portrait) {
    try {
      const portraitUrl = new URL(portrait);
      if (portraitUrl.protocol === "https:") sheet.portraitUrl = portraitUrl.href;
    } catch { /* URL de retrato inválida é descartada. */ }
  }
  if (Object.keys(attributes).length) sheet.attributes = attributes;
  const resources = parseResources(root.resources);
  if (resources) sheet.resources = resources;
  const skills = parseSkills(root.skills);
  if (skills) sheet.skills = skills;
  const inventory = parseInventory(root.inventory);
  if (inventory) sheet.inventory = inventory;
  const abilities = parseAbilities(root.abilities);
  if (abilities) sheet.abilities = abilities;
  const rituals = parseAbilities(root.rituals);
  if (rituals) sheet.rituals = rituals;

  if (combatSource) {
    const defense = numeric(combatSource.defense) ?? text(combatSource.defense, 40);
    const dodge = numeric(combatSource.dodge) ?? text(combatSource.dodge, 40);
    const block = numeric(combatSource.block) ?? text(combatSource.block, 40);
    const initiative = numeric(combatSource.initiative) ?? text(combatSource.initiative, 40);
    const resistances = parseList(combatSource.resistances, (item) => text(item, 200));
    const attacks = parseAttacks(combatSource.attacks);
    sheet.combat = {
      ...(defense !== undefined ? { defense } : {}),
      ...(dodge !== undefined ? { dodge } : {}),
      ...(block !== undefined ? { block } : {}),
      ...(text(combatSource.movement, 60) ? { movement: text(combatSource.movement, 60) } : {}),
      ...(initiative !== undefined ? { initiative } : {}),
      ...(resistances ? { resistances } : {}),
      ...(attacks ? { attacks } : {}),
    };
  }

  // Preserva campos adicionais somente sob a chave explícita `additional`.
  if (additional) sheet.additional = additional;
  return sheet;
}
