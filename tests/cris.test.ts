import { describe, expect, it } from "vitest";
import { CrisLinkError, validateCrisUrl } from "../src/cris/crisClient";
import { parseCharacterJson } from "../src/cris/crisParser";

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
