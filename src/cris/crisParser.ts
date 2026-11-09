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


/**
 * Decodifica os valores tipados da API REST do Cloud Firestore.
 * O formato é o documento público retornado pela coleção characters/{id}.
 */
function decodeFirestoreValue(value: unknown): unknown {
  const wrapped = record(value);
  if (!wrapped) return value;

  if (Object.prototype.hasOwnProperty.call(wrapped, "stringValue")) return wrapped.stringValue;
  if (Object.prototype.hasOwnProperty.call(wrapped, "integerValue")) return numeric(wrapped.integerValue) ?? 0;
  if (Object.prototype.hasOwnProperty.call(wrapped, "doubleValue")) return numeric(wrapped.doubleValue) ?? 0;
  if (Object.prototype.hasOwnProperty.call(wrapped, "booleanValue")) return wrapped.booleanValue === true;
  if (Object.prototype.hasOwnProperty.call(wrapped, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(wrapped, "timestampValue")) return wrapped.timestampValue;
  if (Object.prototype.hasOwnProperty.call(wrapped, "referenceValue")) return wrapped.referenceValue;
  if (Object.prototype.hasOwnProperty.call(wrapped, "bytesValue")) return wrapped.bytesValue;
  if (Object.prototype.hasOwnProperty.call(wrapped, "geoPointValue")) return wrapped.geoPointValue;

  if (Object.prototype.hasOwnProperty.call(wrapped, "mapValue")) {
    const mapValue = record(wrapped.mapValue);
    const fields = record(mapValue?.fields);
    if (!fields) return {};
    return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  }

  if (Object.prototype.hasOwnProperty.call(wrapped, "arrayValue")) {
    const arrayValue = record(wrapped.arrayValue);
    const values = arrayValue?.values;
    return Array.isArray(values) ? values.map(decodeFirestoreValue) : [];
  }

  return value;
}

function decodeFirestoreFields(value: unknown): Record<string, unknown> {
  const fields = record(value);
  if (!fields) return {};
  return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, decodeFirestoreValue(item)]));
}

function firestoreText(value: unknown, max = 8000): string | undefined {
  if (typeof value === "string") return text(value, max);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function stripHtml(value: unknown): string | undefined {
  const source = firestoreText(value, 12000);
  if (!source) return undefined;
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000) || undefined;
}

function listOfRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((item): item is Record<string, unknown> => Boolean(item));
}

function textList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const result = value.map((item) => firestoreText(item, 240)).filter((item): item is string => Boolean(item));
    return result.length ? result : undefined;
  }
  const single = firestoreText(value, 2000);
  if (!single) return undefined;
  const parts = single.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
  return parts.length ? parts : [single];
}

