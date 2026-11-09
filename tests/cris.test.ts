import { describe, expect, it } from "vitest";
import { buildFirestoreDocumentUrl, connectCrisLink, CrisLinkError, validateCrisUrl } from "../src/cris/crisClient";
import { parseCharacterJson, parseFirestoreCharacterDocument } from "../src/cris/crisParser";
import { checkConcurrentValue } from "../src/cris/crisConflict";
import { CRIS_EVENT_CAPABILITIES, getCrisEventTransport } from "../src/cris/crisEvents";
import { reconcileRemoteSheet, diffResourceValues, isCrisNetworkFailure } from "../src/cris/crisSync";
import { CrisWriteUnavailableError, isCrisResourceWritable, writeResourceToCris } from "../src/cris/crisWrite";
import { rollD20Test } from "../src/rolls/rollEngine";
import { buildAttributeRollRequest, buildSkillRollRequest, getSkillAttribute } from "../src/rolls/rollService";
import type { CharacterSheet } from "../src/cris/crisTypes";
import type { RollRequest } from "../src/rolls/rollTypes";
import type { MasterRosterEntry } from "../src/master-panel/masterPanel";
import { matchesRosterFilter } from "../src/master-panel/rosterFilters";

const sampleUrl = "https://crisordemparanormal.com/agente/AbC123";

describe("validateCrisUrl", () => {
  it("aceita link HTTPS público no formato /agente/{id}", () => {
    expect(validateCrisUrl(`${sampleUrl}?utm_source=mesa#ficha`)).toEqual({
      id: "AbC123",
      url: sampleUrl,
    });
  });

  it("aceita o subdomínio www e barra final", () => {
    expect(validateCrisUrl("https://www.crisordemparanormal.com/agente/123456/").id).toBe("123456");
  });

  it("rejeita HTTP, hosts externos e rotas diferentes", () => {
    expect(() => validateCrisUrl("http://crisordemparanormal.com/agente/AbC123")).toThrow(CrisLinkError);
    expect(() => validateCrisUrl("https://user:pass@crisordemparanormal.com/agente/AbC123")).toThrow(CrisLinkError);
    expect(() => validateCrisUrl("https://example.com/agente/AbC123")).toThrow(CrisLinkError);
    expect(() => validateCrisUrl("https://crisordemparanormal.com/campanha/AbC123")).toThrow(CrisLinkError);
  });

  it("rejeita IDs malformados e segmentos extras", () => {
    expect(() => validateCrisUrl("https://crisordemparanormal.com/agente/a%2Fb123")).toThrow(CrisLinkError);
    expect(() => validateCrisUrl("https://crisordemparanormal.com/agente/AbC123/outro")).toThrow(CrisLinkError);
    expect(() => validateCrisUrl("https://crisordemparanormal.com/agente/%E0%A4%A")).toThrow(CrisLinkError);
  });
});

