export type AttributeKey = "AGI" | "FOR" | "INT" | "PRE" | "VIG";
export type ResourceKey = "pv" | "pe" | "san";

export interface ResourceValue {
  current: number;
  max: number;
}

export interface SkillEntry {
  name: string;
  attribute?: AttributeKey;
  bonus?: number | string;
  training?: string;
  notes?: string;
}

export interface AttackEntry {
  name: string;
  test?: string;
  damage?: string;
  critical?: string;
  range?: string;
  effects?: string;
}

export interface InventoryEntry {
  name: string;
  category?: string;
  quantity?: number;
  weight?: string;
  detail?: string;
}

export interface AbilityEntry {
  name: string;
  category?: string;
  detail?: string;
}

export interface CharacterSheet {
  schemaVersion: 1;
  id: string;
  sourceUrl: string;
  updatedAt: number;
  portraitUrl?: string;
  identity: {
    name: string;
    player?: string;
    origin?: string;
    className?: string;
    nex?: string;
    rank?: string;
    age?: string;
    appearance?: string;
    description?: string;
  };
  attributes?: Partial<Record<AttributeKey, number>>;
  resources?: Partial<Record<ResourceKey, ResourceValue>>;
  combat?: {
    defense?: number | string;
    dodge?: number | string;
    block?: number | string;
    movement?: string;
    initiative?: number | string;
    resistances?: string[];
    attacks?: AttackEntry[];
  };
  skills?: SkillEntry[];
  inventory?: InventoryEntry[];
  abilities?: AbilityEntry[];
  rituals?: AbilityEntry[];
  additional?: Record<string, unknown>;
}

export interface CrisSheetReference {
  id: string;
  url: string;
  name: string;
  status: "link-only" | "imported";
  addedAt: number;
  updatedAt?: number;
}

export interface TokenBinding {
  version: 1;
  sheetId: string;
  sourceUrl: string;
  displayName: string;
  boundAt: number;
  shareWithPlayers: boolean;
  snapshot?: CharacterSheet;
}

export interface CrisLink {
  id: string;
  url: string;
}
