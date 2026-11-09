import { connectCrisLink } from "../cris/crisClient";
import { CRIS_EVENT_CAPABILITIES } from "../cris/crisEvents";
import { CRIS_WRITE_CAPABILITIES } from "../cris/crisWrite";
import { diffResourceValues, isCrisNetworkFailure, reconcileRemoteSheet, type CrisSyncState, type ResourceDelta } from "../cris/crisSync";
import type { CharacterSheet, CrisSheetReference, ResourceKey, TokenBinding } from "../cris/crisTypes";
import { persistence } from "../storage/persistence";
import OBR, { type SceneItem } from "../owlbear/obr";
import {
  getRoomLibrary,
  readTokenBinding,
  removeRoomSheet,
  upsertRoomSheet,
} from "../owlbear/metadata";
import { registerContextMenu } from "../owlbear/contextMenu";
import {
  bindTokenToSheet,
  getCurrentSelection,
  getTokenById,
  unbindToken,
  updateTokenSnapshot,
  syncSharedSnapshotsForSheet,
  unbindAllTokensForSheet,
} from "../owlbear/tokenBinding";
import { buildAttributeRollRequest, buildSkillRollRequest, createRollId, formatRollSummary, performRoll, ROLL_CHANNEL, type RollRequest, type RollResult } from "../rolls/rollService";
import type { RollBroadcastMessage } from "../rolls/rollTypes";
import { appendSessionEvent, getSessionHistory, SESSION_HISTORY_KEY, type SessionEvent } from "../history/sessionHistory";
import { loadMasterRoster, locateToken, type MasterRosterEntry } from "../master-panel/masterPanel";
import { matchesRosterFilter, type RosterFilter } from "../master-panel/rosterFilters";
import { syncConditionMarkers } from "../conditions/conditionMarkers";
import {
  DEFAULT_INITIATIVE_SCENE,
  INITIATIVE_SCENE_KEY,
  INITIATIVE_TOKEN_KEY,
  LEGACY_INITIATIVE_SCENE_KEY,
  LEGACY_INITIATIVE_TOKEN_KEY,
  advanceInitiativeTurn,
  buildInitiativeEntries,
  createInitiativeRollSnapshot,
  effectiveThreatBonus,
  findInitiativeTies,
  getInitiativeProfile,
  initiativeProgress,
  isInitiativeEligible,
  normalizeInitiativeCombatant,
  normalizeInitiativeScene,
  readInitiativeCombatant,
  selectInitiativeTurn,
  type InitiativeCombatant,
  type InitiativeEntry,
  type InitiativeSceneState,
} from "../initiative/initiativeEngine";

const root = document.querySelector<HTMLDivElement>("#app");
const PAGES_BASE = "/Sistema-Cris/";

type ViewTab = "overview" | "combat" | "skills" | "gear" | "history" | "settings";

interface SyncHistoryEntry extends ResourceDelta {
  source: "C.R.I.S.";
  at: number;
}