describe("parseCharacterJson", () => {
  it("normaliza identidade, atributos, recursos, perícias e inventário", () => {
    const sheet = parseCharacterJson(JSON.stringify({
      identity: { name: "Eleanor Hale", player: "Jogadora", className: "Especialista", nex: "35%" },
      attributes: { AGI: 3, FOR: 1, INT: 4, PRE: 2, VIG: 2, unknown: 99 },
      resources: { pv: { current: 21, max: 30 }, pe: { current: 8, max: 12 }, san: { current: 35, max: 40 } },
      skills: [{ name: "Investigação", attribute: "INT", bonus: 8 }],
      inventory: [{ name: "Kit médico", quantity: 2, category: "Equipamento" }],
      abilities: [{ name: "Perito", detail: "Bônus especial" }],
      rituals: [{ name: "Ouvir os Sussurros", category: "Conhecimento" }],
      combat: { defense: 16, dodge: 20, movement: "9m", attacks: [{ name: "Revólver", damage: "2d6" }] },
      additional: { note: "Mantido" },
    }), "AbC123", sampleUrl, 1234);

    expect(sheet.id).toBe("AbC123");
    expect(sheet.identity.name).toBe("Eleanor Hale");
    expect(sheet.attributes).toEqual({ AGI: 3, FOR: 1, INT: 4, PRE: 2, VIG: 2 });
    expect(sheet.resources?.pv).toEqual({ current: 21, max: 30 });
    expect(sheet.skills?.[0].name).toBe("Investigação");
    expect(sheet.inventory?.[0].quantity).toBe(2);
    expect(sheet.abilities?.[0].name).toBe("Perito");
    expect(sheet.rituals?.[0].name).toBe("Ouvir os Sussurros");
    expect(sheet.combat?.attacks?.[0].damage).toBe("2d6");
    expect(sheet.additional?.note).toBe("Mantido");
    expect(sheet.updatedAt).toBe(1234);
  });

  it("usa o identificador validado, não um ID fornecido pelo JSON", () => {
    const sheet = parseCharacterJson(JSON.stringify({ id: "attacker-controlled", identity: { name: "Agente" } }), "Real123", sampleUrl);
    expect(sheet.id).toBe("Real123");
  });

  it("permite dados parciais e não inventa recursos ausentes", () => {
    const sheet = parseCharacterJson('{"identity":{"name":"Sem recursos"}}', "AbC123", sampleUrl);
    expect(sheet.resources).toBeUndefined();
    expect(sheet.attributes).toBeUndefined();
    expect(sheet.skills).toBeUndefined();
  });

  it("rejeita JSON inválido, excesso de tamanho e ficha sem nome", () => {
    expect(() => parseCharacterJson("{", "AbC123", sampleUrl)).toThrow("JSON válido");
    expect(() => parseCharacterJson(" ".repeat(500_001), "AbC123", sampleUrl)).toThrow("500 KB");
    expect(() => parseCharacterJson('{"identity":{}}', "AbC123", sampleUrl)).toThrow("identity.name");
  });

  it("descarta retrato inseguro por HTTP", () => {
    const sheet = parseCharacterJson(JSON.stringify({ identity: { name: "Agente" }, portraitUrl: "http://image.example/p.png" }), "AbC123", sampleUrl);
    expect(sheet.portraitUrl).toBeUndefined();
  });
});


function fsString(value: string) {
  return { stringValue: value };
}
function fsInt(value: number) {
  return { integerValue: String(value) };
}
function fsMap(fields: Record<string, unknown>) {
  return { mapValue: { fields } };
}
function fsArray(values: unknown[]) {
  return { arrayValue: { values } };
}

function firestoreCharacter() {
  return {
    name: fsString("Eleanor Hale"),
    player: fsString("Jogador"),
    backgroundName: fsString("Investigadora"),
    className: fsString("Especialista"),
    nex: fsString("45%"),
    patent: fsString("Operadora"),
    private: { booleanValue: false },
    sheetPictureURL: fsString("https://cdn.example.test/eleanor.webp"),
    description: fsMap({
      physical: fsString("Cabelos escuros e casaco preto."),
      history: fsString("Investigadora marcada pelo passado."),
      personal: fsString("Reservada."),
      goal: fsString("Encontrar a verdade."),
      anotation: fsString("Não confia na Ordem."),
    }),
    attributes: fsMap({
      dex: fsInt(3), str: fsInt(1), int: fsInt(4), pre: fsInt(2), con: fsInt(2),
    }),
    currentPv: fsInt(32), maxPv: fsInt(40),
    currentPe: fsInt(15), maxPe: fsInt(20),
    currentSan: fsInt(42), maxSan: fsInt(55),
    movement: fsInt(9),
    protectionDefense: fsInt(1),
    bonusDefense: fsInt(2),
    evade: fsInt(18),
    block: fsInt(5),
    resistances: fsString("Balístico 5"),
    skills: fsArray([
      fsMap({
        name: fsString("Investigação"),
        attribute: fsString("INT"),
        trainingDegree: fsString("5"),
        otherBonus: fsInt(2),
      }),
    ]),

    conditions: fsArray([
      fsMap({
        name: fsString("Atordoado"),
        description: fsString("Condição fornecida pelo documento remoto."),
        duration: fsString("1 rodada"),
        source: fsString("C.R.I.S."),
      }),
    ]),
    attacks: fsArray([
      fsMap({
        name: fsString("Revólver"),
        attackBonus: fsInt(8),
        damage: fsString("2d6"),
        criticalRange: fsInt(19),
        criticalMult: fsInt(3),
        range: fsString("Curto"),
        skillUsed: fsString("Pontaria"),
        damageType: fsString("Balístico"),
      }),
    ]),
    inventory: fsArray([
      fsMap({
        name: fsString("Lanterna"),
        itemType: fsString("misc"),
        tag: fsString("Equipamento"),
        slots: fsInt(1),
        description: fsString("<p>Ilumina áreas escuras.</p>"),
      }),
      fsMap({
        name: fsString("Colete"),
        itemType: fsString("protection"),
        slots: fsInt(2),
        defense: fsInt(2),
      }),
    ]),
    powers: fsArray([
      fsMap({ name: fsString("Perito"), category: fsString("Classe"), description: fsString("<p>Especialista em um campo.</p>") }),
    ]),
    rituals: fsArray([
      fsMap({ name: fsString("Ouvir os Sussurros"), circle: fsString("1º"), cost: fsString("2 PE"), description: fsString("Ouve ecos do Outro Lado.") }),
    ]),
    statsClass: fsString("Especialista"),
    proficiencies: fsString("Armas simples"),
    ritualsDc: fsInt(17),
    currentLoad: fsInt(3),
    maxLoad: fsInt(10),
  };
}

