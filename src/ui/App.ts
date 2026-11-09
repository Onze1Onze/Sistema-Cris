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

const root = document.querySelector<HTMLDivElement>("#app");
const PAGES_BASE = "/Sistema-Cris/";

type ViewTab = "overview" | "combat" | "skills" | "gear" | "settings";

interface SyncHistoryEntry extends ResourceDelta {
  source: "C.R.I.S.";
  at: number;
}

interface AppState {
  role: "GM" | "PLAYER";
  mode: "library" | "token" | "bind";
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

function renderHeader(state: AppState): string {
  const modeLabel = state.role === "GM" ? "ACESSO DO MESTRE" : "ACESSO DO JOGADOR";
  return `<header class="topbar">
    <div class="brand-seal" aria-hidden="true"><span>✦</span><i></i></div>
    <div class="brand-copy"><div class="micro-label">ORDEM REALITAS // ARQUIVO DIGITAL</div><div class="brand-title">SISTEMA <b>C.R.I.S.</b></div></div>
    <div class="header-stamp"><span class="status-light"></span><span>${modeLabel}</span></div>
  </header>
  <div class="subbar"><span>REGISTRO DE AGENTES</span><span>///</span><span>INTERFACE DE CAMPO v1.1</span></div>`;
}

function renderNavigation(active: ViewTab): string {
  const tabs: Array<[ViewTab, string, string]> = [
    ["overview", "◈", "PERSONAGEM"],
    ["combat", "⚔", "COMBATE"],
    ["gear", "▤", "EQUIPAMENTO"],
    ["skills", "✦", "PERÍCIAS"],
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
    `<div class="attribute"><span>${key}</span><strong>${escapeHtml(attributes[key])}</strong></div>`
  ).join("")}</div>`;
}

function renderSkills(sheet: CharacterSheet, limit?: number): string {
  const list = limit ? sheet.skills?.slice(0, limit) : sheet.skills;
  if (!list?.length) return `<p class="muted-note">Nenhuma perícia encontrada nesta ficha.</p>`;
  return `<div class="data-list">${list.map((skill) => {
    const bonus = typeof skill.bonus === "number" && skill.bonus > 0 ? `+${skill.bonus}` : display(skill.bonus, "—");
    return `<div class="data-row"><span class="data-icon">⌁</span><div class="data-copy"><strong>${display(skill.name)}</strong><small>${display(skill.attribute, "ATRIBUTO N/D")}${skill.training ? ` · ${display(skill.training)}` : ""}</small></div><b class="data-value">${bonus}</b></div>`;
  }).join("")}</div>`;
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
    <section class="section-block"><div class="section-title"><span>05</span><h2>ARMAS E ATAQUES</h2><i></i></div>
      ${combat?.attacks?.length ? `<div class="data-list">${combat.attacks.map((attack) => `<article class="detail-row"><strong>${display(attack.name)}</strong><small>${[attack.test, attack.damage, attack.critical, attack.range].filter(Boolean).map(escapeHtml).join(" · ")}</small>${attack.effects ? `<p>${display(attack.effects)}</p>` : ""}</article>`).join("")}</div>` : `<p class="muted-note">Nenhum ataque importado.</p>`}
    </section>`;
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
    case "skills": return `<section class="section-block"><div class="section-title"><span>12</span><h2>TODAS AS PERÍCIAS IMPORTADAS</h2><i></i></div>${renderSkills(state.sheet)}</section>`;
    case "gear": return renderGear(state.sheet);
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
    <p class="helper-text">Ao conectar, a extensão busca automaticamente os dados públicos da ficha e preenche o dossiê. Nenhum JSON manual é necessário.</p>
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

function renderLibrary(state: AppState): string {
  const cards = state.library.map((reference) => renderLibraryCard(reference, persistence.get(reference.id), state)).join("");
  return `<section class="connect-panel">
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

function renderApp(state: AppState): string {
  const title = state.mode === "library" ? "ARQUIVO DA SALA" : state.mode === "bind" ? "VINCULAR TOKEN" : "DOSSIÊ DO AGENTE";
  const header = renderHeader(state);
  const body = state.mode === "library" ? renderLibrary(state) : state.sheet ? `<section class="dossier-heading"><button class="text-back" data-action="back-library">← ARQUIVO DA SALA</button><div class="micro-label">${title} ${state.token ? `// ${escapeHtml(state.token.name ?? "TOKEN")}` : ""}</div><h1>Ficha do Personagem</h1><p>Registro de campo associado ao C.R.I.S.</p></section>${renderNavigation(state.activeTab)}<main class="sheet-content">${renderSheetContent(state)}</main>` : `<section class="dossier-heading"><button class="text-back" data-action="back-library">← ARQUIVO DA SALA</button><div class="micro-label">${title}</div><h1>Vincular ficha ao Token</h1><p>${escapeHtml(state.token?.name ?? "Token selecionado")}</p></section><main class="sheet-content">${renderNoSnapshot(state)}</main>`;
  return `<div class="app-shell">${header}<main class="content">${renderSyncBanner(state)}${body}${renderToast(state.toast)}</main><footer class="app-footer"><span>CRIS // OBR EXTENSION</span><span>V1.2.0 · ${state.role}</span></footer></div>`;
}

export class CrisApp {
  private state: AppState;
  private root: HTMLDivElement;
  private sourceUrl = "";
  private pollTimer?: number;
  private syncInFlight = false;
  private unsubscribeSceneItems?: () => void;
  private readonly visibilityHandler = (): void => {
    if (document.hidden) this.stopPolling();
    else this.startPolling();
  };
  private readonly pageHideHandler = (): void => {
    this.stopPolling();
    this.unsubscribeSceneItems?.();
    this.unsubscribeSceneItems = undefined;
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    window.removeEventListener("pagehide", this.pageHideHandler);
  };

  constructor(element: HTMLDivElement) {
    this.root = element;
    const query = new URLSearchParams(window.location.search);
    const modeParam = query.get("mode");
    const mode: AppState["mode"] = modeParam === "token" ? "token" : modeParam === "bind" ? "bind" : "library";
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
    await this.reloadRoomData();
    this.unsubscribeSceneItems = OBR.scene.items.onChange((items) => this.handleSceneItemsChanged(items));
    await registerContextMenu();
    this.render();
    this.startPolling();
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
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "connect-form") return;
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
    this.render();
  }

  private handleSceneItemsChanged(items: SceneItem[]): void {
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
      this.render();
      return;
    }

    if (nextBinding.snapshot) {
      this.applyIncomingSnapshot(nextBinding.snapshot);
    }
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
        this.state.library = (await getRoomLibrary()).sheets;
      } else {
        if (!this.state.sheet && reconciliation.sheet) {
          this.state.sheet = reconciliation.sheet;
          persistence.save(reconciliation.sheet);
        }
        this.state.syncStatus = "SYNCED";
      }

      this.state.lastSyncAt = timestamp;
      if (manual) {
        this.toast(
          reconciliation.changed
            ? "Ficha consultada e atualizada com os dados confirmados pelo C.R.I.S."
            : "Consulta concluída. Nenhum campo mudou no C.R.I.S.",
          "success",
        );
      } else if (reconciliation.changed || previousStatus !== this.state.syncStatus) {
        this.render();
      }
    } catch (error) {
      this.state.syncStatus = isCrisNetworkFailure(error) ? "OFFLINE" : "ERROR";
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
        case "open-sheet": {
          if (!sheetId) return;
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
