import OBR from "../owlbear/obr";

export const SESSION_HISTORY_KEY = "com.onze1onze.sistema-cris/session-history";
export const MAX_SESSION_EVENTS = 300;

export type SessionEventKind =
  | "ROLL_COMPLETED"
  | "RESOURCE_CHANGED"
  | "CONDITION_ADDED"
  | "CONDITION_REMOVED"
  | "CHARACTER_UPDATED"
  | "SYNC_ERROR";

export interface SessionEvent {
  id: string;
  sessionId: string;
  at: number;
  characterId?: string;
  characterName: string;
  tokenId?: string;
  kind: SessionEventKind;
  field?: string;
  before?: string | number;
  after?: string | number;
  source: "Owlbear" | "C.R.I.S." | "Jogador" | "Sistema";
  detail?: string;
}

interface SessionHistory {
  version: 1;
  sessionId: string;
  createdAt: number;
  events: SessionEvent[];
}

let writeQueue: Promise<void> = Promise.resolve();

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readHistory(): Promise<SessionHistory> {
  const metadata = await OBR.scene.getMetadata();
  const value = metadata[SESSION_HISTORY_KEY] as Partial<SessionHistory> | undefined;
  if (value?.version === 1 && typeof value.sessionId === "string" && Array.isArray(value.events)) {
    return {
      version: 1,
      sessionId: value.sessionId,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
      events: value.events.filter((event) => event && typeof event.id === "string").slice(-MAX_SESSION_EVENTS),
    };
  }

  return {
    version: 1,
    sessionId: createId(),
    createdAt: Date.now(),
    events: [],
  };
}

export async function getSessionHistory(): Promise<SessionHistory> {
  const history = await readHistory();
  const metadata = await OBR.scene.getMetadata();
  if (metadata[SESSION_HISTORY_KEY] === undefined) {
    await OBR.scene.setMetadata({ [SESSION_HISTORY_KEY]: history });
  }
  return history;
}

export async function appendSessionEvent(
  event: Omit<SessionEvent, "id" | "sessionId" | "at"> & { at?: number },
): Promise<SessionEvent> {
  let created!: SessionEvent;
  const task = writeQueue.then(async () => {
    const history = await readHistory();
    created = {
      ...event,
      id: createId(),
      sessionId: history.sessionId,
      at: event.at ?? Date.now(),
    };
    history.events = [...history.events, created].slice(-MAX_SESSION_EVENTS);
    await OBR.scene.setMetadata({ [SESSION_HISTORY_KEY]: history });
  });
  writeQueue = task.catch(() => undefined);
  await task;
  return created;
}

export function validateSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SessionEvent>;
  return typeof event.id === "string"
    && typeof event.characterName === "string"
    && typeof event.kind === "string"
    && typeof event.source === "string";
}