function firestoreDocument(fields = firestoreCharacter()) {
  return { name: "projects/cris-ordem-paranormal/databases/(default)/documents/characters/AbC123", fields };
}

describe("integração automática com Firestore do C.R.I.S.", () => {
  it("monta o endpoint de leitura do documento por ID", () => {
    const url = new URL(buildFirestoreDocumentUrl("AbC123"));
    expect(url.hostname).toBe("firestore.googleapis.com");
    expect(url.pathname).toBe("/v1/projects/cris-ordem-paranormal/databases/(default)/documents/characters/AbC123");
    expect(url.searchParams.get("key")).toBeTruthy();
  });

  it("decodifica a ficha completa do Firestore para o dossiê", () => {
    const sheet = parseFirestoreCharacterDocument(firestoreDocument(), "AbC123", sampleUrl, 9876);
    expect(sheet.id).toBe("AbC123");
    expect(sheet.identity.name).toBe("Eleanor Hale");
    expect(sheet.identity.player).toBe("Jogador");
    expect(sheet.identity.className).toBe("Especialista");
    expect(sheet.identity.origin).toBe("Investigadora");
    expect(sheet.identity.nex).toBe("45%");
    expect(sheet.identity.rank).toBe("Operadora");
    expect(sheet.portraitUrl).toBe("https://cdn.example.test/eleanor.webp");
    expect(sheet.attributes).toEqual({ AGI: 3, FOR: 1, INT: 4, PRE: 2, VIG: 2 });
    expect(sheet.resources).toEqual({
      pv: { current: 32, max: 40 },
      pe: { current: 15, max: 20 },
      san: { current: 42, max: 55 },
    });
    expect(sheet.skills?.[0]).toMatchObject({ name: "Investigação", attribute: "INT", bonus: 7 });
    expect(sheet.combat).toMatchObject({ defense: 16, dodge: 18, block: 5, movement: "9m" });
    expect(sheet.combat?.attacks?.[0]).toMatchObject({
      name: "Revólver", test: "Pontaria +8", damage: "2d6", critical: "19/x3", range: "Curto",
    });
    expect(sheet.inventory?.[0]).toMatchObject({ name: "Lanterna", category: "Equipamento", weight: "1 espaço(s)" });
    expect(sheet.inventory?.[0].detail).toBe("Ilumina áreas escuras.");
    expect(sheet.abilities?.[0].name).toBe("Perito");
    expect(sheet.rituals?.[0].detail).toContain("Custo 2 PE");
    expect(sheet.identity.appearance).toContain("Cabelos escuros");
    expect(sheet.identity.description).toContain("Investigadora marcada pelo passado.");
    expect(sheet.additional?.["DT de rituais"]).toBe(17);
    expect(sheet.updatedAt).toBe(9876);
  });

  it("consulta o Firestore automaticamente sem solicitar JSON ao usuário", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    const result = await connectCrisLink(
      sampleUrl,
      async (input, init) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify(firestoreDocument()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      2468,
    );
    expect(requestedMethod).toBe("GET");
    expect(new URL(requestedUrl).pathname).toContain("/documents/characters/AbC123");
    expect(result.dataRead).toBe(true);
    expect(result.sheet.identity.name).toBe("Eleanor Hale");
    expect(result.sheet.updatedAt).toBe(2468);
  });

  it("bloqueia fichas explicitamente marcadas como privadas", () => {
    const fields = firestoreCharacter();
    fields.private = { booleanValue: true };
    expect(() => parseFirestoreCharacterDocument(firestoreDocument(fields), "AbC123", sampleUrl)).toThrow("privada");
  });

  it("converte 404 em erro amigável de ficha não encontrada", async () => {
    await expect(connectCrisLink(sampleUrl, async () => new Response("{}", { status: 404 })))
      .rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("não altera o conteúdo remoto: usa somente GET", async () => {
    let method = "";
    await connectCrisLink(sampleUrl, async (_input, init) => {
      method = init?.method ?? "GET";
      return new Response(JSON.stringify(firestoreDocument()), { status: 200 });
    });
    expect(method).toBe("GET");
  });
});

describe("limites seguros de escrita do C.R.I.S.", () => {
  it("mantém PV, PE e SAN somente leitura enquanto não existe escrita autorizada", () => {
    expect(isCrisResourceWritable("pv")).toBe(false);
    expect(isCrisResourceWritable("pe")).toBe(false);
    expect(isCrisResourceWritable("san")).toBe(false);
  });

  it("recusa a escrita sem realizar uma alteração local ou remota", async () => {
    await expect(writeResourceToCris("pv", 28)).rejects.toBeInstanceOf(CrisWriteUnavailableError);
    await expect(writeResourceToCris("pe", 10)).rejects.toMatchObject({ code: "CRIS_WRITE_UNAVAILABLE" });
    await expect(writeResourceToCris("san", 31)).rejects.toMatchObject({ code: "CRIS_WRITE_UNAVAILABLE" });
  });
});

describe("detecção de conflito", () => {
  it("só considera segura uma proposta baseada no valor remoto ainda atual", () => {
    expect(checkConcurrentValue(32, 20, 32).state).toBe("SAFE_TO_WRITE");
  });

  it("reconhece quando o valor proposto já foi aplicado remotamente", () => {
    expect(checkConcurrentValue(32, 20, 20)).toEqual({ state: "ALREADY_APPLIED", value: 20 });
  });

  it("detecta conflito se o C.R.I.S. mudou desde a leitura-base", () => {
    expect(checkConcurrentValue(32, 20, 25)).toEqual({
      state: "CONFLICT",
      base: 32,
      proposed: 20,
      remote: 25,
    });
  });
});

describe("sincronização remota", () => {
  const baseSheet = parseCharacterJson(JSON.stringify({
    identity: { name: "Eleanor Hale" },
    resources: {
      pv: { current: 32, max: 40 },
      pe: { current: 15, max: 20 },
      san: { current: 42, max: 55 },
    },
  }), "AbC123", sampleUrl, 100);

  it("ignora updatedAt isolado e não recria um delta falso", () => {
    const next = { ...baseSheet, updatedAt: 200 };
    const result = reconcileRemoteSheet(baseSheet, next);
    expect(result.changed).toBe(false);
    expect(result.changedPaths).toEqual([]);
    expect(result.sheet).toBe(baseSheet);
  });

  it("detecta somente o recurso que mudou na origem", () => {
    const incoming = {
      ...baseSheet,
      updatedAt: 300,
      resources: {
        pv: { current: 24, max: 40 },
        pe: { current: 15, max: 20 },
        san: { current: 42, max: 55 },
      },
    };
    const result = reconcileRemoteSheet(baseSheet, incoming);
    expect(result.changed).toBe(true);
    expect(result.changedPaths).toContain("resources.pv.current");
    expect(result.changedPaths).not.toContain("resources.pe.current");
    expect(result.sheet.resources?.pv?.current).toBe(24);
  });

  it("gera histórico apenas para recursos cujo valor atual mudou", () => {
    expect(diffResourceValues(
      {
        pv: { current: 32, max: 40 },
        pe: { current: 15, max: 20 },
        san: { current: 42, max: 55 },
      },
      {
        pv: { current: 24, max: 40 },
        pe: { current: 15, max: 20 },
        san: { current: 37, max: 55 },
      },
    )).toEqual([
      { resource: "pv", previous: 32, current: 24 },
      { resource: "san", previous: 42, current: 37 },
    ]);
  });

  it("classifica falhas de rede sem apagar a última versão conhecida", () => {
    expect(isCrisNetworkFailure({ code: "NETWORK_OR_CORS" })).toBe(true);
    expect(isCrisNetworkFailure({ code: "TIMEOUT" })).toBe(true);
    expect(isCrisNetworkFailure({ code: "INVALID_RESPONSE" })).toBe(false);
  });
});

describe("transporte de eventos", () => {
  it("não inventa websocket ou eventos oficiais; usa polling moderado", () => {
    expect(CRIS_EVENT_CAPABILITIES.officialWebSocket).toBe(false);
    expect(CRIS_EVENT_CAPABILITIES.officialWebhook).toBe(false);
    expect(CRIS_EVENT_CAPABILITIES.officialChangeFeed).toBe(false);
    expect(CRIS_EVENT_CAPABILITIES.pollingSupported).toBe(true);
    expect(CRIS_EVENT_CAPABILITIES.pollingIntervalMs).toBe(15_000);
    expect(getCrisEventTransport()).toBe("POLLING");
  });
});


describe("rolagens de atributos e perícias — Ordem Paranormal 1.2", () => {
  const sheet: CharacterSheet = {
    schemaVersion: 1,
    id: "AbC123",
    sourceUrl: sampleUrl,
    updatedAt: 1,
    identity: { name: "Eleanor Hale" },
    attributes: { AGI: 3, FOR: 1, INT: 4, PRE: 2, VIG: 0 },
  };

  it("rola um d20 por ponto de atributo e mantém o maior", () => {
    const request = buildAttributeRollRequest(sheet, "AGI", "token-1", 20);
    const sequence = [0, 0.5, 0.95];
    let index = 0;
    const result = rollD20Test(request, "Mestre", () => sequence[index++], 1234);
    expect(result.dice).toEqual([1, 11, 20]);
    expect(result.chosenDie).toBe(20);
    expect(result.total).toBe(20);
    expect(result.outcome).toBe("SUCCESS");
  });

  it("com atributo zero rola 2d20 e mantém o menor resultado", () => {
    const request = buildAttributeRollRequest(sheet, "VIG");
    const sequence = [0.95, 0.05];
    let index = 0;
    const result = rollD20Test(request, "Jogador", () => sequence[index++], 1235);
    expect(result.dice).toEqual([20, 2]);
    expect(result.chosenDie).toBe(2);
    expect(result.total).toBe(2);
  });

  it("associa perícias oficiais aos atributos-base conhecidos", () => {
    expect(getSkillAttribute({ name: "Furtividade" })).toBe("AGI");
    expect(getSkillAttribute({ name: "Luta" })).toBe("FOR");
    expect(getSkillAttribute({ name: "Investigação" })).toBe("INT");
    expect(getSkillAttribute({ name: "Percepção" })).toBe("PRE");
    expect(getSkillAttribute({ name: "Fortitude" })).toBe("VIG");
  });

  it("bloqueia perícia desconhecida sem atributo informado em vez de adivinhar", () => {
    expect(() => buildSkillRollRequest(sheet, { name: "Perícia personalizada" })).toThrow("atributo-base");
  });

  it("soma bônus de perícia e modificadores e compara com a DT", () => {
    const request: RollRequest = {
      id: "roll-test",
      characterId: sheet.id,
      characterName: sheet.identity.name,
      type: "SKILL",
      label: "Luta",
      attribute: "FOR",
      attributeValue: 1,
      skillBonus: 5,
      modifiers: [{ label: "Ajuda", value: 2 }],
      difficulty: 17,
      createdAt: 1,
    };
    const result = rollD20Test(request, "Jogador", () => 0.5, 999);
    expect(result.chosenDie).toBe(11);
    expect(result.totalBonus).toBe(7);
    expect(result.total).toBe(18);
    expect(result.outcome).toBe("SUCCESS");
  });

  it("rejeita dados de entrada inválidos", () => {
    const request: RollRequest = {
      id: "roll-invalid",
      characterId: sheet.id,
      characterName: sheet.identity.name,
      type: "ATTRIBUTE",
      label: "Agilidade",
      attribute: "AGI",
      attributeValue: 2,
      skillBonus: 0,
      modifiers: [],
      createdAt: 1,
    };
    expect(() => rollD20Test(request, "Jogador", () => 1)).toThrow("gerador de dados");
    expect(() => rollD20Test({ ...request, difficulty: -1 }, "Jogador")).toThrow("DT");
  });
});

describe("filtros do painel do Mestre", () => {
  const rosterEntry: MasterRosterEntry = {
    tokenId: "token-1",
    tokenName: "João",
    binding: {
      version: 1,
      sheetId: "AbC123",
      sourceUrl: sampleUrl,
      displayName: "João",
      boundAt: 1,
      shareWithPlayers: false,
    },
    status: "SYNCED",
    sheet: {
      schemaVersion: 1,
      id: "AbC123",
      sourceUrl: sampleUrl,
      updatedAt: 1,
      identity: { name: "João" },
      resources: {
        pv: { current: 18, max: 30 },
        pe: { current: 8, max: 12 },
        san: { current: 35, max: 40 },
      },
      conditions: [{ name: "Atordoado" }],
    },
  };

  it("filtra personagens vivos, feridos e com condições", () => {
    expect(matchesRosterFilter(rosterEntry, "ALIVE")).toBe(true);
    expect(matchesRosterFilter(rosterEntry, "INJURED")).toBe(true);
    expect(matchesRosterFilter(rosterEntry, "CONDITIONS")).toBe(true);
    expect(matchesRosterFilter(rosterEntry, "INCAPACITATED")).toBe(false);
  });

  it("identifica incapacitação por PV zero ou condição crítica", () => {
    const zeroPv = {
      ...rosterEntry,
      sheet: {
        ...rosterEntry.sheet!,
        resources: {
          ...rosterEntry.sheet!.resources,
          pv: { current: 0, max: 30 },
        },
      },
    };
    const critical = {
      ...rosterEntry,
      sheet: {
        ...rosterEntry.sheet!,
        conditions: [{ name: "Inconsciente" }],
      },
    };
    expect(matchesRosterFilter(zeroPv, "INCAPACITATED")).toBe(true);
    expect(matchesRosterFilter(critical, "INCAPACITATED")).toBe(true);
  });

  it("filtra conexões com erro ou offline", () => {
    expect(matchesRosterFilter({ ...rosterEntry, status: "OFFLINE" }, "ERROR")).toBe(true);
    expect(matchesRosterFilter({ ...rosterEntry, status: "ERROR" }, "ERROR")).toBe(true);
    expect(matchesRosterFilter(rosterEntry, "ERROR")).toBe(false);
  });
});

describe("condições importadas", () => {
  it("preserva somente condições efetivamente presentes no documento Firestore", () => {
    const sheet = parseFirestoreCharacterDocument(firestoreDocument(), "AbC123", sampleUrl);
    expect(sheet.conditions).toEqual([
      {
        name: "Atordoado",
        description: "Condição fornecida pelo documento remoto.",
        duration: "1 rodada",
        source: "C.R.I.S.",
      },
    ]);
  });
});
