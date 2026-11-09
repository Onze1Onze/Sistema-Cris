import type { AttributeKey } from "../cris/crisTypes";

export type RollType = "ATTRIBUTE" | "SKILL" | "CUSTOM";

export interface RollModifier {
  label: string;
  value: number;
}

export interface RollRequest {
  id: string;
  characterId: string;
  characterName: string;
  tokenId?: string;
  type: RollType;
  label: string;
  attribute?: AttributeKey;
  attributeValue: number;
  skillBonus: number;
  modifiers: RollModifier[];
  difficulty?: number;
  createdAt: number;
}

export interface RollResult extends RollRequest {
  dice: number[];
  chosenDie: number;
  totalBonus: number;
  total: number;
  outcome?: "SUCCESS" | "FAILURE";
  completedAt: number;
  rollerName: string;
}

export interface RollBroadcastMessage {
  version: 1;
  type: "ROLL_COMPLETED";
  result: RollResult;
}