function safeImageUrl(value: unknown): string | undefined {
  const candidate = firestoreText(value, 2000);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Converte uma ficha real do Firestore do C.R.I.S. para o modelo da extensão.
 * O ID utilizado sempre vem do link validado, não de campos remotos.
 */
export function parseFirestoreCharacterDocument(
  document: unknown,
  fallbackId: string,
  sourceUrl: string,
  now = Date.now(),
): CharacterSheet {
  const documentRecord = record(document);
  if (!documentRecord) throw new Error("O C.R.I.S. retornou uma resposta inválida.");

  const fields = decodeFirestoreFields(documentRecord.fields);
  if (fields.private === true) {
    throw new Error("Esta ficha está marcada como privada no C.R.I.S. e não pode ser consultada pela extensão.");
  }

  const name = firestoreText(fields.name, 120);
  if (!name) {
    throw new Error("A resposta do C.R.I.S. não contém os dados esperados de uma ficha de agente.");
  }

  const rawAttributes = record(fields.attributes) ?? {};
  const attributes: NonNullable<CharacterSheet["attributes"]> = {};
  const attributeMap: Array<[AttributeKey, string]> = [
    ["AGI", "dex"], ["FOR", "str"], ["INT", "int"], ["PRE", "pre"], ["VIG", "con"],
  ];
  for (const [target, source] of attributeMap) {
    const value = numeric(rawAttributes[source]);
    if (value !== undefined) attributes[target] = value;
  }

  const resources = parseResources({
    pv: { current: fields.currentPv, max: fields.maxPv },
    pe: { current: fields.currentPe, max: fields.maxPe },
    san: { current: fields.currentSan, max: fields.maxSan },
  });

  const skills = listOfRecords(fields.skills).map((skill): SkillEntry => {
    const degree = numeric(skill.trainingDegree);
    const extra = numeric(skill.otherBonus) ?? 0;
    const total = numeric(skill.bonus) ?? numeric(skill.totalBonus) ?? ((degree ?? 0) + extra);
    const attribute = firestoreText(skill.attribute, 20)?.toUpperCase() as AttributeKey | undefined;
    return {
      name: firestoreText(skill.name, 120) ?? "Perícia sem nome",
      ...(attribute && ATTRIBUTE_KEYS.includes(attribute) ? { attribute } : {}),
      bonus: total,
      ...(degree !== undefined ? { training: `Grau de treinamento ${degree}` } : {}),
      ...(stripHtml(skill.description) ? { notes: stripHtml(skill.description) } : {}),
    };
  });

  const attacks = listOfRecords(fields.attacks).map((attack): AttackEntry => {
    const attackBonus = numeric(attack.attackBonus);
    const skillUsed = firestoreText(attack.skillUsed, 80);
    const criticalRange = firestoreText(attack.criticalRange, 20);
    const criticalMultiplier = firestoreText(attack.criticalMult, 20);
    const damageType = firestoreText(attack.damageType, 80);
    const details = [damageType, stripHtml(attack.description)].filter(Boolean).join(" · ");
    return {
      name: firestoreText(attack.name, 120) ?? "Ataque sem nome",
      ...(skillUsed || attackBonus !== undefined
        ? { test: [skillUsed, attackBonus !== undefined ? (attackBonus >= 0 ? `+${attackBonus}` : String(attackBonus)) : undefined].filter(Boolean).join(" ") }
        : {}),
      ...(firestoreText(attack.damage, 100) ? { damage: firestoreText(attack.damage, 100) } : {}),
      ...(criticalRange || criticalMultiplier
        ? { critical: [criticalRange, criticalMultiplier ? `x${criticalMultiplier}` : undefined].filter(Boolean).join("/") }
        : {}),
      ...(firestoreText(attack.range, 80) ? { range: firestoreText(attack.range, 80) } : {}),
      ...(details ? { effects: details } : {}),
    };
  });

  const inventory = listOfRecords(fields.inventory).map((item): InventoryEntry => {
    const itemType = firestoreText(item.itemType, 60);
    const tag = firestoreText(item.tag, 80);
    const category = tag ?? firestoreText(item.category, 80)
      ?? (itemType === "protection" ? "Proteção" : itemType === "weapon" ? "Arma" : "Equipamento");
    const slots = numeric(item.slots);
    const quantity = numeric(item.quantity);
    const detail = [stripHtml(item.description), stripHtml(item.detail)].filter(Boolean).join(" · ");
    return {
      name: firestoreText(item.name, 120) ?? "Item sem nome",
      ...(category ? { category } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(slots !== undefined ? { weight: `${slots} espaço(s)` } : {}),
      ...(detail ? { detail } : {}),
    };
  });

  const abilities = listOfRecords(fields.powers).map((power): AbilityEntry => ({
    name: firestoreText(power.name, 120) ?? "Habilidade sem nome",
    ...(firestoreText(power.category, 80) ? { category: firestoreText(power.category, 80) } : {}),
    ...(stripHtml(power.description) ? { detail: stripHtml(power.description) } : {}),
  }));

  const rituals = listOfRecords(fields.rituals).map((ritual): AbilityEntry => {
    const extras = [
      firestoreText(ritual.circle, 40) ? `Círculo ${firestoreText(ritual.circle, 40)}` : undefined,
      firestoreText(ritual.cost, 40) ? `Custo ${firestoreText(ritual.cost, 40)}` : undefined,
      stripHtml(ritual.description),
    ].filter(Boolean);
    return {
      name: firestoreText(ritual.name, 120) ?? "Ritual sem nome",
      ...(firestoreText(ritual.category, 80) ? { category: firestoreText(ritual.category, 80) } : {}),
      ...(extras.length ? { detail: extras.join(" · ") } : {}),
    };
  });

  const defense = numeric(fields.defense)
    ?? 10 + (numeric(rawAttributes.dex) ?? 0) + (numeric(fields.protectionDefense) ?? 0) + (numeric(fields.bonusDefense) ?? 0);
  const movement = numeric(fields.movement);
  const resistances = textList(fields.resistances ?? fields.resistencias);
  const description = record(fields.description) ?? {};
  const appearance = stripHtml(description.physical);
  const descriptionParts = [
    stripHtml(description.history) ? `Histórico: ${stripHtml(description.history)}` : undefined,
    stripHtml(description.personal) ? `Personalidade: ${stripHtml(description.personal)}` : undefined,
    stripHtml(description.goal) ? `Objetivo: ${stripHtml(description.goal)}` : undefined,
    stripHtml(description.anotation) ? `Anotações: ${stripHtml(description.anotation)}` : undefined,
  ].filter(Boolean);

  const sheet: CharacterSheet = {
    schemaVersion: 1,
    id: fallbackId,
    sourceUrl,
    updatedAt: now,
    identity: {
      name,
      ...(firestoreText(fields.player, 120) ? { player: firestoreText(fields.player, 120) } : {}),
      ...(firestoreText(fields.backgroundName, 120) ? { origin: firestoreText(fields.backgroundName, 120) } : {}),
      ...(firestoreText(fields.className, 120) ? { className: firestoreText(fields.className, 120) } : {}),
      ...(firestoreText(fields.nex, 30) ? { nex: firestoreText(fields.nex, 30) } : {}),
      ...(firestoreText(fields.patent, 80) ? { rank: firestoreText(fields.patent, 80) } : {}),
      ...(firestoreText(fields.age, 40) ? { age: firestoreText(fields.age, 40) } : {}),
      ...(appearance ? { appearance } : {}),
      ...(descriptionParts.length ? { description: descriptionParts.join("\n\n") } : {}),
    },
    ...(safeImageUrl(fields.sheetPictureURL ?? fields.sheetPictureFullPath)
      ? { portraitUrl: safeImageUrl(fields.sheetPictureURL ?? fields.sheetPictureFullPath) }
      : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
    ...(resources ? { resources } : {}),
    ...(skills.length ? { skills } : {}),
    ...(inventory.length ? { inventory } : {}),
    ...(abilities.length ? { abilities } : {}),
    ...(rituals.length ? { rituals } : {}),
    combat: {
      defense,
      ...(numeric(fields.evade) !== undefined ? { dodge: numeric(fields.evade) } : {}),
      ...(numeric(fields.block) !== undefined ? { block: numeric(fields.block) } : {}),
      ...(movement !== undefined ? { movement: `${movement}m` } : {}),
      ...(numeric(fields.initiative) !== undefined ? { initiative: numeric(fields.initiative) } : {}),
      ...(resistances ? { resistances } : {}),
      ...(attacks.length ? { attacks } : {}),
    },
    additional: {
      ...(firestoreText(fields.statsClass, 80) ? { "Classe estatística": fields.statsClass } : {}),
      ...(firestoreText(fields.proficiencies, 2000) ? { "Proficiências": fields.proficiencies } : {}),
      ...(firestoreText(fields.currentProtection, 200) ? { "Proteção atual": fields.currentProtection } : {}),
      ...(numeric(fields.currentLoad) !== undefined ? { "Carga atual": numeric(fields.currentLoad) } : {}),
      ...(numeric(fields.maxLoad) !== undefined ? { "Carga máxima": numeric(fields.maxLoad) } : {}),
      ...(numeric(fields.ritualsDc) !== undefined ? { "DT de rituais": numeric(fields.ritualsDc) } : {}),
      ...(firestoreText(fields.creditsLimit, 80) ? { "Limite de créditos": fields.creditsLimit } : {}),
      ...(fields.deathMode === true ? { "Modo de morte": true } : {}),
      ...(fields.madnessMode === true ? { "Modo de loucura": true } : {}),
      ...(fields.isSobrevivendoAoHorror === true ? { "Sobrevivendo ao Horror": true } : {}),
      ...(fields.isPdOn === true || fields.pdMode === true ? { "Determinação ativada": true } : {}),
      ...(numeric(fields.currentPd) !== undefined ? { "Determinação atual": numeric(fields.currentPd) } : {}),
      ...(numeric(fields.maxPd) !== undefined ? { "Determinação máxima": numeric(fields.maxPd) } : {}),
      ...(Array.isArray(fields.deathMarks) ? { "Marcas de morte": fields.deathMarks } : {}),
      ...(Array.isArray(fields.madnessMarks) ? { "Marcas de loucura": fields.madnessMarks } : {}),
      ...(Array.isArray(fields.pdMarks) ? { "Marcas de determinação": fields.pdMarks } : {}),
      ...(textList(fields.imunidades) ? { "Imunidades": textList(fields.imunidades) } : {}),
      ...(textList(fields.vulnerabilidades) ? { "Vulnerabilidades": textList(fields.vulnerabilidades) } : {}),
    },
  };

  return sheet;
}