interface AppState {
  role: "GM" | "PLAYER";
  mode: "library" | "token" | "bind" | "master" | "initiative";
  tokenId?: string;
  token?: SceneItem;
  binding?: TokenBinding;
  library: CrisSheetReference[];
  reference?: CrisSheetReference;
  sheet?: CharacterSheet;
  activeTab: ViewTab;
  shareWithPlayers: boolean;
  syncStatus: CrisSyncState;
  lastSyncAt?: number;
  syncHistory: SyncHistoryEntry[];
  pollIntervalMs: number;
  pendingRoll?: RollRequest;
  rolling: boolean;
  rollResults: RollResult[];
  initiativeEntries: InitiativeEntry[];
  initiativeScene: InitiativeSceneState;
  masterRoster: MasterRosterEntry[];
  masterBusy: boolean;
  masterFilter: RosterFilter;
  masterQuery: string;
  sessionEvents: SessionEvent[];
  historyCharacterFilter: string;
  historyKindFilter: string;
  historySourceFilter: string;
  historyFromTime: string;
  historyToTime: string;
  toast?: { message: string; kind: "success" | "warning" | "error" | "info" };
  busy: boolean;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function display(value: unknown, empty = "—"): string {
  return value === undefined || value === null || value === "" ? empty : escapeHtml(value);
}

const SYNC_INTERVAL_KEY = "com.onze1onze.sistema-cris/sync-interval";
const ALLOWED_SYNC_INTERVALS = [10_000, 15_000, 30_000] as const;

function readSyncInterval(): number {
  try {
    const value = Number(localStorage.getItem(SYNC_INTERVAL_KEY));
    return ALLOWED_SYNC_INTERVALS.includes(value as (typeof ALLOWED_SYNC_INTERVALS)[number])
      ? value
      : CRIS_EVENT_CAPABILITIES.pollingIntervalMs;
  } catch {
    return CRIS_EVENT_CAPABILITIES.pollingIntervalMs;
  }
}

function saveSyncInterval(value: number): void {
  if (!ALLOWED_SYNC_INTERVALS.includes(value as (typeof ALLOWED_SYNC_INTERVALS)[number])) return;
  try { localStorage.setItem(SYNC_INTERVAL_KEY, String(value)); } catch { /* configuração opcional */ }
}

function resourceLabel(key: ResourceKey): string {
  return ({ pv: "PONTOS DE VIDA", pe: "PONTOS DE ESFORÇO", san: "SANIDADE" })[key];
}

function resourceCard(key: ResourceKey, current: number, max: number): string {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const barColor = key === "pv" ? "red" : key === "pe" ? "violet" : "silver";
  return `<article class="resource-card">
    <div class="resource-head"><span>${resourceLabel(key)}</span><strong>${escapeHtml(current)} <i>/</i> ${escapeHtml(max)}</strong></div>
    <div class="resource-track"><span class="${barColor}" style="width:${percentage}%"></span></div>
    <small class="resource-readonly">SOMENTE LEITURA · C.R.I.S.</small>
  </article>`;
}

function portrait(sheet: CharacterSheet, compact = false): string {
  if (sheet.portraitUrl) {
    return `<img class="${compact ? "card-portrait" : "dossier-portrait"}" src="${escapeHtml(sheet.portraitUrl)}" alt="Retrato de ${escapeHtml(sheet.identity.name)}" referrerpolicy="no-referrer">`;
  }
  return `<div class="${compact ? "card-portrait" : "dossier-portrait"} portrait-fallback" aria-hidden="true"><span>✦</span><small>AGENTE</small></div>`;
}

function renderToast(toast?: AppState["toast"]): string {
  if (!toast) return "";
  return `<div class="toast ${toast.kind}" role="status">${escapeHtml(toast.message)}</div>`;
}

function renderSyncBanner(state: AppState): string {
  if (state.mode === "library" || !state.reference) return "";
  const labels: Record<CrisSyncState, string> = {
    SYNCED: "SINCRONIZADO",
    SYNCING: "CONSULTANDO C.R.I.S.",
    REMOTE_CHANGE: "ALTERAÇÃO RECEBIDA DO C.R.I.S.",
    OFFLINE: "C.R.I.S. INDISPONÍVEL",
    ERROR: "FALHA NA SINCRONIZAÇÃO",
  };
  const last = state.lastSyncAt
    ? new Date(state.lastSyncAt).toLocaleTimeString("pt-BR")
    : "AGUARDANDO PRIMEIRA LEITURA";
  return `<div class="sync-banner ${state.syncStatus.toLowerCase()}" role="status">
    <div><span class="sync-led"></span><strong>${labels[state.syncStatus]}</strong></div>
    <small>ÚLTIMA LEITURA ${escapeHtml(last)} · ESCRITA NÃO DISPONÍVEL</small>
  </div>`;
}

function renderNavigation(active: ViewTab, role: AppState["role"]): string {
  const tabs: Array<[ViewTab, string, string]> = [
    ["overview", "◈", "PERSONAGEM"],
    ["combat", "⚔", "COMBATE"],
    ["gear", "▤", "EQUIPAMENTO"],
    ["skills", "✦", "PERÍCIAS"],
    ...(role === "GM" ? [["history", "◷", "HISTÓRICO"] as [ViewTab, string, string]] : []),
    ["settings", "⚙", "ARQUIVO"],
  ];
  return `<nav class="tabs" aria-label="Seções da ficha">${tabs.map(([key, icon, title]) =>
    `<button class="tab ${active === key ? "active" : ""}" data-tab="${key}" ${active === key ? 'aria-current="page"' : ""}><span>${icon}</span><small>${title}</small></button>`
  ).join("")}</nav>`;
}

function renderResourceGrid(sheet: CharacterSheet): string {
  const resources = sheet.resources;
  if (!resources || !Object.keys(resources).length) return `<p class="muted-note">Recursos não informados nesta importação.</p>`;
  return `<div class="resource-grid">${(["pv", "pe", "san"] as ResourceKey[]).filter((key) => resources[key]).map((key) => {
    const value = resources[key]!;
    return resourceCard(key, value.current, value.max);
  }).join("")}</div>`;
}

function renderAttributes(sheet: CharacterSheet): string {
  const attributes = sheet.attributes;
  if (!attributes || !Object.keys(attributes).length) return `<p class="muted-note">Atributos não informados.</p>`;
  return `<div class="attribute-grid">${(["AGI", "FOR", "INT", "PRE", "VIG"] as const).filter((key) => attributes[key] !== undefined).map((key) =>
    `<button class="attribute roll-trigger" data-action="start-attribute-roll" data-attribute="${key}" title="Rolar ${key}"><span>${key}</span><strong>${escapeHtml(attributes[key])}</strong><small>🎲 ROLAR</small></button>`
  ).join("")}</div>`;
}

function renderSkills(sheet: CharacterSheet, limit?: number): string {
  const skills = sheet.skills ?? [];
  const list = limit ? skills.slice(0, limit) : skills;
  if (!list.length) return `<p class="muted-note">Nenhuma perícia encontrada nesta ficha.</p>`;
  return `<div class="data-list roll-list">${list.map((skill) => {
    const index = skills.indexOf(skill);
    const bonus = typeof skill.bonus === "number" && skill.bonus > 0
      ? `+${skill.bonus}`
      : display(skill.bonus, "0");
    const attribute = skill.attribute ?? "ATRIBUTO AUTOMÁTICO";
    return `<button class="data-row roll-row" data-action="start-skill-roll" data-skill-index="${index}" title="Rolar ${display(skill.name)}">
      <span class="data-icon">🎲</span>
      <span class="data-copy"><strong>${display(skill.name)}</strong><small>${display(attribute)} · BÔNUS ${bonus}</small></span>
      <b class="data-value">${bonus}</b>
    </button>`;
  }).join("")}</div>`;
}

function renderConditions(sheet: CharacterSheet): string {
  if (!sheet.conditions?.length) return `<p class="muted-note">Nenhuma condição foi fornecida no documento consultado do C.R.I.S.</p>`;
  return `<div class="condition-list">${sheet.conditions.map((condition) => `
    <article class="condition-card">
      <span class="condition-glyph">⚠</span>
      <div><strong>${display(condition.name)}</strong>
        ${condition.description ? `<p>${display(condition.description)}</p>` : ""}
        <small>${[condition.duration ? `DURAÇÃO: ${condition.duration}` : "", condition.source ? `ORIGEM: ${condition.source}` : ""].filter(Boolean).map(escapeHtml).join(" · ") || "DADOS CONFORME DOCUMENTO DO C.R.I.S."}</small>
      </div>
    </article>`).join("")}</div>`;
}

function renderInventory(sheet: CharacterSheet): string {
  if (!sheet.inventory?.length) return `<p class="muted-note">Nenhum item importado.</p>`;
  return `<div class="data-list">${sheet.inventory.map((item) => `<div class="data-row"><span class="data-icon">▤</span><div class="data-copy"><strong>${display(item.name)}</strong><small>${display(item.category, "ITEM")}${item.weight ? ` · ${display(item.weight)}` : ""}${item.detail ? ` · ${display(item.detail)}` : ""}</small></div><b class="data-value">${item.quantity !== undefined ? `×${escapeHtml(item.quantity)}` : ""}</b></div>`).join("")}</div>`;
}

function renderAbilityList(entries: CharacterSheet["abilities"], title: string): string {
  if (!entries?.length) return `<p class="muted-note">Nenhum registro em ${title.toLowerCase()}.</p>`;
  return `<div class="data-list">${entries.map((item) => `<article class="detail-row"><strong>${display(item.name)}</strong>${item.category ? `<small>${display(item.category)}</small>` : ""}${item.detail ? `<p>${display(item.detail)}</p>` : ""}</article>`).join("")}</div>`;
}

function renderOverview(sheet: CharacterSheet): string {
  const identity = sheet.identity;
  return `<section class="identity-card">
      ${portrait(sheet)}
      <div class="identity-copy"><div class="micro-label">FICHA DE AGENTE // ${escapeHtml(sheet.id.slice(0, 8).toUpperCase())}</div>
        <h1>${display(identity.name, "Agente sem nome")}</h1>
        <p>${[identity.className, identity.origin].filter(Boolean).map(escapeHtml).join(" · ") || "Registro de personagem"}</p>
        <div class="identity-tags">${identity.nex ? `<span>NEX ${display(identity.nex)}</span>` : ""}${identity.rank ? `<span>${display(identity.rank)}</span>` : ""}</div>
        ${identity.player ? `<small class="player-line">JOGADOR: ${display(identity.player)}</small>` : ""}
      </div>
    </section>
    ${identity.age || identity.appearance ? `<section class="identity-extra">${identity.age ? `<div><small>IDADE</small><strong>${display(identity.age)}</strong></div>` : ""}${identity.appearance ? `<div class="appearance"><small>APARÊNCIA</small><p>${display(identity.appearance)}</p></div>` : ""}</section>` : ""}
    <section class="section-block"><div class="section-title"><span>01</span><h2>RECURSOS VITAIS</h2><i></i></div>${renderResourceGrid(sheet)}</section>
    <section class="section-block"><div class="section-title"><span>02</span><h2>ATRIBUTOS</h2><i></i></div>${renderAttributes(sheet)}</section>
    <section class="section-block"><div class="section-title"><span>03</span><h2>PERÍCIAS EM DESTAQUE</h2><i></i></div>${renderSkills(sheet, 5)}</section>
    <section class="section-block"><div class="section-title"><span>04</span><h2>CONDIÇÕES ATUAIS</h2><i></i></div>${renderConditions(sheet)}</section>
    ${identity.description ? `<section class="note-card"><div class="micro-label">OBSERVAÇÕES DO AGENTE</div><p>${display(identity.description)}</p></section>` : ""}`;
}

function renderCombat(sheet: CharacterSheet): string {
  const combat = sheet.combat;
  const fields: Array<[string, string | number | undefined]> = [
    ["DEFESA", combat?.defense], ["ESQUIVA", combat?.dodge], ["BLOQUEIO", combat?.block],
    ["INICIATIVA", combat?.initiative], ["DESLOCAMENTO", combat?.movement],
  ];
  return `<section class="section-block"><div class="section-title"><span>04</span><h2>PARÂMETROS DE COMBATE</h2><i></i></div>
    <div class="combat-grid">${fields.filter(([, value]) => value !== undefined).map(([label, value]) => `<div class="combat-stat"><small>${label}</small><strong>${display(value)}</strong></div>`).join("") || `<p class="muted-note">Parâmetros de combate não informados.</p>`}</div>
    ${combat?.resistances?.length ? `<div class="note-card"><div class="micro-label">RESISTÊNCIAS</div><p>${combat.resistances.map(escapeHtml).join(" · ")}</p></div>` : ""}
    </section>
    <section class="section-block"><div class="section-title"><span>05</span><h2>CONDIÇÕES ATUAIS</h2><i></i></div>${renderConditions(sheet)}</section>
    <section class="section-block"><div class="section-title"><span>06</span><h2>ARMAS E ATAQUES</h2><i></i></div>
      ${combat?.attacks?.length ? `<div class="data-list">${combat.attacks.map((attack) => `<article class="detail-row"><strong>${display(attack.name)}</strong><small>${[attack.test, attack.damage, attack.critical, attack.range].filter(Boolean).map(escapeHtml).join(" · ")}</small>${attack.effects ? `<p>${display(attack.effects)}</p>` : ""}</article>`).join("")}</div>` : `<p class="muted-note">Nenhum ataque importado.</p>`}
    </section>`;
}

function renderHistory(state: AppState): string {
  const characters = [...new Set(state.sessionEvents.map((event) => event.characterName))].sort();
  const filtered = state.sessionEvents.filter((event) => {
    const eventTime = new Date(event.at).toTimeString().slice(0, 5);
    return (!state.historyCharacterFilter || event.characterName === state.historyCharacterFilter)
      && (!state.historyKindFilter || event.kind === state.historyKindFilter)
      && (!state.historySourceFilter || event.source === state.historySourceFilter)
      && (!state.historyFromTime || eventTime >= state.historyFromTime)
      && (!state.historyToTime || eventTime <= state.historyToTime);
  }).slice().reverse();
  const kindLabel: Record<SessionEvent["kind"], string> = {
    ROLL_COMPLETED: "ROLAGEM",
    RESOURCE_CHANGED: "RECURSO",
    CONDITION_ADDED: "CONDIÇÃO ADICIONADA",
    CONDITION_REMOVED: "CONDIÇÃO REMOVIDA",
    CHARACTER_UPDATED: "FICHA ATUALIZADA",
    SYNC_ERROR: "ERRO DE SINCRONIZAÇÃO",
  };
  return `<section class="section-block"><div class="section-title"><span>14</span><h2>HISTÓRICO DA SESSÃO</h2><i></i><b>${filtered.length.toString().padStart(2, "0")}</b></div>
    <div class="history-filters">
      <select id="history-character"><option value="">TODOS OS PERSONAGENS</option>${characters.map((name) => `<option value="${escapeHtml(name)}" ${state.historyCharacterFilter === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>
      <select id="history-kind"><option value="">TODOS OS EVENTOS</option>${Object.entries(kindLabel).map(([key, label]) => `<option value="${key}" ${state.historyKindFilter === key ? "selected" : ""}>${label}</option>`).join("")}</select>
      <select id="history-source">
        <option value="">TODAS AS ORIGENS</option>
        <option value="Owlbear" ${state.historySourceFilter === "Owlbear" ? "selected" : ""}>OWLBEAR</option>
        <option value="C.R.I.S." ${state.historySourceFilter === "C.R.I.S." ? "selected" : ""}>C.R.I.S.</option>
        <option value="Jogador" ${state.historySourceFilter === "Jogador" ? "selected" : ""}>JOGADOR</option>
        <option value="Sistema" ${state.historySourceFilter === "Sistema" ? "selected" : ""}>SISTEMA</option>
      </select>
      <label class="history-time-filter"><small>DE</small><input type="time" id="history-from" value="${escapeHtml(state.historyFromTime)}"></label>
      <label class="history-time-filter"><small>ATÉ</small><input type="time" id="history-to" value="${escapeHtml(state.historyToTime)}"></label>
    </div>
    ${filtered.length ? `<div class="session-event-list">${filtered.map((event) => `
      <article class="session-event">
        <div class="event-time">${new Date(event.at).toLocaleTimeString("pt-BR")}</div>
        <div class="event-main"><strong>${display(event.characterName)}</strong><small>${kindLabel[event.kind] ?? event.kind}</small>
          ${event.field ? `<p>${display(event.field)} ${event.before !== undefined ? `${escapeHtml(event.before)} → ${display(event.after)}` : display(event.after)}</p>` : ""}
          ${event.detail ? `<p>${display(event.detail)}</p>` : ""}
          <small>ORIGEM: ${display(event.source)}</small>
        </div>
      </article>`).join("")}</div>` : `<div class="empty-state"><strong>NENHUM EVENTO REGISTRADO</strong><p>Rolagens e mudanças remotas aparecerão aqui durante a sessão.</p></div>`}
  </section>`;
}

function renderRollFeed(state: AppState): string {
  if (!state.rollResults.length) return "";
  return `<section class="roll-feed"><div class="section-title"><span>🎲</span><h2>RESULTADOS DA MESA</h2><i></i></div>
    ${state.rollResults.slice(0, 5).map((result) => `
      <article class="roll-result-card">
        <div class="roll-result-top"><strong>${display(result.characterName)}</strong><small>${display(result.label)}</small></div>
        <div class="roll-result-value">${result.total}</div>
        <p>${escapeHtml(result.dice.join(" · "))} → ${result.chosenDie} ${result.totalBonus >= 0 ? "+" : "−"} ${Math.abs(result.totalBonus)}</p>
        <small>${result.difficulty !== undefined ? `DT ${result.difficulty} · ` : ""}${result.outcome === "SUCCESS" ? "SUCESSO" : result.outcome === "FAILURE" ? "FALHA" : "SEM DT"} · ${new Date(result.completedAt).toLocaleTimeString("pt-BR")}</small>
      </article>`).join("")}
    <p class="footnote">Resultados distribuídos aos participantes pelo canal de mensagens da extensão. O SDK não oferece escrita no chat nativo do Owlbear.</p>
  </section>`;
}

function renderRollDialog(state: AppState): string {
  const request = state.pendingRoll;
  if (!request) return "";
  return `<div class="roll-dialog-backdrop" role="presentation">
    <section class="roll-dialog" role="dialog" aria-modal="true" aria-labelledby="roll-dialog-title">
      <div class="micro-label">SISTEMA DE TESTES // ORDEM PARANORMAL</div>
      <h2 id="roll-dialog-title">ROLAR ${display(request.label).toUpperCase()}</h2>
      <p class="roll-dialog-formula">${request.attributeValue === 0 ? "2d20 · escolher o menor" : `${request.attributeValue}d20 · escolher o maior`} ${request.skillBonus === 0 ? "" : request.skillBonus > 0 ? `+ ${request.skillBonus}` : `− ${Math.abs(request.skillBonus)}`} ${request.attribute ? `· ${request.attribute}` : ""}</p>
      ${state.rolling ? `<div class="rolling-animation"><div class="die-cube">D20</div><strong>ROLANDO...</strong></div>` : `<label class="field-label" for="roll-dt">DIFICULDADE (DT) — OPCIONAL</label>
      <input id="roll-dt" class="roll-input" type="number" min="0" step="1" placeholder="Deixe vazio para rolagem aberta">
      <label class="field-label" for="roll-modifier">MODIFICADOR ADICIONAL — OPCIONAL</label>
      <input id="roll-modifier" class="roll-input" type="number" step="1" value="0">
      <div class="roll-dialog-actions"><button class="button secondary" data-action="cancel-roll">CANCELAR</button><button class="button primary" data-action="confirm-roll">ROLAR D20</button></div>`}
    </section>
  </div>`;
}

function renderGear(sheet: CharacterSheet): string {
  return `<section class="section-block"><div class="section-title"><span>06</span><h2>INVENTÁRIO</h2><i></i></div>${renderInventory(sheet)}</section>
    <section class="section-block"><div class="section-title"><span>07</span><h2>HABILIDADES E PODERES</h2><i></i></div>${renderAbilityList(sheet.abilities, "Habilidades")}</section>
    <section class="section-block"><div class="section-title"><span>08</span><h2>RITUAIS</h2><i></i></div>${renderAbilityList(sheet.rituals, "Rituais")}</section>`;
}

function renderSettings(state: AppState): string {
  const sheet = state.sheet;
  const reference = state.reference;
  const url = reference?.url ?? state.binding?.sourceUrl;
  const history = state.syncHistory.length
    ? state.syncHistory.slice(0, 12).map((entry) => `<div class="history-row"><span>${resourceLabel(entry.resource)}</span><strong>${entry.previous} → ${entry.current}</strong><small>${new Date(entry.at).toLocaleTimeString("pt-BR")} · ${entry.source}</small></div>`).join("")
    : `<p class="muted-note">Nenhuma alteração remota de recursos foi detectada nesta sessão.</p>`;
  return `<section class="section-block"><div class="section-title"><span>09</span><h2>DIAGNÓSTICO C.R.I.S.</h2><i></i></div>
    <div class="diagnostic-grid">
      <div><small>LEITURA</small><strong class="diagnostic-ok">DISPONÍVEL*</strong></div>
      <div><small>ESCRITA</small><strong class="diagnostic-off">NÃO DISPONÍVEL</strong></div>
      <div><small>EVENTOS OFICIAIS</small><strong class="diagnostic-off">NÃO DOCUMENTADOS</strong></div>
      <div><small>TRANSPORTE ATIVO</small><strong>${state.pollIntervalMs / 1000}s POLLING</strong></div>
    </div>
    <div class="source-box"><div class="source-status"><span class="status-light"></span><strong>FONTE: DOCUMENTO FIRESTORE DO C.R.I.S.</strong></div>
      <p>${display(url)}</p>
      <small>*A leitura usa o documento Firestore observado em clientes comunitários. O C.R.I.S. não publicou contrato oficial de API que garanta estabilidade. O polling funciona enquanto este dossiê estiver aberto e a extensão visível.</small>
      <button class="button secondary full" data-action="open-source">ABRIR NO C.R.I.S. ↗</button>
      ${state.role === "GM" ? `<button class="button primary full" data-action="refresh-sheet" ${state.busy ? "disabled" : ""}>ATUALIZAR FICHA AGORA</button>` : ""}
      ${sheet ? `<p class="footnote">Última leitura confirmada: ${state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("pt-BR") : new Date(sheet.updatedAt).toLocaleString("pt-BR")}.</p>` : ""}
    </div></section>
    <section class="section-block"><div class="section-title"><span>10</span><h2>EDIÇÃO DE RECURSOS</h2><i></i></div>
      <p class="muted-note">PV, PE e SAN estão em somente leitura. Não foi encontrada uma API externa de escrita documentada pelo C.R.I.S. Um PATCH direto no Firestore precisaria de autenticação e permissão válida nas regras do banco. A extensão não simula salvamento e não altera o cache local como se a gravação tivesse sido confirmada.</p>
      <div class="diagnostic-grid">
        ${(["pv", "pe", "san"] as ResourceKey[]).map((key) => `<div><small>${resourceLabel(key)}</small><strong class="diagnostic-off">${CRIS_WRITE_CAPABILITIES[key].supported ? "EDITÁVEL" : "SOMENTE LEITURA"}</strong></div>`).join("")}
      </div>
      ${state.role === "GM" ? `<label class="field-label" for="sync-interval">FREQUÊNCIA DE CONSULTA AUTOMÁTICA</label>
        <select id="sync-interval" class="sync-interval-select">
          <option value="10000" ${state.pollIntervalMs === 10000 ? "selected" : ""}>10 SEGUNDOS</option>
          <option value="15000" ${state.pollIntervalMs === 15000 ? "selected" : ""}>15 SEGUNDOS</option>
          <option value="30000" ${state.pollIntervalMs === 30000 ? "selected" : ""}>30 SEGUNDOS</option>
        </select>
      ` : ""}
    </section>
    <section class="section-block"><div class="section-title"><span>11</span><h2>COMPARTILHAMENTO</h2><i></i></div>
      ${state.role === "GM" ? `<label class="toggle-row"><span><strong>Compartilhar dados com jogadores</strong><small>Grava uma cópia somente depois que o Mestre autoriza a visualização na metadata sincronizada dos Tokens vinculados.</small></span>
        <input id="share-toggle" type="checkbox" ${state.shareWithPlayers ? "checked" : ""}><i></i></label>
        <button class="button secondary full" data-action="save-sharing">SALVAR PERMISSÃO DE VISUALIZAÇÃO</button>` :
        `<p class="muted-note">${state.shareWithPlayers ? "O Mestre autorizou a visualização desta cópia da ficha." : "O Mestre não autorizou o compartilhamento dos dados desta ficha."}</p>`}
    </section>
    <section class="section-block"><div class="section-title"><span>12</span><h2>HISTÓRICO DE SINCRONIZAÇÃO</h2><i></i></div><div class="sync-history">${history}</div></section>
    ${state.role === "GM" ? `<div class="action-stack"><button class="button danger" data-action="unbind">DESVINCULAR TOKEN</button></div>` : ""}
    ${sheet?.additional && Object.keys(sheet.additional).length ? `<section class="section-block"><div class="section-title"><span>13</span><h2>INFORMAÇÕES ADICIONAIS</h2><i></i></div><pre class="additional-data">${escapeHtml(JSON.stringify(sheet.additional, null, 2))}</pre></section>` : ""}
  `;
}

function renderSheetContent(state: AppState): string {
  if (!state.sheet) return renderNoSnapshot(state);
  switch (state.activeTab) {
    case "overview": return renderOverview(state.sheet);
    case "combat": return renderCombat(state.sheet);
    case "skills": return `<section class="section-block"><div class="section-title"><span>12</span><h2>TODAS AS PERÍCIAS</h2><i></i></div>${renderSkills(state.sheet)}</section>`;
    case "gear": return renderGear(state.sheet);
    case "history": return state.role === "GM" ? renderHistory(state) : renderOverview(state.sheet);
    case "settings": return renderSettings(state);
  }
}

function renderNoSnapshot(state: AppState): string {
  const url = state.reference?.url ?? state.binding?.sourceUrl;
  const canView = state.role === "GM" || state.binding?.shareWithPlayers === true;
  return `<section class="connect-placeholder">
    <div class="cris-emblem"><span>✦</span><strong>C.R.I.S.</strong><small>ARQUIVO DE AGENTE</small></div>
    <h1>${url ? (canView ? "CONSULTA DA FICHA" : "ACESSO RESTRITO") : "CONECTE UMA FICHA"}</h1>
    <p>${url
      ? (canView ? "Não há uma cópia local disponível. Consulte novamente a ficha pública do C.R.I.S." : "O Mestre ainda não compartilhou os dados deste agente com os jogadores.")
      : "Cole o link da ficha. O Sistema C.R.I.S. buscará automaticamente identidade, atributos, recursos, perícias, combate, equipamentos, poderes e rituais."}</p>
    ${!url && state.role === "GM" ? renderLinkForm(state) : ""}
    ${url && canView ? `<button class="button primary full" data-action="refresh-sheet" ${state.busy ? "disabled" : ""}>CONSULTAR FICHA AGORA</button>` : ""}
    ${url ? `<button class="button secondary full" data-action="open-source">ABRIR FICHA NO C.R.I.S. ↗</button>` : ""}
  </section>`;
}

function renderLinkForm(state: AppState): string {
  const existingUrl = state.binding?.sourceUrl ?? state.reference?.url ?? "";
  return `<form id="connect-form" class="connect-form">
    <label class="field-label" for="cris-url">LINK PÚBLICO DA FICHA</label>
    <div class="input-row"><input id="cris-url" type="url" required autocomplete="url" placeholder="https://crisordemparanormal.com/agente/..." value="${escapeHtml(existingUrl)}"><button class="button primary" type="submit">${state.mode === "bind" ? "VINCULAR E CARREGAR" : "CONECTAR FICHA"}</button></div>
    ${state.mode !== "library" ? `<label class="toggle-row"><span><strong>Compartilhar com os jogadores</strong><small>Desativado por padrão. Só compartilhe se a mesa puder ver os dados.</small></span><input id="share-toggle" type="checkbox" ${state.shareWithPlayers ? "checked" : ""}><i></i></label>` : ""}
  </form>`;
}

function renderLibraryCard(reference: CrisSheetReference, sheet: CharacterSheet | undefined, state: AppState): string {
  const name = sheet?.identity.name ?? reference.name;
  const className = sheet?.identity.className ?? (reference.status === "imported" ? "Dados importados" : "Dados pendentes de importação");
  const nex = sheet?.identity.nex;
  const resources = sheet?.resources;
  return `<article class="library-card">
    ${sheet ? portrait(sheet, true) : `<div class="card-portrait portrait-fallback"><span>✦</span><small>C.R.I.S.</small></div>`}
    <div class="card-main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(className)}${nex ? ` · NEX ${escapeHtml(nex)}` : ""}</small>
      <div class="card-vitals">${resources?.pv ? `<span>PV ${escapeHtml(resources.pv.current)}/${escapeHtml(resources.pv.max)}</span>` : ""}${resources?.pe ? `<span>PE ${escapeHtml(resources.pe.current)}/${escapeHtml(resources.pe.max)}</span>` : ""}${resources?.san ? `<span>SAN ${escapeHtml(resources.san.current)}/${escapeHtml(resources.san.max)}</span>` : ""}</div>
      <small class="record-status">${reference.status === "imported" ? "● DADOS IMPORTADOS" : "○ SOMENTE LINK"}</small>
    </div>
    <div class="card-actions"><button class="mini-button" data-action="open-sheet" data-sheet-id="${escapeHtml(reference.id)}" title="Abrir dossiê">ABRIR</button>${state.role === "GM" ? `<button class="mini-button" data-action="bind-selected" data-sheet-id="${escapeHtml(reference.id)}" title="Vincular ao Token selecionado">VINCULAR</button><button class="mini-button danger-text" data-action="remove-sheet" data-sheet-id="${escapeHtml(reference.id)}" title="Remover ficha da sala">REMOVER</button>` : ""}</div>
  </article>`;
}

function renderMasterPanel(state: AppState): string {
  const query = state.masterQuery.trim().toLocaleLowerCase("pt-BR");
  const entries = state.masterRoster.filter((entry) =>
    matchesRosterFilter(entry, state.masterFilter)
    && (!query || entry.tokenName.toLocaleLowerCase("pt-BR").includes(query)
      || entry.sheet?.identity.name.toLocaleLowerCase("pt-BR").includes(query)),
  );
  const statusLabels = {
    SYNCED: "SINCRONIZADO",
    SYNCING: "SINCRONIZANDO",
    OFFLINE: "OFFLINE",
    ERROR: "ERRO",
  } as const;
  const resource = (entry: MasterRosterEntry, key: "pv" | "pe" | "san") => {
    const value = entry.sheet?.resources?.[key];
    return value ? `${value.current}/${value.max}` : "—";
  };
  return `<section class="master-panel">
    <div class="dossier-heading"><button class="text-back" data-action="back-library">← ARQUIVO DA SALA</button><div class="micro-label">CENTRAL DE OPERAÇÕES // MESTRE</div><h1>PAINEL DO GRUPO</h1><p>${state.masterRoster.length} Token(s) com ficha C.R.I.S. nesta cena</p></div>
    <div class="master-controls">
      <input id="roster-search" type="search" placeholder="Pesquisar personagem ou Token..." value="${escapeHtml(state.masterQuery)}">
      <select id="roster-filter">
        <option value="ALL" ${state.masterFilter === "ALL" ? "selected" : ""}>TODOS</option>
        <option value="ALIVE" ${state.masterFilter === "ALIVE" ? "selected" : ""}>VIVOS</option>
        <option value="INCAPACITATED" ${state.masterFilter === "INCAPACITATED" ? "selected" : ""}>INCAPACITADOS</option>
        <option value="INJURED" ${state.masterFilter === "INJURED" ? "selected" : ""}>FERIDOS</option>
        <option value="CONDITIONS" ${state.masterFilter === "CONDITIONS" ? "selected" : ""}>COM CONDIÇÕES</option>
        <option value="ERROR" ${state.masterFilter === "ERROR" ? "selected" : ""}>COM ERRO</option>
      </select>
      <button class="button secondary full" data-action="refresh-roster" ${state.masterBusy ? "disabled" : ""}>↻ ATUALIZAR GRUPO</button>
    </div>
    ${state.masterBusy ? `<div class="master-loading">CONSULTANDO FICHAS VINCULADAS...</div>` : ""}
    ${entries.length ? `<div class="master-roster-list">${entries.map((entry) => {
      const pv = entry.sheet?.resources?.pv;
      const healthState = pv && pv.current <= 0 ? "incapacitado" : pv && pv.current < pv.max ? "ferido" : "estavel";
      const conditions = entry.sheet?.conditions ?? [];
      return `<article class="master-roster-card ${healthState}">
        <div class="master-card-head"><div><strong>${display(entry.sheet?.identity.name ?? entry.tokenName)}</strong><small>TOKEN: ${display(entry.tokenName)}</small></div>
          <span class="roster-status ${entry.status.toLowerCase()}">${statusLabels[entry.status]}</span>
        </div>
        <div class="master-vitals">
          <span>PV <b>${resource(entry, "pv")}</b></span>
          <span>PE <b>${resource(entry, "pe")}</b></span>
          <span>SAN <b>${resource(entry, "san")}</b></span>
        </div>
        <div class="master-subline">DEF ${display(entry.sheet?.combat?.defense)} · INI ${display(entry.sheet?.combat?.initiative)}</div>
        ${conditions.length ? `<div class="master-conditions">${conditions.map((condition) => `<span>⚠ ${display(condition.name)}</span>`).join("")}</div>` : ""}
        ${entry.error ? `<p class="master-error">${display(entry.error)}</p>` : ""}
        <small class="master-sync-time">ÚLTIMA CONSULTA: ${entry.lastSyncAt ? new Date(entry.lastSyncAt).toLocaleTimeString("pt-BR") : "NÃO CONSULTADA"}</small>
        <div class="master-card-actions">
          <button class="mini-button" data-action="locate-token" data-token-id="${escapeHtml(entry.tokenId)}">LOCALIZAR</button>
          <button class="mini-button" data-action="open-roster-token" data-token-id="${escapeHtml(entry.tokenId)}">ABRIR FICHA</button>
        </div>
      </article>`;
    }).join("")}</div>` : `<div class="empty-state"><strong>NENHUM PERSONAGEM ENCONTRADO</strong><p>${state.masterRoster.length ? "Nenhum personagem corresponde ao filtro." : "Vincule fichas C.R.I.S. aos Tokens para preencher o painel."}</p></div>`}
    <div class="master-write-note"><strong>CONTROLES DE RECURSOS</strong><p>PV, PE e SAN continuam somente leitura. A API oficial de escrita do C.R.I.S. não foi confirmada; dano e cura não serão simulados.</p></div>
    ${renderHistory(state)}
  </section>`;
}

function renderLibrary(state: AppState): string {
  const cards = state.library.map((reference) => renderLibraryCard(reference, persistence.get(reference.id), state)).join("");
  return `<div class="library-tools">${state.role === "GM" ? `<button class="button secondary" data-action="master-panel">PAINEL DO MESTRE</button>` : ""}<button class="button secondary" data-action="open-initiative">INICIATIVA</button></div>
  <section class="connect-panel">
      <div class="connect-intro"><div class="cris-emblem"><span>✦</span><strong>C.R.I.S.</strong><small>CONEXÃO EXTERNA</small></div>
        <div><div class="micro-label">PROTOCOLO DE ACESSO</div><h1>Conecte sua ficha do C.R.I.S.</h1><p>Cole o link público. A extensão consulta e importa os dados automaticamente.</p></div>
      </div>
      ${state.role === "GM" ? renderLinkForm(state) : `<p class="muted-note">Apenas o Mestre pode cadastrar ou vincular fichas.</p>`}
    </section>
    <section class="section-block library-section"><div class="section-title"><span>01</span><h2>FICHAS DESTA SALA</h2><i></i><b>${state.library.length.toString().padStart(2, "0")}</b></div>
      ${cards ? `<div class="library-list">${cards}</div>` : `<div class="empty-state"><div class="empty-scroll">▤</div><strong>NENHUMA FICHA REGISTRADA</strong><p>Adicione um link do C.R.I.S. para iniciar o arquivo desta sala.</p></div>`}
    </section>
    <div class="footnote privacy-note">ASSOCIAÇÕES SÃO SALVAS NA CENA. OS DADOS SÃO CONSULTADOS DIRETAMENTE NO C.R.I.S.; O COMPARTILHAMENTO COM JOGADORES DEPENDE DA AUTORIZAÇÃO DO MESTRE.</div>`;
}

function renderInitiativePanel(state: AppState): string {
  const entries = state.initiativeEntries;
  const scene = state.initiativeScene;
  const isGM = state.role === "GM";
  const ties = findInitiativeTies(entries);
  const active = entries.find((entry) => entry.id === scene.activeId);
  const progress = initiativeProgress(entries, scene);
  const unrolled = entries.filter((entry) => !entry.combatant.roll);
  const eligible = entries.filter((entry) => isInitiativeEligible(entry, scene.round));
  const participantCards = entries.map((entry, index) => {
    const data = entry.combatant;
    const isActive = entry.id === scene.activeId;
    const isTied = ties.some((group) => group.some((candidate) => candidate.id === entry.id));
    const late = scene.started && data.availableFromRound > scene.round;
    const surprised = data.surprised && scene.round === 1;
    const score = data.initiative === null ? "—" : String(data.initiative);
    const role = data.role === "THREAT" ? "AMEAÇA" : "AGENTE";
    const mechanics = data.role === "AGENT"
      ? entry.profile
        ? `AGI ${entry.profile.attributeValue} · INICIATIVA ${entry.profile.bonus >= 0 ? "+" : ""}${entry.profile.bonus}`
        : entry.initiativeError ?? "AGUARDANDO FICHA C.R.I.S."
      : entry.derivedThreatBonus !== undefined
        ? `BÔNUS DA FICHA ${entry.derivedThreatBonus >= 0 ? "+" : ""}${entry.derivedThreatBonus} · MENOR DO GRUPO`
        : `BÔNUS MANUAL ${data.threatBonus >= 0 ? "+" : ""}${data.threatBonus}`;
    const flags = [
      surprised ? '<span class="initiative-flag warning">SURPREENDIDO · NÃO AGE NA RODADA 1</span>' : "",
      late ? `<span class="initiative-flag">ENTRA NA RODADA ${data.availableFromRound}</span>` : "",
      isTied ? '<span class="initiative-flag danger">EMPATE · DESEMPATE NECESSÁRIO</span>' : "",
      entry.conditions.map((condition) => `<span class="initiative-flag condition">${escapeHtml(condition)}</span>`).join(""),
      entry.tokenIds.length > 1 ? `<span class="initiative-flag">${entry.tokenIds.length} TOKENS · TESTE ÚNICO</span>` : "",
    ].filter(Boolean).join("");
    const roll = data.roll
      ? `${data.roll.dice.length}d20 [${data.roll.dice.join(" · ")}] · ${data.roll.keep === "lowest" ? "MENOR" : "MAIOR"} ${data.roll.selected} ${data.roll.bonus >= 0 ? "+" : ""}${data.roll.bonus} = ${data.roll.total}`
      : data.initiative !== null ? `RESULTADO LEGADO ${data.initiative} · ROLE NOVAMENTE` : "TESTE DE INICIATIVA PENDENTE";
    const portraitUrl = entry.sheet?.portraitUrl;
    const portraitMarkup = portraitUrl && /^https?:\/\//i.test(portraitUrl)
      ? `<img class="initiative-portrait" src="${escapeHtml(portraitUrl)}" alt="" loading="lazy">`
      : `<span class="initiative-portrait fallback">${escapeHtml((data.displayName || entry.name).slice(0, 2).toLocaleUpperCase("pt-BR"))}</span>`;
    return `<article class="initiative-card ${isActive ? "is-active" : ""}" data-entry-id="${escapeHtml(entry.id)}">
      <div class="initiative-card-head">
        <span class="initiative-rank">${String(index + 1).padStart(2, "0")}</span>
        ${portraitMarkup}
        <div class="initiative-identity"><strong>${escapeHtml(data.displayName || entry.name)}</strong><small>${role} · ${escapeHtml(mechanics)}</small></div>
        <div class="initiative-score ${data.roll ? "" : "pending"}"><small>${data.roll ? "INICIATIVA" : "PENDENTE"}</small><strong>${escapeHtml(score)}</strong></div>
      </div>
      ${flags ? `<div class="initiative-flags">${flags}</div>` : ""}
      <div class="initiative-roll-detail">${escapeHtml(roll)}</div>
      ${data.note ? `<p class="initiative-note">NOTA · ${escapeHtml(data.note)}</p>` : ""}
      ${isGM ? `<div class="initiative-card-actions">
        <button class="mini-button" data-action="initiative-edit" data-id="${escapeHtml(entry.id)}" type="button">EDITAR</button>
        <button class="mini-button" data-action="initiative-toggle-surprised" data-id="${escapeHtml(entry.id)}" type="button">${data.surprised ? "REMOVER SURPRESA" : "SURPREENDIDO"}</button>
        <button class="mini-button current" data-action="initiative-activate" data-id="${escapeHtml(entry.id)}" type="button" ${!scene.started || !isInitiativeEligible(entry, scene.round) ? "disabled" : ""}>${isActive ? "TURNO ATUAL" : "ATIVAR"}</button>
        <button class="mini-button danger" data-action="initiative-remove" data-id="${escapeHtml(entry.id)}" type="button">REMOVER</button>
      </div>` : ""}
    </article>`;
  }).join("");

  return `<section class="initiative-view">
    <div class="initiative-heading">
      <button class="text-back" data-action="back-library" type="button">← ARQUIVO DA SALA</button>
      <div class="micro-label">PROTOCOLO TÁTICO // ORDEM PARANORMAL RPG 1.2</div>
      <h1>Ordem de Iniciativa</h1>
      <p>Atributos, perícias e modificadores de agentes são lidos diretamente das fichas vinculadas do C.R.I.S.</p>
    </div>
    <section class="initiative-status">
      <div class="initiative-case"><small>ESTADO DA OPERAÇÃO</small><strong>${scene.started ? "COMBATE EM ANDAMENTO" : entries.length ? "CENA PREPARADA" : "AGUARDANDO ENVOLVIDOS"}</strong><span>${entries.length} REGISTRO(S) · ${scene.round}ª RODADA</span></div>
      <div class="initiative-round"><small>RODADA</small><strong>${scene.started ? String(scene.round).padStart(2, "0") : "—"}</strong></div>
    </section>
    <section class="initiative-turn-banner">
      <div class="initiative-active-portrait">${active ? escapeHtml((active.combatant.displayName || active.name).slice(0, 2).toLocaleUpperCase("pt-BR")) : "—"}</div>
      <div class="initiative-active-copy"><small>ENVOLVIDO EM AÇÃO</small><strong>${active ? escapeHtml(active.combatant.displayName || active.name) : "Nenhum turno ativo"}</strong><span>${active ? `${active.combatant.role === "THREAT" ? "AMEAÇA" : "AGENTE"} · INICIATIVA ${active.combatant.initiative}` : scene.started ? "Nenhum participante elegível nesta rodada." : "Inicie o combate para estabelecer a ordem."}</span></div>
      <div class="initiative-progress"><div><small>SEQUÊNCIA</small><b>${progress}%</b></div><span><i style="width:${progress}%"></i></span></div>
    </section>
    <section class="initiative-rule-note">
      <b>FÓRMULA C.R.I.S. · AGENTES</b>
      <p>Usa a perícia Iniciativa da ficha, seu atributo-base Agilidade e o bônus total já calculado pelo C.R.I.S. AGI 0 mantém a regra de 2d20, escolhendo o menor. O treinamento não é somado novamente.</p>
      <p><b>AMEAÇAS</b> — um teste único de 1d20 com o menor bônus de Iniciativa do grupo.</p>
    </section>
    ${isGM ? `<section class="initiative-controls">
      <div class="section-title"><span>01</span><h2>CONTROLE DA OPERAÇÃO</h2><i></i></div>
      <button class="button primary full" data-action="initiative-add-selected" type="button">＋ ADICIONAR TOKENS SELECIONADOS</button>
      <div class="initiative-control-grid">
        <button class="button secondary" data-action="initiative-roll" type="button" ${!entries.length || (scene.started && !unrolled.length) ? "disabled" : ""}>ROLAR INICIATIVA ${scene.started ? `(${unrolled.length} NOVOS)` : ""}</button>
        <button class="button warning" data-action="initiative-resolve-ties" type="button" ${!ties.length ? "disabled" : ""}>DESEMPATAR (${ties.reduce((sum, group) => sum + group.length, 0)})</button>
        <button class="button secondary" data-action="initiative-previous" type="button" ${!scene.started || !scene.activeId ? "disabled" : ""}>‹ TURNO ANTERIOR</button>
        <button class="button secondary" data-action="initiative-next" type="button" ${!scene.started || !entries.length ? "disabled" : ""}>PRÓXIMO TURNO ›</button>
        <button class="button primary" data-action="initiative-start" type="button" ${scene.started || !entries.length || unrolled.length > 0 || ties.length > 0 ? "disabled" : ""}>▶ INICIAR COMBATE</button>
        <button class="button danger" data-action="initiative-end" type="button" ${!scene.started ? "disabled" : ""}>ENCERRAR COMBATE</button>
      </div>
      <button class="button danger full" data-action="initiative-clear" type="button" ${!entries.length ? "disabled" : ""}>LIMPAR REGISTRO DA CENA</button>
      <p class="initiative-phase-note">${unrolled.length ? `${unrolled.length} participante(s) ainda precisam rolar iniciativa.` : ties.length ? "Resolva os empates antes de iniciar o combate." : scene.started ? "A iniciativa permanece fixa entre rodadas. Novos envolvidos entram na rodada seguinte." : "Revise os envolvidos e inicie o combate quando a ordem estiver pronta."}</p>
    </section>` : ""}
    <section class="initiative-participants">
      <div class="section-title"><span>02</span><h2>ORDEM DE AÇÃO</h2><i></i><b>${entries.length.toString().padStart(2, "0")} REGISTROS</b></div>
      ${participantCards || `<div class="empty-state"><span class="empty-scroll">✣</span><strong>NENHUM ENVOLVIDO REGISTRADO</strong><p>Selecione Tokens da camada Personagem e adicione-os à operação. Agentes precisam estar vinculados a uma ficha C.R.I.S.</p></div>`}
      ${!isGM && entries.length ? '<p class="initiative-phase-note">Visualização da iniciativa compartilhada pela sala. O controle do combate pertence ao Mestre.</p>' : ""}
      ${!eligible.length && scene.started ? '<p class="initiative-phase-note">Nenhum participante pode agir nesta rodada. Avance para a próxima rodada.</p>' : ""}
    </section>
  </section>
  ${isGM ? `<dialog id="initiative-add-dialog" class="cris-dialog initiative-dialog">
    <form id="initiative-add-form">
      <div class="dialog-heading"><div><span class="micro-label">NOVO REGISTRO · ${state.initiativeEntries.length} NA CENA</span><h2>IDENTIFICAR ENVOLVIDOS</h2></div><button class="icon-button" data-action="initiative-close-add" type="button" aria-label="Fechar">×</button></div>
      <label for="initiative-add-role">TIPO DE ENVOLVIDO</label>
      <select id="initiative-add-role"><option value="AGENT">Agente / personagem com ficha C.R.I.S.</option><option value="THREAT">Ameaças — grupo do Mestre</option></select>
      <label for="initiative-group-name">IDENTIFICAÇÃO DO GRUPO DE AMEAÇAS</label><input id="initiative-group-name" maxlength="80" value="Ameaças">
      <label for="initiative-threat-bonus">BÔNUS DE INICIATIVA MANUAL (AMEAÇAS)</label><input id="initiative-threat-bonus" type="number" min="-99" max="99" value="0">
      <p class="field-hint">Quando todos os Tokens do grupo tiverem fichas C.R.I.S. vinculadas e a perícia Iniciativa disponível, o sistema usa automaticamente o menor bônus da ficha. Caso contrário, utiliza este valor.</p>
      <label for="initiative-modifier">MODIFICADOR SITUACIONAL ADICIONAL</label><input id="initiative-modifier" type="number" min="-99" max="99" value="0">
      <label class="check-line"><input id="initiative-surprised" type="checkbox"><span>Surpreendido — não age na primeira rodada</span></label>
      <div class="dialog-actions"><button class="text-action" data-action="initiative-close-add" type="button">CANCELAR</button><button class="dialog-submit" type="submit">REGISTRAR ENVOLVIDOS</button></div>
    </form>
  </dialog>
  <dialog id="initiative-edit-dialog" class="cris-dialog initiative-dialog">
    <form id="initiative-edit-form">
      <div class="dialog-heading"><div><span class="micro-label">DOSSIÊ TÁTICO // AJUSTE INDIVIDUAL</span><h2>ALTERAR REGISTRO</h2></div><button class="icon-button" data-action="initiative-close-edit" type="button" aria-label="Fechar">×</button></div>
      <input id="initiative-edit-id" type="hidden">
      <label for="initiative-edit-modifier">MODIFICADOR SITUACIONAL</label><input id="initiative-edit-modifier" type="number" min="-99" max="99" value="0">
      <label class="check-line"><input id="initiative-edit-surprised" type="checkbox"><span>Surpreendido — não age na primeira rodada</span></label>
      <label for="initiative-edit-conditions">CONDIÇÕES ADICIONAIS <small>Separe por vírgulas</small></label><input id="initiative-edit-conditions" maxlength="180" placeholder="Ex.: Abalado, Caído">
      <label for="initiative-edit-note">NOTAS DA OPERAÇÃO</label><textarea id="initiative-edit-note" rows="3" maxlength="500"></textarea>
      <p id="initiative-edit-roll-info" class="field-hint"></p>
      <div class="dialog-actions"><button class="text-action" data-action="initiative-close-edit" type="button">CANCELAR</button><button class="dialog-submit" type="submit">SALVAR DOSSIÊ</button></div>
    </form>
  </dialog>` : ""}`;
}

function renderApp(state: AppState): string {
  const body = state.mode === "initiative"
    ? renderInitiativePanel(state)
    : state.mode === "library"
      ? renderLibrary(state)
      : state.mode === "master"
        ? renderMasterPanel(state)
        : state.sheet
        ? `<div class="dossier-heading"><button class="text-back" data-action="back-library">← ARQUIVO DA SALA</button></div>${renderNavigation(state.activeTab, state.role)}<main class="sheet-content">${renderSheetContent(state)}</main>`
        : `<section class="dossier-heading"><button class="text-back" data-action="back-library">← ARQUIVO DA SALA</button><h1>Vincular ficha ao Token</h1></section><main class="sheet-content">${renderNoSnapshot(state)}</main>`;
  return `<div class="app-shell"><main class="content">${renderSyncBanner(state)}${body}${state.mode === "token" || state.mode === "master" ? renderRollFeed(state) : ""}${renderToast(state.toast)}</main>${renderRollDialog(state)}</div>`;
}

function parseRollBroadcast(value: unknown): RollBroadcastMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as Partial<RollBroadcastMessage>;
  if (message.version !== 1 || message.type !== "ROLL_COMPLETED" || !message.result) return undefined;
  const result = message.result as Partial<RollResult>;
  if (typeof result.id !== "string" || typeof result.characterId !== "string"
    || typeof result.characterName !== "string" || typeof result.rollerName !== "string"
    || typeof result.label !== "string" || typeof result.total !== "number"
    || typeof result.chosenDie !== "number" || typeof result.totalBonus !== "number"
    || !Array.isArray(result.dice) || !result.dice.every((die) => typeof die === "number" && Number.isFinite(die))
    || typeof result.completedAt !== "number") return undefined;
  return message as RollBroadcastMessage;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export class CrisApp {
  private state: AppState;
  private root: HTMLDivElement;
  private sourceUrl = "";
  private pollTimer?: number;
  private syncInFlight = false;
  private unsubscribeSceneItems?: () => void;
  private unsubscribeBroadcast?: () => void;
  private unsubscribeHistory?: () => void;
  private masterTimer?: number;
  private masterInFlight = false;
  private pendingInitiativeTokenIds: string[] = [];
  private readonly visibilityHandler = (): void => {
    if (document.hidden) {
      this.stopPolling();
      this.stopMasterPolling();
    } else {
      this.startPolling();
      this.startMasterPolling();
    }
  };
  private readonly pageHideHandler = (): void => {
    this.stopPolling();
    this.unsubscribeSceneItems?.();
    this.unsubscribeSceneItems = undefined;
    this.unsubscribeBroadcast?.();
    this.unsubscribeBroadcast = undefined;
    this.unsubscribeHistory?.();
    this.unsubscribeHistory = undefined;
    this.stopMasterPolling();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    window.removeEventListener("pagehide", this.pageHideHandler);
  };

  constructor(element: HTMLDivElement) {
    this.root = element;
    const query = new URLSearchParams(window.location.search);
    const modeParam = query.get("mode");
    const mode: AppState["mode"] = modeParam === "token" ? "token" : modeParam === "bind" ? "bind" : modeParam === "master" ? "master" : modeParam === "initiative" ? "initiative" : "library";
    this.state = {
      role: "PLAYER",
      mode,
      tokenId: query.get("token") ?? undefined,
      library: [],
      activeTab: "overview",
      shareWithPlayers: false,
      syncStatus: "SYNCED",
      syncHistory: [],
      pollIntervalMs: readSyncInterval(),
      rolling: false,
      rollResults: [],
      initiativeEntries: [],
      initiativeScene: { ...DEFAULT_INITIATIVE_SCENE },
      masterRoster: [],
      masterBusy: false,
      masterFilter: "ALL",
      masterQuery: "",
      sessionEvents: [],
      historyCharacterFilter: "",
      historyKindFilter: "",
      historySourceFilter: "",
      historyFromTime: "",
      historyToTime: "",
      busy: false,
    };
    this.root.addEventListener("click", (event) => void this.handleClick(event));
    this.root.addEventListener("submit", (event) => void this.handleSubmit(event));
    this.root.addEventListener("change", (event) => this.handleChange(event));
    document.addEventListener("visibilitychange", this.visibilityHandler);
    window.addEventListener("pagehide", this.pageHideHandler);
  }

  async initialize(): Promise<void> {
    this.state.role = await OBR.player.getRole();
    const ready = await OBR.scene.isReady();
    if (!ready) {
      this.toast("Abra uma cena no Owlbear Rodeo para carregar o arquivo desta sala.", "warning");
      this.render();
      return;
    }
    if (this.state.mode === "master" && this.state.role !== "GM") {
      this.state.mode = "library";
      this.toast("O painel de operação é exclusivo do Mestre.", "warning");
    }
    await this.reloadRoomData();
    await this.refreshInitiativeData();
    const session = await getSessionHistory();
    this.state.sessionEvents = session.events;
    this.unsubscribeHistory = OBR.scene.onMetadataChange((metadata) => {
      const value = metadata[SESSION_HISTORY_KEY] as { version?: number; events?: SessionEvent[] } | undefined;
      if (value?.version === 1 && Array.isArray(value.events)) {
        this.state.sessionEvents = value.events;
        if (this.state.activeTab === "history" || this.state.mode === "master") this.render();
      }
      this.state.initiativeScene = normalizeInitiativeScene(metadata[INITIATIVE_SCENE_KEY] ?? metadata[LEGACY_INITIATIVE_SCENE_KEY]);
      if (this.state.mode === "initiative") void this.refreshInitiativeData();
    });
    this.unsubscribeBroadcast = OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
      const message = parseRollBroadcast(event.data);
      if (!message || this.state.rollResults.some((result) => result.id === message.result.id)) return;
      this.state.rollResults = [message.result, ...this.state.rollResults].slice(0, 12);
      if (this.state.role === "GM") {
        void appendSessionEvent({
          characterId: message.result.characterId,
          characterName: message.result.characterName,
          tokenId: message.result.tokenId,
          kind: "ROLL_COMPLETED",
          field: message.result.label,
          after: message.result.total,
          source: "Jogador",
          detail: `Rolagem de ${message.result.rollerName} · ${formatRollSummary(message.result)}`,
          at: message.result.completedAt,
        }).then(() => this.refreshSessionEvents());
      }
      this.render();
    });
    this.unsubscribeSceneItems = OBR.scene.items.onChange((items) => this.handleSceneItemsChanged(items));
    await registerContextMenu();
    await syncConditionMarkers(this.state.role);
    this.render();
    if (this.state.mode === "master") {
      await this.refreshMasterRoster(false);
      this.startMasterPolling();
    } else {
      this.startPolling();
    }
  }

  private resolveInitiativeSheet(item: SceneItem): CharacterSheet | undefined {
    const binding = readTokenBinding(item);
    if (!binding) return undefined;
    if (this.state.role === "PLAYER" && !binding.shareWithPlayers) return undefined;
    return persistence.get(binding.sheetId) ?? (binding.shareWithPlayers ? binding.snapshot : undefined);
  }

  private async refreshInitiativeData(items?: SceneItem[]): Promise<void> {
    if (!(await OBR.scene.isReady())) {
      this.state.initiativeEntries = [];
      this.state.initiativeScene = { ...DEFAULT_INITIATIVE_SCENE };
      if (this.state.mode === "initiative") this.render();
      return;
    }
    const [sceneItems, metadata] = await Promise.all([
      items ? Promise.resolve(items) : OBR.scene.items.getItems(),
      OBR.scene.getMetadata(),
    ]);
    this.state.initiativeEntries = buildInitiativeEntries(sceneItems, (item) => this.resolveInitiativeSheet(item));
    this.state.initiativeScene = normalizeInitiativeScene(metadata[INITIATIVE_SCENE_KEY] ?? metadata[LEGACY_INITIATIVE_SCENE_KEY]);
    if (this.state.mode === "initiative") this.render();
  }

  private async persistInitiativeScene(nextState: InitiativeSceneState): Promise<void> {
    const next = normalizeInitiativeScene(nextState);
    await OBR.scene.setMetadata({ [INITIATIVE_SCENE_KEY]: next });
    this.state.initiativeScene = next;
    this.render();
  }

  private async openInitiativeAddDialog(): Promise<void> {
    if (this.state.role !== "GM") return this.toast("Somente o Mestre pode adicionar participantes à iniciativa.", "error");
    this.state.masterRoster = await loadMasterRoster(false);
    const selected = (await getCurrentSelection()).filter((item) => item.type === "IMAGE" && item.layer === "CHARACTER");
    const eligible = selected.filter((item) => !readInitiativeCombatant(item));
    if (!eligible.length) return this.toast("Selecione Tokens de personagem que ainda não estejam na ordem de iniciativa.", "warning");
    this.pendingInitiativeTokenIds = eligible.map((item) => item.id);
    this.state.mode = "initiative";
    await this.refreshInitiativeData();
    this.render();
    this.root.querySelector<HTMLDialogElement>("#initiative-add-dialog")?.showModal();
  }

  private async submitInitiativeAdd(event: Event): Promise<void> {
    event.preventDefault();
    if (this.state.role !== "GM" || !this.pendingInitiativeTokenIds.length) return;
    const role = this.root.querySelector<HTMLSelectElement>("#initiative-add-role")?.value === "THREAT" ? "THREAT" : "AGENT";
    const groupName = this.root.querySelector<HTMLInputElement>("#initiative-group-name")?.value.trim() || "Ameaças";
    const threatBonusInput = this.root.querySelector<HTMLInputElement>("#initiative-threat-bonus")?.value ?? "0";
    const threatBonus = Number(threatBonusInput);
    const modifier = Number(this.root.querySelector<HTMLInputElement>("#initiative-modifier")?.value ?? "0");
    const surprised = this.root.querySelector<HTMLInputElement>("#initiative-surprised")?.checked ?? false;
    if (!Number.isInteger(modifier) || modifier < -99 || modifier > 99 || !Number.isInteger(threatBonus) || threatBonus < -99 || threatBonus > 99) {
      return this.toast("Os modificadores precisam ser números inteiros entre -99 e +99.", "warning");
    }

    const tokens = (await OBR.scene.items.getItems(this.pendingInitiativeTokenIds))
      .filter((item) => item.type === "IMAGE" && item.layer === "CHARACTER" && !readInitiativeCombatant(item));
    if (!tokens.length) return this.toast("Os Tokens selecionados não estão mais disponíveis.", "warning");

    const nextRound = this.state.initiativeScene.started ? this.state.initiativeScene.round + 1 : 1;
    const now = Date.now();
    const updates = new Map<string, { version: 1; combatant: InitiativeCombatant }>();

    if (role === "AGENT") {
      const missing = tokens.filter((item) => {
        const sheet = this.resolveInitiativeSheet(item);
        if (!sheet) return true;
        try { getInitiativeProfile(sheet); return false; } catch { return true; }
      });
      if (missing.length) {
        return this.toast("Todos os agentes precisam de uma ficha C.R.I.S. acessível e da perícia Iniciativa vinculada à Agilidade. Corrija as fichas antes de recrutá-los.", "warning");
      }
      for (const item of tokens) {
        const sheet = this.resolveInitiativeSheet(item)!;
        const combatant = normalizeInitiativeCombatant({
          role: "AGENT",
          groupId: item.id,
          displayName: sheet.identity.name || item.name || "Agente",
          modifier,
          initiative: null,
          roll: null,
          surprised,
          availableFromRound: nextRound,
          conditions: [],
          note: "",
          addedAt: now,
        });
        updates.set(item.id, { version: 1, combatant });
      }
    } else {
      const profiles = tokens.map((item) => {
        const sheet = this.resolveInitiativeSheet(item);
        if (!sheet) return undefined;
        try { return getInitiativeProfile(sheet); } catch { return undefined; }
      });
      const derivedBonus = profiles.every((profile) => profile !== undefined)
        ? Math.min(...profiles.map((profile) => profile!.bonus))
        : threatBonus;
      const groupId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `threat-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const combatant = normalizeInitiativeCombatant({
        role: "THREAT",
        groupId,
        groupName,
        displayName: groupName,
        threatBonus: derivedBonus,
        modifier,
        initiative: null,
        roll: null,
        surprised,
        availableFromRound: nextRound,
        conditions: [],
        note: "",
        addedAt: now,
      });
      for (const item of tokens) updates.set(item.id, { version: 1, combatant });
    }

    try {
      await OBR.scene.items.updateItems([...updates.keys()], (draftItems) => {
        for (const item of draftItems) {
          const data = updates.get(item.id);
          if (!data) continue;
          item.metadata = item.metadata ?? {};
          item.metadata[INITIATIVE_TOKEN_KEY] = data;
          delete item.metadata[LEGACY_INITIATIVE_TOKEN_KEY];
          delete item.metadata[LEGACY_INITIATIVE_TOKEN_KEY];
        }
      });
      this.pendingInitiativeTokenIds = [];
      this.root.querySelector<HTMLDialogElement>("#initiative-add-dialog")?.close();
      await this.refreshInitiativeData();
      this.toast(role === "THREAT" ? "Grupo de ameaças registrado com um único turno." : `${updates.size} agente(s) vinculado(s) à iniciativa do C.R.I.S.`, "success");
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Não foi possível registrar os envolvidos.", "error");
    }
  }

