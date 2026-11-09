import { describe, expect, it } from "vitest";
import { decodeFirestoreDocument, decodeFirestoreValue } from "../src/cris/firestore";
import { normalizeFirestoreCharacter } from "../src/cris/normalize";
import { parseCrisUrl } from "../src/cris/url";

describe("parseCrisUrl", () => {
  it("accepts a public agent URL and strips tracking parameters", () => {
    const result = parseCrisUrl("https://crisordemparanormal.com/agente/AbC123?utm_source=test#sheet");
    expect(result.characterId).toBe("AbC123");
    expect(result.url).toBe("https://crisordemparanormal.com/agente/AbC123");
  });

  it("rejects external hosts, HTTP and non-agent paths", () => {
    expect(() => parseCrisUrl("https://example.com/agente/123")).toThrow();
    expect(() => parseCrisUrl("https://crisordemparanormal.com/campanha/123")).toThrow();
    expect(() => parseCrisUrl("http://crisordemparanormal.com/agente/123")).toThrow();
  });
});

describe("decodeFirestoreValue", () => {
  it("decodes maps, arrays, numbers, booleans and strings", () => {
    const value = {
      mapValue: {
        fields: {
          name: { stringValue: "Agent" },
          level: { integerValue: "5" },
          active: { booleanValue: true },
          skills: { arrayValue: { values: [{ stringValue: "Aim" }, { stringValue: "Stealth" }] } },
        },
      },
    };
    expect(decodeFirestoreValue(value)).toEqual({
      name: "Agent",
      level: 5,
      active: true,
      skills: ["Aim", "Stealth"],
    });
  });

  it("decodes Firestore document fields", () => {
    expect(decodeFirestoreDocument({ fields: { name: { stringValue: "Ingrid" } } })).toEqual({ name: "Ingrid" });
  });
});

describe("normalizeFirestoreCharacter", () => {
  it("maps known fields and preserves unknown values", () => {
    const result = normalizeFirestoreCharacter(
      "abc123",
      "https://crisordemparanormal.com/agente/abc123",
      {
        name: "Ingrid",
        className: "Ocultista",
        originName: "Acadêmico",
        nex: "35%",
        sheetPictureURL: "https://images.example.test/ingrid.webp",
        currentPv: 21,
        maxPv: 30,
        currentPe: 8,
        maxPe: 12,
        currentSan: 35,
        maxSan: 40,
        attributes: { dex: 2, str: 1, int: 4, pre: 3, con: 2 },
        skills: [{ name: "Ocultismo", trainingDegree: "+10", attribute: "INT" }],
        inventory: [{ name: "Kit médico", slots: 1 }],
        obscureField: { retained: true },
      },
      1000,
    );

    expect(result.character.identity.name).toBe("Ingrid");
    expect(result.character.identity.className).toBe("Ocultista");
    expect(result.character.vitals.map((vital) => vital.id)).toEqual(["hp", "pe", "san"]);
    expect(result.character.attributes).toEqual({ AGI: 2, FOR: 1, INT: 4, PRE: 3, VIG: 2 });
    expect(result.character.sections.map((section) => section.id)).toContain("inventory");
    expect(result.character.additional.obscureField).toEqual({ retained: true });
    expect(result.character.source.refreshedAt).toBe(1000);
  });

  it("does not create vital meters when the sheet has no such fields", () => {
    const result = normalizeFirestoreCharacter("x", "https://crisordemparanormal.com/agente/x", { name: "No resources" }, 5);
    expect(result.character.vitals).toHaveLength(0);
  });
});