  private async persistInitiativeEntry(entry: InitiativeEntry, next: InitiativeCombatant): Promise<void> {
    await OBR.scene.items.updateItems(entry.tokenIds, (draftItems) => {
      for (const item of draftItems) {
        item.metadata = item.metadata ?? {};
        item.metadata[INITIATIVE_TOKEN_KEY] = { version: 1, combatant: next };
        delete item.metadata[LEGACY_INITIATIVE_TOKEN_KEY];
      }
    });
    await this.refreshInitiativeData();
  }

  private async rollInitiativeEntries(targets: InitiativeEntry[], message: string): Promise<void> {
    if (this.state.role !== "GM" || !targets.length || this.state.busy) return;
    const invalid = targets.find((entry) => entry.combatant.role === "AGENT" && (!entry.sheet || !entry.profile));
    if (invalid) return this.toast(invalid.initiativeError ?? `A ficha de ${invalid.name} não oferece dados válidos para Iniciativa.`, "warning");

    this.state.busy = true;
    this.render();
    try {
      const rollerName = await OBR.player.getName();
      const updates = new Map<string, { version: 1; combatant: InitiativeCombatant }>();
      const results: RollResult[] = [];

      for (const entry of targets) {
        const modifiers = entry.combatant.modifier === 0
          ? []
          : [{ label: "Modificador situacional", value: entry.combatant.modifier }];
        let request: RollRequest;
        if (entry.combatant.role === "AGENT") {
          request = buildSkillRollRequest(entry.sheet!, entry.profile!.skill, entry.tokenIds[0], undefined, modifiers);
        } else {
          request = {
            id: createRollId(),
            characterId: `threat-${entry.groupId}`,
            characterName: entry.combatant.groupName || entry.name,
            tokenId: entry.tokenIds[0],
            type: "CUSTOM",
            label: "Iniciativa",
            attributeValue: 1,
            skillBonus: effectiveThreatBonus(entry),
            modifiers,
            createdAt: Date.now(),
          };
        }
        const result = performRoll(request, rollerName);
        results.push(result);
        const snapshot = createInitiativeRollSnapshot(
          result.dice,
          result.chosenDie,
          result.attributeValue === 0 ? "lowest" : "highest",
          result.totalBonus,
          result.total,
          result.rollerName,
          `${result.attributeValue === 0 ? "2d20 (menor)" : `${result.attributeValue}d20 (maior)`} ${result.totalBonus >= 0 ? "+" : "−"} ${Math.abs(result.totalBonus)}`,
          result.completedAt,
        );
        const next = normalizeInitiativeCombatant({
          ...entry.combatant,
          initiative: result.total,
          roll: snapshot,
        });
        for (const tokenId of entry.tokenIds) updates.set(tokenId, { version: 1, combatant: next });
      }

      await OBR.scene.items.updateItems([...updates.keys()], (draftItems) => {
        for (const item of draftItems) {
          const data = updates.get(item.id);
          if (!data) continue;
          item.metadata = item.metadata ?? {};
          item.metadata[INITIATIVE_TOKEN_KEY] = data;
        }
      });

      for (const result of results) {
        await OBR.broadcast.sendMessage(ROLL_CHANNEL, {
          version: 1,
          type: "ROLL_COMPLETED",
          result,
        } satisfies RollBroadcastMessage);
        await appendSessionEvent({
          characterId: result.characterId,
          characterName: result.characterName,
          tokenId: result.tokenId,
          kind: "ROLL_COMPLETED",
          field: "Iniciativa",
          after: result.total,
          source: "Owlbear",
          detail: formatRollSummary(result),
          at: result.completedAt,
        });
      }
      this.state.rollResults = [...results.reverse(), ...this.state.rollResults].slice(0, 12);
      await this.refreshSessionEvents();
      await this.refreshInitiativeData();
      await OBR.notification.show(message || "Testes de iniciativa concluídos.", "SUCCESS");
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "A rolagem de iniciativa falhou.", "error");
    } finally {
      this.state.busy = false;
      this.render();
    }
  }

  private async rollInitiative(): Promise<void> {
    const targets = this.state.initiativeScene.started
      ? this.state.initiativeEntries.filter((entry) => !entry.combatant.roll)
      : this.state.initiativeEntries;
    if (!targets.length) return this.toast("Todos os envolvidos já possuem um teste de iniciativa.", "info");
    await this.rollInitiativeEntries(targets, "Iniciativa registrada na ocorrência.");
  }

  private async resolveInitiativeTies(): Promise<void> {
    const tied = findInitiativeTies(this.state.initiativeEntries).flat();
    if (!tied.length) return;
    await this.rollInitiativeEntries(tied, "Empates resolvidos por novas rolagens.");
  }

  private async startInitiativeCombat(): Promise<void> {
    const entries = this.state.initiativeEntries;
    if (!entries.length) return;
    if (entries.some((entry) => !entry.combatant.roll)) {
      return this.toast("Todos os participantes precisam de um teste válido antes do início do combate.", "warning");
    }
    if (findInitiativeTies(entries).length) return this.toast("Resolva todos os empates antes de iniciar.", "warning");
    const first = entries.find((entry) => isInitiativeEligible(entry, 1));
    await this.persistInitiativeScene({
      started: true,
      round: 1,
      activeId: first?.id ?? null,
      changedAt: Date.now(),
    });
    await appendSessionEvent({
      characterName: "Combate",
      kind: "CHARACTER_UPDATED",
      field: "INÍCIO DO COMBATE",
      after: 1,
      source: "Sistema",
      detail: `Combate iniciado com ${entries.length} participante(s).`,
    });
    await this.refreshSessionEvents();
  }

  private async changeInitiativeTurn(direction: number): Promise<void> {
    if (!this.state.initiativeScene.started) return;
    const next = advanceInitiativeTurn(this.state.initiativeEntries, this.state.initiativeScene, direction);
    if (next.activeId === this.state.initiativeScene.activeId && next.round === this.state.initiativeScene.round) return;
    await this.persistInitiativeScene(next);
  }

  private async endInitiativeCombat(): Promise<void> {
    if (!this.state.initiativeScene.started) return;
    if (!window.confirm("Encerrar o combate e manter os resultados dos participantes?")) return;
    await this.persistInitiativeScene({
      ...this.state.initiativeScene,
      started: false,
      round: 1,
      activeId: null,
      changedAt: Date.now(),
    });
    await appendSessionEvent({
      characterName: "Combate",
      kind: "CHARACTER_UPDATED",
      field: "FIM DO COMBATE",
      source: "Sistema",
      detail: "Combate encerrado; os registros de iniciativa foram preservados.",
    });
    await this.refreshSessionEvents();
  }

  private async clearInitiative(): Promise<void> {
    if (!this.state.initiativeEntries.length || !window.confirm("Apagar todos os registros de iniciativa desta cena? As fichas C.R.I.S. e os vínculos dos Tokens serão preservados.")) return;
    const tokenIds = this.state.initiativeEntries.flatMap((entry) => entry.tokenIds);
    await OBR.scene.items.updateItems(tokenIds, (draftItems) => {
      for (const item of draftItems) {
        if (item.metadata) {
          delete item.metadata[INITIATIVE_TOKEN_KEY];
          delete item.metadata[LEGACY_INITIATIVE_TOKEN_KEY];
        }
      }
    });
    await this.persistInitiativeScene({ ...DEFAULT_INITIATIVE_SCENE, changedAt: Date.now() });
    await this.refreshInitiativeData();
    this.toast("Registros de iniciativa removidos. As fichas C.R.I.S. permanecem vinculadas.", "success");
  }

  private async removeInitiativeEntry(id: string): Promise<void> {
    const entry = this.state.initiativeEntries.find((item) => item.id === id);
    if (!entry) return;
    await OBR.scene.items.updateItems(entry.tokenIds, (draftItems) => {
      for (const item of draftItems) {
        if (item.metadata) delete item.metadata[INITIATIVE_TOKEN_KEY];
      }
    });
    await this.refreshInitiativeData();
    if (this.state.initiativeScene.started && this.state.initiativeScene.activeId === id) {
      const next = advanceInitiativeTurn(
        this.state.initiativeEntries,
        { ...this.state.initiativeScene, activeId: null },
        1,
      );
      await this.persistInitiativeScene(next);
    }
  }

  private openInitiativeEditor(id: string): void {
    const entry = this.state.initiativeEntries.find((item) => item.id === id);
    if (!entry) return;
    const get = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector);
    get<HTMLInputElement>("#initiative-edit-id")!.value = id;
    get<HTMLInputElement>("#initiative-edit-modifier")!.value = String(entry.combatant.modifier);
    get<HTMLInputElement>("#initiative-edit-surprised")!.checked = entry.combatant.surprised;
    get<HTMLInputElement>("#initiative-edit-conditions")!.value = entry.combatant.conditions.join(", ");
    get<HTMLTextAreaElement>("#initiative-edit-note")!.value = entry.combatant.note;
    get<HTMLElement>("#initiative-edit-roll-info")!.textContent = entry.combatant.roll
      ? `Resultado atual: ${entry.combatant.initiative}. Alterar o modificador invalida a rolagem e exige novo teste.`
      : "Ainda não existe uma rolagem válida registrada.";
    get<HTMLDialogElement>("#initiative-edit-dialog")?.showModal();
  }

  private async submitInitiativeEdit(event: Event): Promise<void> {
    event.preventDefault();
    const id = this.root.querySelector<HTMLInputElement>("#initiative-edit-id")?.value;
    const entry = this.state.initiativeEntries.find((item) => item.id === id);
    if (!entry) return;
    const modifier = Number(this.root.querySelector<HTMLInputElement>("#initiative-edit-modifier")?.value ?? "0");
    if (!Number.isInteger(modifier) || modifier < -99 || modifier > 99) return this.toast("O modificador precisa ser um inteiro entre -99 e +99.", "warning");
    const surprised = this.root.querySelector<HTMLInputElement>("#initiative-edit-surprised")?.checked ?? false;
    const conditions = (this.root.querySelector<HTMLInputElement>("#initiative-edit-conditions")?.value ?? "")
      .split(",").map((part) => part.trim()).filter(Boolean).slice(0, 12);
    const note = this.root.querySelector<HTMLTextAreaElement>("#initiative-edit-note")?.value.trim() ?? "";
    const mechanicalChange = modifier !== entry.combatant.modifier;
    const next = normalizeInitiativeCombatant({
      ...entry.combatant,
      modifier,
      surprised,
      conditions,
      note,
      ...(mechanicalChange ? { initiative: null, roll: null } : {}),
    });
    await this.persistInitiativeEntry(entry, next);
    this.root.querySelector<HTMLDialogElement>("#initiative-edit-dialog")?.close();
    this.toast(mechanicalChange ? "Modificador atualizado. Role a iniciativa novamente." : "Dossiê tático atualizado.", "success");
  }

  private async toggleInitiativeSurprised(id: string): Promise<void> {
    const entry = this.state.initiativeEntries.find((item) => item.id === id);
    if (!entry) return;
    await this.persistInitiativeEntry(entry, normalizeInitiativeCombatant({
      ...entry.combatant,
      surprised: !entry.combatant.surprised,
    }));
  }

  private async reloadRoomData(): Promise<void> {
    const library = await getRoomLibrary();
    this.state.library = library.sheets;
    if (!this.state.tokenId) return;

    this.state.token = await getTokenById(this.state.tokenId);
    this.state.binding = readTokenBinding(this.state.token);
    if (!this.state.binding) return;

    const binding = this.state.binding;
    const reference = this.state.library.find((entry) => entry.id === binding.sheetId) ?? {
      id: binding.sheetId,
      url: binding.sourceUrl,
      name: binding.displayName || `Agente ${binding.sheetId.slice(0, 6)}`,
      status: "link-only" as const,
      addedAt: binding.boundAt,
    };
    this.state.reference = reference;

    const canView = this.state.role === "GM" || binding.shareWithPlayers;
    this.state.sheet = canView
      ? (persistence.get(binding.sheetId) ?? binding.snapshot)
      : undefined;
    this.state.shareWithPlayers = binding.shareWithPlayers;
    if (binding.snapshot) this.state.lastSyncAt = binding.snapshot.updatedAt;

    // O Mestre consulta a origem ao abrir o Token. Jogadores usam somente
    // o snapshot que o Mestre autorizou a sincronizar na metadata do Token.
    const shouldFetch = this.state.role === "GM" || (binding.shareWithPlayers && !this.state.sheet);
    if (shouldFetch) {
      const cached = this.state.sheet;
      try {
        const result = await connectCrisLink(binding.sourceUrl);
        await this.recordRemoteSheetChanges(cached, result.sheet);
        persistence.save(result.sheet);
        this.state.sheet = result.sheet;
        this.state.lastSyncAt = Date.now();
        this.state.syncStatus = "SYNCED";
        const updatedReference: CrisSheetReference = {
          ...reference,
          name: `Agente ${binding.sheetId.slice(0, 6)}`,
          status: "imported",
          updatedAt: result.sheet.updatedAt,
        };
        this.state.reference = updatedReference;
        if (this.state.role === "GM") {
          await upsertRoomSheet(updatedReference);
          if (binding.shareWithPlayers) {
            await syncSharedSnapshotsForSheet(binding.sheetId, result.sheet);
            this.state.binding = await this.getUpdatedBinding();
          }
          this.state.library = (await getRoomLibrary()).sheets;
          await syncConditionMarkers("GM");
        }
      } catch (error) {
        this.state.syncStatus = isCrisNetworkFailure(error) ? "OFFLINE" : "ERROR";
        if (cached) {
          this.state.sheet = cached;
          this.state.toast = {
            message: "Não foi possível atualizar o C.R.I.S. Exibindo a última cópia disponível.",
            kind: "warning",
          };
        } else {
          this.state.toast = {
            message: error instanceof Error ? error.message : "Não foi possível consultar esta ficha.",
            kind: "error",
          };
        }
      }
    }
  }

  private render(): void {
    this.root.innerHTML = renderApp(this.state);
  }

  private toast(message: string, kind: NonNullable<AppState["toast"]>["kind"]): void {
    this.state.toast = { message, kind };
    this.render();
  }

  private async handleSubmit(event: Event): Promise<void> {
    if (!(event.target instanceof HTMLFormElement)) return;
    if (event.target.id === "initiative-add-form") {
      await this.submitInitiativeAdd(event);
      return;
    }
    if (event.target.id === "initiative-edit-form") {
      await this.submitInitiativeEdit(event);
      return;
    }
    if (event.target.id !== "connect-form") return;
    event.preventDefault();
    if (this.state.role !== "GM") return this.toast("Somente o Mestre pode cadastrar fichas.", "error");
    const input = this.root.querySelector<HTMLInputElement>("#cris-url");
    if (!input) return;
    this.sourceUrl = input.value;
    await this.connect(this.sourceUrl);
  }

  private async connect(url: string): Promise<void> {
    this.setBusy(true);
    try {
      const result = await connectCrisLink(url);
      const sheet = result.sheet;
      persistence.save(sheet);

      // O nome real fica no cache local; a biblioteca sincronizada mantém um rótulo neutro.
      const reference: CrisSheetReference = {
        id: result.link.id,
        url: result.link.url,
        name: `Agente ${result.link.id.slice(0, 6)}`,
        status: "imported",
        addedAt: Date.now(),
        updatedAt: sheet.updatedAt,
      };
      await upsertRoomSheet(reference);

      this.state.reference = reference;
      this.state.sheet = sheet;
      this.state.library = (await getRoomLibrary()).sheets;
      this.state.activeTab = "overview";
      this.state.mode = "token";

      if (this.state.tokenId) {
        await bindTokenToSheet(this.state.tokenId, reference, this.state.shareWithPlayers, sheet);
        this.state.binding = await this.getUpdatedBinding();
        this.state.mode = "token";
      }
      this.state.syncStatus = "SYNCED";
      this.state.lastSyncAt = Date.now();
      await this.refreshInitiativeData();
      this.toast(result.message, "success");
      this.startPolling();
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Não foi possível consultar a ficha do C.R.I.S.", "error");
    } finally {
      this.setBusy(false);
    }
  }

  private async refreshCurrentSheet(): Promise<void> {
    await this.syncRemoteSheet(true);
  }

  private startPolling(): void {
    if (
      this.pollTimer !== undefined ||
      this.state.role !== "GM" ||
      this.state.mode === "library" ||
      !this.state.reference ||
      document.hidden
    ) return;

    this.pollTimer = window.setInterval(() => {
      void this.syncRemoteSheet(false);
    }, this.state.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private applyIncomingSnapshot(snapshot: CharacterSheet): void {
    const previous = this.state.sheet ?? persistence.get(snapshot.id);
    const reconciliation = reconcileRemoteSheet(previous, snapshot);
    if (!reconciliation.changed) {
      if (!this.state.sheet && reconciliation.sheet) {
        this.state.sheet = reconciliation.sheet;
        this.render();
      }
      return;
    }

    const deltas = diffResourceValues(previous?.resources, snapshot.resources);
    const timestamp = Date.now();
    this.state.sheet = reconciliation.sheet;
    this.state.lastSyncAt = timestamp;
    this.state.syncStatus = "REMOTE_CHANGE";
    if (deltas.length) {
      this.state.syncHistory = [
        ...deltas.map((delta) => ({ ...delta, source: "C.R.I.S." as const, at: timestamp })),
        ...this.state.syncHistory,
      ].slice(0, 30);
    }
    persistence.save(reconciliation.sheet);
    void this.refreshInitiativeData();
    void syncConditionMarkers(this.state.role);
    this.render();
  }

  private handleSceneItemsChanged(items: SceneItem[]): void {
    void this.refreshInitiativeData(items);
    if (!this.state.tokenId) return;
    const item = items.find((candidate) => candidate.id === this.state.tokenId);
    if (!item) {
      if (this.state.binding) {
        persistence.remove(this.state.binding.sheetId);
        this.state.binding = undefined;
        this.state.reference = undefined;
        this.state.sheet = undefined;
        this.state.token = undefined;
        this.state.mode = "library";
        this.stopPolling();
        void syncConditionMarkers(this.state.role);
        this.toast("O Token vinculado foi removido da cena. A associação local foi encerrada.", "warning");
      }
      return;
    }

    const nextBinding = readTokenBinding(item);
    if (!nextBinding) {
      if (this.state.binding) {
        this.state.binding = undefined;
        this.state.sheet = undefined;
        this.state.reference = undefined;
        this.stopPolling();
        this.state.syncStatus = "ERROR";
        void syncConditionMarkers(this.state.role);
        this.toast("O vínculo desta ficha foi removido do Token.", "warning");
      }
      return;
    }

    this.state.binding = nextBinding;
    this.state.shareWithPlayers = nextBinding.shareWithPlayers;
    this.state.reference = this.state.library.find((entry) => entry.id === nextBinding.sheetId) ?? {
      id: nextBinding.sheetId,
      url: nextBinding.sourceUrl,
      name: nextBinding.displayName || `Agente ${nextBinding.sheetId.slice(0, 6)}`,
      status: nextBinding.snapshot ? "imported" : "link-only",
      addedAt: nextBinding.boundAt,
      ...(nextBinding.snapshot ? { updatedAt: nextBinding.snapshot.updatedAt } : {}),
    };
    if (this.state.role === "PLAYER" && !nextBinding.shareWithPlayers) {
      this.state.sheet = undefined;
      persistence.remove(nextBinding.sheetId);
      void syncConditionMarkers(this.state.role);
      this.render();
      return;
    }

    if (nextBinding.snapshot) {
      this.applyIncomingSnapshot(nextBinding.snapshot);
    }
    void syncConditionMarkers(this.state.role);
  }

  private async syncRemoteSheet(manual: boolean): Promise<void> {
    if (this.syncInFlight) return;
    if (this.state.role !== "GM") {
      if (manual) this.toast("Somente o Mestre pode consultar a origem. Jogadores recebem atualizações pela metadata compartilhada do Token.", "warning");
      return;
    }

    const reference = this.state.reference ?? (this.state.binding ? {
      id: this.state.binding.sheetId,
      url: this.state.binding.sourceUrl,
      name: this.state.binding.displayName,
      status: "link-only" as const,
      addedAt: this.state.binding.boundAt,
    } : undefined);
    if (!reference) {
      if (manual) this.toast("Nenhuma ficha está vinculada para atualizar.", "warning");
      return;
    }

    const cached = this.state.sheet ?? persistence.get(reference.id);
    const previousStatus = this.state.syncStatus;
    this.syncInFlight = true;
    this.state.syncStatus = "SYNCING";
    if (manual) {
      this.setBusy(true);
      this.render();
    }

    try {
      const result = await connectCrisLink(reference.url);
      const reconciliation = reconcileRemoteSheet(cached, result.sheet);
      const timestamp = Date.now();

      if (reconciliation.changed) {
        const deltas = diffResourceValues(cached?.resources, result.sheet.resources);
        await this.recordRemoteSheetChanges(cached, reconciliation.sheet);
        this.state.sheet = reconciliation.sheet;
        persistence.save(reconciliation.sheet);
        this.state.syncStatus = "REMOTE_CHANGE";
        if (deltas.length) {
          this.state.syncHistory = [
            ...deltas.map((delta) => ({ ...delta, source: "C.R.I.S." as const, at: timestamp })),
            ...this.state.syncHistory,
          ].slice(0, 30);
        }

        const updatedReference: CrisSheetReference = {
          ...reference,
          status: "imported",
          updatedAt: result.sheet.updatedAt,
        };
        this.state.reference = updatedReference;
        await upsertRoomSheet(updatedReference);
        await syncSharedSnapshotsForSheet(reference.id, reconciliation.sheet);
        await syncConditionMarkers("GM");
        this.state.library = (await getRoomLibrary()).sheets;
      } else {
        if (!this.state.sheet && reconciliation.sheet) {
          this.state.sheet = reconciliation.sheet;
          persistence.save(reconciliation.sheet);
        }
        this.state.syncStatus = "SYNCED";
      }

      this.state.lastSyncAt = timestamp;
      if (manual && reconciliation.changed) {
        this.toast("Ficha atualizada.", "success");
      } else if (manual || reconciliation.changed || previousStatus !== this.state.syncStatus) {
        this.render();
      }
    } catch (error) {
      this.state.syncStatus = isCrisNetworkFailure(error) ? "OFFLINE" : "ERROR";
      if (this.state.reference?.id === reference.id && this.state.role === "GM") {
        try {
          await appendSessionEvent({
            characterId: reference.id,
            characterName: cached?.identity.name ?? reference.name,
            tokenId: this.state.tokenId,
            kind: "SYNC_ERROR",
            source: "Sistema",
            detail: error instanceof Error ? error.message : "Falha ao consultar o C.R.I.S.",
          });
          await this.refreshSessionEvents();
        } catch {
          // A falha de auditoria não deve encobrir a falha da consulta principal.
        }
      }
      if (manual) {
        this.toast(
          cached
            ? "Não foi possível sincronizar. Mantive a última versão confirmada do C.R.I.S."
            : (error instanceof Error ? error.message : "Não foi possível consultar o C.R.I.S."),
          "warning",
        );
      } else if (previousStatus !== this.state.syncStatus) {
        this.render();
      }
    } finally {
      this.syncInFlight = false;
      if (manual) this.setBusy(false);
    }
  }

  private async refreshSessionEvents(): Promise<void> {
    try {
      const history = await getSessionHistory();
      this.state.sessionEvents = history.events;
      if (this.state.activeTab === "history" || this.state.mode === "master") this.render();
    } catch (error) {
      console.warn("Sistema C.R.I.S. — não foi possível atualizar o histórico da cena", error);
    }
  }

  private async recordRemoteSheetChanges(previous: CharacterSheet | undefined, incoming: CharacterSheet): Promise<void> {
    if (!previous) return;
    const deltas = diffResourceValues(previous.resources, incoming.resources);
    for (const delta of deltas) {
      await appendSessionEvent({
        characterId: incoming.id,
        characterName: incoming.identity.name,
        tokenId: this.state.tokenId,
        kind: "RESOURCE_CHANGED",
        field: delta.resource.toUpperCase(),
        before: delta.previous,
        after: delta.current,
        source: "C.R.I.S.",
      });
    }

    const beforeConditions = new Map((previous.conditions ?? []).map((condition) => [condition.name.toLocaleLowerCase("pt-BR"), condition]));
    const afterConditions = new Map((incoming.conditions ?? []).map((condition) => [condition.name.toLocaleLowerCase("pt-BR"), condition]));
    for (const [key, condition] of afterConditions) {
      if (!beforeConditions.has(key)) {
        await appendSessionEvent({
          characterId: incoming.id,
          characterName: incoming.identity.name,
          tokenId: this.state.tokenId,
          kind: "CONDITION_ADDED",
          field: condition.name,
          source: "C.R.I.S.",
          detail: condition.description ?? condition.duration,
        });
      }
    }
    for (const [key, condition] of beforeConditions) {
      if (!afterConditions.has(key)) {
        await appendSessionEvent({
          characterId: incoming.id,
          characterName: incoming.identity.name,
          tokenId: this.state.tokenId,
          kind: "CONDITION_REMOVED",
          field: condition.name,
          source: "C.R.I.S.",
        });
      }
    }
    if (deltas.length || beforeConditions.size !== afterConditions.size) await this.refreshSessionEvents();
  }

  private async refreshMasterRoster(force: boolean): Promise<void> {
    if (this.state.role !== "GM" || this.masterInFlight) return;
    this.masterInFlight = true;
    this.state.masterBusy = true;
    if (this.state.mode === "master") this.render();
    try {
      this.state.masterRoster = await loadMasterRoster(force);
      await syncConditionMarkers(this.state.role);
      await this.refreshSessionEvents();
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Não foi possível carregar o painel do grupo.", "error");
    } finally {
      this.masterInFlight = false;
      this.state.masterBusy = false;
      if (this.state.mode === "master") this.render();
    }
  }

  private startMasterPolling(): void {
    if (this.masterTimer !== undefined || this.state.mode !== "master" || this.state.role !== "GM" || document.hidden) return;
    this.masterTimer = window.setInterval(() => {
      void this.refreshMasterRoster(false);
    }, Math.max(30_000, this.state.pollIntervalMs));
  }

  private stopMasterPolling(): void {
    if (this.masterTimer === undefined) return;
    window.clearInterval(this.masterTimer);
    this.masterTimer = undefined;
  }

  private beginAttributeRoll(attribute: "AGI" | "FOR" | "INT" | "PRE" | "VIG"): void {
    if (!this.state.sheet) return this.toast("Abra uma ficha antes de rolar um atributo.", "warning");
    try {
      this.state.pendingRoll = buildAttributeRollRequest(this.state.sheet, attribute, this.state.tokenId);
      this.state.rolling = false;
      this.render();
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Não foi possível preparar o teste.", "error");
    }
  }

  private beginSkillRoll(index: number): void {
    const skill = this.state.sheet?.skills?.[index];
    if (!this.state.sheet || !skill) return this.toast("A perícia selecionada não está disponível.", "warning");
    try {
      this.state.pendingRoll = buildSkillRollRequest(this.state.sheet, skill, this.state.tokenId);
      this.state.rolling = false;
      this.render();
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Não foi possível preparar o teste.", "error");
    }
  }

  private async submitRoll(): Promise<void> {
    const pending = this.state.pendingRoll;
    if (!pending || this.state.rolling) return;
    const dtText = this.root.querySelector<HTMLInputElement>("#roll-dt")?.value.trim() ?? "";
    const modifierText = this.root.querySelector<HTMLInputElement>("#roll-modifier")?.value.trim() ?? "0";
    const difficulty = dtText === "" ? undefined : Number(dtText);
    const modifier = modifierText === "" ? 0 : Number(modifierText);
    if (difficulty !== undefined && (!Number.isInteger(difficulty) || difficulty < 0)) {
      return this.toast("Informe uma DT inteira igual ou maior que zero.", "warning");
    }
    if (!Number.isFinite(modifier) || !Number.isInteger(modifier)) {
      return this.toast("O modificador adicional precisa ser um número inteiro.", "warning");
    }

    const request: RollRequest = {
      ...pending,
      ...(difficulty !== undefined ? { difficulty } : { difficulty: undefined }),
      modifiers: modifier === 0
        ? pending.modifiers
        : [...pending.modifiers, { label: "Modificador manual", value: modifier }],
    };
    this.state.pendingRoll = request;
    this.state.rolling = true;
    this.render();
    await sleep(650);

    try {
      const rollerName = await OBR.player.getName();
      const result = performRoll(request, rollerName);
      this.state.rolling = false;
      this.state.pendingRoll = undefined;
      this.state.rollResults = [result, ...this.state.rollResults].slice(0, 12);

      await OBR.broadcast.sendMessage(ROLL_CHANNEL, {
        version: 1,
        type: "ROLL_COMPLETED",
        result,
      } satisfies RollBroadcastMessage);

      if (this.state.role === "GM") {
        await appendSessionEvent({
          characterId: result.characterId,
          characterName: result.characterName,
          tokenId: result.tokenId,
          kind: "ROLL_COMPLETED",
          field: result.label,
          after: result.total,
          source: "Owlbear",
          detail: formatRollSummary(result),
          at: result.completedAt,
        });
        await this.refreshSessionEvents();
      }

      await OBR.notification.show(formatRollSummary(result), result.outcome === "FAILURE" ? "WARNING" : "SUCCESS");
    } catch (error) {
      this.state.rolling = false;
      this.toast(error instanceof Error ? error.message : "A rolagem não pôde ser distribuída.", "error");
    }
    this.render();
  }

  private async getUpdatedBinding(): Promise<TokenBinding | undefined> {
    if (!this.state.tokenId) return undefined;
    return readTokenBinding(await getTokenById(this.state.tokenId));
  }

  private async handleClick(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action],button[data-tab]");
    if (!button || button.disabled) return;
    const tab = button.dataset.tab as ViewTab | undefined;
    if (tab) {
      this.state.activeTab = tab;
      this.render();
      return;
    }
    const action = button.dataset.action;
    const sheetId = button.dataset.sheetId;
    try {
      switch (action) {
        case "open-initiative": {
          this.state.mode = "initiative";
          if (this.state.role === "GM") this.state.masterRoster = await loadMasterRoster(false);
          await this.refreshInitiativeData();
          break;
        }
        case "initiative-add-selected":
          await this.openInitiativeAddDialog();
          break;
        case "initiative-close-add":
          this.root.querySelector<HTMLDialogElement>("#initiative-add-dialog")?.close();
          break;
        case "initiative-close-edit":
          this.root.querySelector<HTMLDialogElement>("#initiative-edit-dialog")?.close();
          break;
        case "initiative-roll":
          await this.rollInitiative();
          break;
        case "initiative-resolve-ties":
          await this.resolveInitiativeTies();
          break;
        case "initiative-start":
          await this.startInitiativeCombat();
          break;
        case "initiative-next":
          await this.changeInitiativeTurn(1);
          break;
        case "initiative-previous":
          await this.changeInitiativeTurn(-1);
          break;
        case "initiative-end":
          await this.endInitiativeCombat();
          break;
        case "initiative-clear":
          await this.clearInitiative();
          break;
        case "initiative-edit":
          if (button.dataset.id) this.openInitiativeEditor(button.dataset.id);
          break;
        case "initiative-toggle-surprised":
          if (button.dataset.id) await this.toggleInitiativeSurprised(button.dataset.id);
          break;
        case "initiative-remove":
          if (this.state.role === "GM" && button.dataset.id) await this.removeInitiativeEntry(button.dataset.id);
          break;
        case "initiative-activate": {
          if (this.state.role !== "GM" || !button.dataset.id) return;
          if (!this.state.initiativeScene.started) return this.toast("Inicie o combate antes de ativar um turno.", "warning");
          const next = selectInitiativeTurn(this.state.initiativeEntries, this.state.initiativeScene, button.dataset.id);
          if (next.activeId !== button.dataset.id) return this.toast("Este participante não pode agir nesta rodada.", "warning");
          await this.persistInitiativeScene(next);
          break;
        }
        case "master-panel": {
          if (this.state.role !== "GM") return this.toast("O painel de operação é exclusivo do Mestre.", "error");
          this.stopPolling();
          this.state.mode = "master";
          this.state.tokenId = undefined;
          this.state.token = undefined;
          this.state.binding = undefined;
          this.state.reference = undefined;
          this.state.sheet = undefined;
          this.state.masterFilter = "ALL";
          await this.refreshMasterRoster(true);
          this.startMasterPolling();
          break;
        }
        case "refresh-roster": {
          if (this.state.role !== "GM") return;
          await this.refreshMasterRoster(true);
          break;
        }
        case "locate-token": {
          const tokenId = button.dataset.tokenId;
          if (!tokenId) return;
          await locateToken(tokenId);
          break;
        }
        case "open-roster-token": {
          const tokenId = button.dataset.tokenId;
          const entry = this.state.masterRoster.find((item) => item.tokenId === tokenId);
          if (!tokenId || !entry) return;
          this.stopMasterPolling();
          this.state.tokenId = tokenId;
          this.state.token = await getTokenById(tokenId);
          this.state.binding = entry.binding;
          this.state.reference = {
            id: entry.binding.sheetId,
            url: entry.binding.sourceUrl,
            name: entry.binding.displayName,
            status: entry.sheet ? "imported" : "link-only",
            addedAt: entry.binding.boundAt,
            ...(entry.sheet ? { updatedAt: entry.sheet.updatedAt } : {}),
          };
          this.state.sheet = entry.sheet ?? persistence.get(entry.binding.sheetId);
          this.state.shareWithPlayers = entry.binding.shareWithPlayers;
          this.state.mode = "token";
          this.state.activeTab = "overview";
          await this.refreshCurrentSheet();
          this.startPolling();
          break;
        }
        case "open-sheet": {
          if (!sheetId) return;
          this.stopMasterPolling();
          this.state.reference = this.state.library.find((entry) => entry.id === sheetId);
          this.state.sheet = persistence.get(sheetId);
          this.state.mode = "token";
          this.state.tokenId = undefined;
          this.state.binding = undefined;
          this.state.activeTab = "overview";
          if (this.state.role === "GM") await this.refreshCurrentSheet();
          this.render();
          this.startPolling();
          break;
        }
        case "bind-selected": {
          if (!sheetId || this.state.role !== "GM") return;
          const selected = await getCurrentSelection();
          if (selected.length !== 1) return this.toast("Selecione exatamente um Token na camada de personagens.", "warning");
          const reference = this.state.library.find((entry) => entry.id === sheetId);
          if (!reference) return;
          const sheet = persistence.get(sheetId) ?? (await connectCrisLink(reference.url)).sheet;
          persistence.save(sheet);
          await bindTokenToSheet(selected[0].id, reference, false, sheet);
          this.toast(`Ficha associada ao Token ${selected[0].name ?? "selecionado"}.`, "success");
          break;
        }
        case "refresh-sheet":
          await this.refreshCurrentSheet();
          break;
        case "start-attribute-roll": {
          const attribute = button.dataset.attribute;
          if (attribute === "AGI" || attribute === "FOR" || attribute === "INT" || attribute === "PRE" || attribute === "VIG") {
            this.beginAttributeRoll(attribute);
          }
          break;
        }
        case "start-skill-roll": {
          const index = Number(button.dataset.skillIndex);
          if (!Number.isInteger(index) || index < 0) return;
          this.beginSkillRoll(index);
          break;
        }
        case "confirm-roll":
          await this.submitRoll();
          break;
        case "cancel-roll":
          this.state.pendingRoll = undefined;
          this.state.rolling = false;
          break;
        case "remove-sheet": {
          if (!sheetId || this.state.role !== "GM") return;
          const reference = this.state.library.find((entry) => entry.id === sheetId);
          if (!reference) return;
          if (!window.confirm(`Remover ${reference.name} da sala e desvincular todos os Tokens associados?`)) return;
          await unbindAllTokensForSheet(sheetId);
          await removeRoomSheet(sheetId);
          persistence.remove(sheetId);
          this.state.library = (await getRoomLibrary()).sheets;
          if (this.state.reference?.id === sheetId) {
            this.state.reference = undefined;
            this.state.sheet = undefined;
            this.state.binding = undefined;
            this.state.mode = "library";
            this.stopPolling();
            this.stopMasterPolling();
          }
          this.toast("Ficha removida da sala e dos Tokens associados.", "success");
          break;
        }
        case "open-source": {
          const url = this.state.reference?.url ?? this.state.binding?.sourceUrl;
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          break;
        }
        case "save-sharing": {
          if (!this.state.tokenId || !this.state.sheet) return this.toast("Abra um Token com ficha vinculada antes de alterar o compartilhamento.", "warning");
          const checkbox = this.root.querySelector<HTMLInputElement>("#share-toggle");
          this.state.shareWithPlayers = checkbox?.checked ?? false;
          await updateTokenSnapshot(this.state.tokenId, this.state.sheet, this.state.shareWithPlayers);
          this.state.binding = await this.getUpdatedBinding();
          if (this.state.shareWithPlayers) await syncSharedSnapshotsForSheet(this.state.binding?.sheetId ?? this.state.sheet.id, this.state.sheet);
          this.toast(this.state.shareWithPlayers ? "Cópia do dossiê compartilhada com a sala." : "Dados detalhados mantidos somente neste navegador.", "success");
          break;
        }
        case "recheck": {
          await this.refreshCurrentSheet();
          break;
        }
        case "unbind": {
          if (!this.state.tokenId || this.state.role !== "GM") return;
          await unbindToken(this.state.tokenId);
          this.state.binding = undefined;
          this.state.sheet = undefined;
          this.state.reference = undefined;
          this.state.mode = "bind";
          this.toast("Vínculo removido do Token. A ficha continua cadastrada no arquivo da sala.", "success");
          break;
        }
        case "back-library":
          this.stopPolling();
          this.stopMasterPolling();
          this.state.mode = "library";
          this.state.tokenId = undefined;
          this.state.token = undefined;
          this.state.binding = undefined;
          this.state.reference = undefined;
          this.state.sheet = undefined;
          break;
        default:
          return;
      }
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "A operação não pôde ser concluída.", "error");
    }
    this.render();
  }

  private handleChange(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === "share-toggle") {
      this.state.shareWithPlayers = target.checked;
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "sync-interval") {
      const nextInterval = Number(target.value);
      if (!ALLOWED_SYNC_INTERVALS.includes(nextInterval as (typeof ALLOWED_SYNC_INTERVALS)[number])) return;
      this.state.pollIntervalMs = nextInterval;
      saveSyncInterval(nextInterval);
      this.stopPolling();
      this.startPolling();
      this.stopMasterPolling();
      this.startMasterPolling();
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "roster-search") {
      this.state.masterQuery = target.value;
      this.render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "roster-filter") {
      const filter = target.value as RosterFilter;
      if (["ALL", "ALIVE", "INCAPACITATED", "INJURED", "CONDITIONS", "ERROR"].includes(filter)) {
        this.state.masterFilter = filter;
        this.render();
      }
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "history-character") {
      this.state.historyCharacterFilter = target.value;
      this.render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "history-kind") {
      this.state.historyKindFilter = target.value;
      this.render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "history-source") {
      this.state.historySourceFilter = target.value;
      this.render();
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "history-from") {
      this.state.historyFromTime = target.value;
      this.render();
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "history-to") {
      this.state.historyToTime = target.value;
      this.render();
    }
  }

  private setBusy(busy: boolean): void {
    this.state.busy = busy;
    const button = this.root.querySelector<HTMLButtonElement>(
      '#connect-form button[type="submit"], button[data-action="refresh-sheet"]',
    );
    if (button) {
      button.disabled = busy;
      button.textContent = busy
        ? "CONSULTANDO..."
        : button.dataset.action === "refresh-sheet"
          ? "ATUALIZAR FICHA AGORA"
          : this.state.mode === "bind" ? "VINCULAR E CARREGAR" : "CONECTAR FICHA";
    }
  }
}

export function mountApp(): void {
  if (!root) throw new Error("Elemento #app não encontrado.");
  const app = new CrisApp(root);
  OBR.onReady(() => {
    void app.initialize().catch((error) => {
      console.error("Sistema C.R.I.S. — erro ao iniciar", error);
      root.innerHTML = `<div class="fatal-state"><strong>FALHA AO INICIAR O ARQUIVO</strong><p>Recarregue a extensão no Owlbear Rodeo. Se o erro persistir, consulte o README.</p></div>`;
    });
  });
}
