import { connectCrisLink, validateCrisUrl } from "../cris/crisClient";
import { parseCharacterJson } from "../cris/crisParser";
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
  unbindAllTokensForSheet,
} from "../owlbear/tokenBinding";

const root = document.querySelector<HTMLDivElement>("#app");
const PAGES_BASE = "/Sistema-Cris/";

type ViewTab = "overview" | "combat" | "skills" | "gear" | "settings";

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

function resourceLabel(key: ResourceKey): string {
  return ({ pv: "PONTOS DE VIDA", pe: "PONTOS DE ESFORÇO", san: "SANIDADE" })[key];
}

function resourceCard(key: ResourceKey, current: number, max: number): string {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const barColor = key === "pv" ? "red" : key === "pe" ? "violet" : "silver";
  return `<article class="resource-card">
    <div class="resource-head"><span>${resourceLabel(key)}</span><strong>${escapeHtml(current)} <i>/</i> ${escapeHtml(max)}</strong></div>
    <div class="resource-track"><span class="${barColor}" style="width:${percentage}%"></span></div>
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

function renderHeader(state: AppState): string {
  const modeLabel = state.role === "GM" ? "ACESSO DO MESTRE" : "ACESSO DO JOGADOR";
  return `<header class="topbar">
    <div class="brand-seal" aria-hidden="true"><span>✦</span><i></i></div>
    <div class="brand-copy"><div class="micro-label">ORDEM REALITAS // ARQUIVO DIGITAL</div><div class="brand-title">SISTEMA <b>C.R.I.S.</b></div></div>
    <div class="header-stamp"><span class="status-light"></span><span>${modeLabel}</span></div>
  </header>
  <div class="subbar"><span>REGISTRO DE AGENTES</span><span>///</span><span>INTERFACE DE CAMPO v1.0</span></div>`;
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
  if (!list?.length) return `<p class="muted-note">Nenhuma perícia importada.</p>`;
  return `<div class="data-list">${list.map((skill) => `<div class="data-row"><span class="data-icon">⌁</span><div class="data-copy"><strong>${display(skill.name)}</strong><small>${display(skill.attribute, "ATRIBUTO N/D")}${skill.training ? ` · ${display(skill.training)}` : ""}</small></div><b class="data-value">${display(skill.bonus, "—")}</b></div>`).join("")}</div>`;
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
  return `<section class="section-block"><div class="section-title"><span>09</span><h2>ORIGEM DO REGISTRO</h2><i></i></div>
    <div class="source-box"><div class="source-status"><span class="status-light"></span><strong>LINK C.R.I.S. VALIDADO</strong></div>
      <p>${display(reference?.url ?? state.binding?.sourceUrl)}</p>
      <small>O endereço foi reconhecido. A leitura automática não está ativa porque não foi localizada uma API pública oficial documentada.</small>
      <button class="button secondary full" data-action="open-source">ABRIR NO C.R.I.S. ↗</button>
    </div></section>
    <section class="section-block"><div class="section-title"><span>10</span><h2>COMPARTILHAMENTO</h2><i></i></div>
      <label class="toggle-row"><span><strong>Compartilhar dados com jogadores</strong><small>Quando ativo, a cópia importada é gravada na metadata sincronizada do Token.</small></span>
        <input id="share-toggle" type="checkbox" ${state.shareWithPlayers ? "checked" : ""} ${state.role !== "GM" ? "disabled" : ""}><i></i></label>
      ${state.role === "GM" ? `<button class="button secondary full" data-action="save-sharing">SALVAR PERMISSÃO DE VISUALIZAÇÃO</button>` : ""}
    </section>
    <section class="section-block"><div class="section-title"><span>11</span><h2>IMPORTAR / SUBSTITUIR DADOS</h2><i></i></div>
      ${state.role === "GM" ? `<label class="field-label" for="json-input">JSON NORMALIZADO DO SISTEMA C.R.I.S.</label>
        <textarea id="json-input" class="json-input" spellcheck="false" placeholder='{
  "identity": { "name": "Nome do agente", "className": "Ocultista", "nex": "35%" },
  "attributes": { "AGI": 2, "FOR": 1, "INT": 4, "PRE": 3, "VIG": 2 },
  "resources": { "pv": { "current": 21, "max": 30 } }
}'></textarea>
        <p class="helper-text">Formato de importação próprio do projeto. Não é um export oficial do C.R.I.S.</p>
        <button class="button primary full" data-action="import-json">VALIDAR E SALVAR DADOS</button>` : `<p class="muted-note">Somente o Mestre pode importar, substituir ou remover dados.</p>`}
    </section>
    ${state.role === "GM" ? `<div class="action-stack"><button class="button secondary" data-action="recheck">REVALIDAR LINK</button><button class="button danger" data-action="unbind">DESVINCULAR TOKEN</button></div>` : ""}
    ${sheet?.additional ? `<section class="section-block"><div class="section-title"><span>12</span><h2>INFORMAÇÕES ADICIONAIS</h2><i></i></div><pre class="additional-data">${escapeHtml(JSON.stringify(sheet.additional, null, 2))}</pre></section>` : ""}
    ${sheet ? `<p class="footnote">Último arquivo importado: ${new Date(sheet.updatedAt).toLocaleString("pt-BR")}. O cache local não é sincronizado automaticamente entre dispositivos.</p>` : ""}`;
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
  return `<section class="connect-placeholder">
    <div class="cris-emblem"><span>✦</span><strong>C.R.I.S.</strong><small>ARQUIVO DE AGENTE</small></div>
    <h1>${url ? "VÍNCULO REGISTRADO" : "CONECTE UMA FICHA"}</h1>
    <p>${url ? "O endereço foi associado a este Token, mas os dados do personagem ainda não foram importados." : "Informe o link público da ficha para registrar o vínculo no Token selecionado."}</p>
    ${state.role === "GM" ? renderLinkForm(state) : `<p class="helper-text">Apenas o Mestre pode cadastrar ou substituir vínculos. Dados detalhados só aparecem quando o compartilhamento foi autorizado.</p>`}
    ${url ? `<button class="button secondary full" data-action="open-source">ABRIR FICHA NO C.R.I.S. ↗</button>` : ""}
    ${state.role === "GM" ? renderImportBox() : ""}
  </section>`;
}

function renderImportBox(): string {
  return `<div class="import-box"><div class="micro-label">IMPORTAÇÃO MANUAL</div>
    <label class="field-label" for="json-input">COLE OS DADOS NO FORMATO DO PROJETO</label>
    <textarea id="json-input" class="json-input" spellcheck="false" placeholder='{"identity":{"name":"Nome do agente"},"attributes":{"AGI":2,"FOR":1,"INT":3,"PRE":2,"VIG":2}}'></textarea>
    <p class="helper-text">Não é uma API nem um formato oficial do C.R.I.S. Consulte a documentação do projeto.</p>
    <button class="button primary full" data-action="import-json">IMPORTAR DADOS</button>
  </div>`;
}

function renderLinkForm(state: AppState): string {
  const existingUrl = state.binding?.sourceUrl ?? state.reference?.url ?? "";
  return `<form id="connect-form" class="connect-form">
    <label class="field-label" for="cris-url">LINK PÚBLICO DA FICHA</label>
    <div class="input-row"><input id="cris-url" type="url" required autocomplete="url" placeholder="https://crisordemparanormal.com/agente/..." value="${escapeHtml(existingUrl)}"><button class="button primary" type="submit">${state.mode === "bind" ? "VINCULAR" : "VALIDAR"}</button></div>
    <p class="helper-text">A validação confirma o domínio e o formato do link — não verifica a existência da ficha.</p>
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
        <div><div class="micro-label">PROTOCOLO DE ACESSO</div><h1>Conecte sua ficha do C.R.I.S.</h1><p>Registre o link público e associe o dossiê ao Token correspondente.</p></div>
      </div>
      ${state.role === "GM" ? renderLinkForm(state) : `<p class="muted-note">Apenas o Mestre pode cadastrar ou vincular fichas.</p>`}
    </section>
    <section class="section-block library-section"><div class="section-title"><span>01</span><h2>FICHAS DESTA SALA</h2><i></i><b>${state.library.length.toString().padStart(2, "0")}</b></div>
      ${cards ? `<div class="library-list">${cards}</div>` : `<div class="empty-state"><div class="empty-scroll">▤</div><strong>NENHUMA FICHA REGISTRADA</strong><p>Adicione um link do C.R.I.S. para iniciar o arquivo desta sala.</p></div>`}
    </section>
    <div class="footnote privacy-note">ASSOCIAÇÕES DE TOKEN SÃO SALVAS NA CENA. O CONTEÚDO DETALHADO PERMANECE LOCAL, A MENOS QUE O MESTRE ATIVE O COMPARTILHAMENTO.</div>`;
}

function renderApp(state: AppState): string {
  const title = state.mode === "library" ? "ARQUIVO DA SALA" : state.mode === "bind" ? "VINCULAR TOKEN" : "DOSSIÊ DO AGENTE";
  const header = renderHeader(state);
  const body = state.mode === "library" ? renderLibrary(state) : state.sheet ? `<section class="dossier-heading"><button class="text-back" data-action="back-library">← ARQUIVO DA SALA</button><div class="micro-label">${title} ${state.token ? `// ${escapeHtml(state.token.name ?? "TOKEN")}` : ""}</div><h1>Ficha do Personagem</h1><p>Registro de campo associado ao C.R.I.S.</p></section>${renderNavigation(state.activeTab)}<main class="sheet-content">${renderSheetContent(state)}</main>` : `<section class="dossier-heading"><button class="text-back" data-action="back-library">← ARQUIVO DA SALA</button><div class="micro-label">${title}</div><h1>Vincular ficha ao Token</h1><p>${escapeHtml(state.token?.name ?? "Token selecionado")}</p></section><main class="sheet-content">${renderNoSnapshot(state)}</main>`;
  return `<div class="app-shell">${header}<main class="content">${body}${renderToast(state.toast)}</main><footer class="app-footer"><span>CRIS // OBR EXTENSION</span><span>V1.0.0 · ${state.role}</span></footer></div>`;
}

export class CrisApp {
  private state: AppState;
  private root: HTMLDivElement;
  private sourceUrl = "";

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
      busy: false,
    };
    this.root.addEventListener("click", (event) => void this.handleClick(event));
    this.root.addEventListener("submit", (event) => void this.handleSubmit(event));
    this.root.addEventListener("change", (event) => this.handleChange(event));
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
    await registerContextMenu();
    this.render();
  }

  private async reloadRoomData(): Promise<void> {
    const library = await getRoomLibrary();
    this.state.library = library.sheets;
    if (this.state.tokenId) {
      this.state.token = await getTokenById(this.state.tokenId);
      this.state.binding = readTokenBinding(this.state.token);
      if (this.state.binding) {
        this.state.reference = this.state.library.find((entry) => entry.id === this.state.binding?.sheetId) ?? {
          id: this.state.binding.sheetId,
          url: this.state.binding.sourceUrl,
          name: this.state.binding.displayName,
          status: "link-only",
          addedAt: this.state.binding.boundAt,
        };
        this.state.sheet = persistence.get(this.state.binding.sheetId) ?? this.state.binding.snapshot;
        this.state.shareWithPlayers = this.state.binding.shareWithPlayers;
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
      const cached = persistence.get(result.link.id);
      const reference: CrisSheetReference = {
        id: result.link.id,
        url: result.link.url,
        // Metadados da cena são visíveis a todos; mantenha um rótulo neutro por padrão.
        name: `Agente ${result.link.id.slice(0, 6)}`,
        status: cached ? "imported" : "link-only",
        addedAt: Date.now(),
        ...(cached ? { updatedAt: cached.updatedAt } : {}),
      };
      await upsertRoomSheet(reference);
      this.state.reference = reference;
      this.state.sheet = cached;
      this.state.library = (await getRoomLibrary()).sheets;
      if (this.state.tokenId) {
        await bindTokenToSheet(this.state.tokenId, reference, this.state.shareWithPlayers, cached);
        this.state.binding = await this.getUpdatedBinding();
        this.state.mode = "token";
      }
      this.toast(result.message, "warning");
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Não foi possível validar o link.", "error");
    } finally {
      this.setBusy(false);
    }
  }

  private async getUpdatedBinding(): Promise<TokenBinding | undefined> {
    if (!this.state.tokenId) return undefined;
    return readTokenBinding(await getTokenById(this.state.tokenId));
  }

  private async importJson(): Promise<void> {
    if (this.state.role !== "GM") return this.toast("Somente o Mestre pode importar os dados.", "error");
    const textarea = this.root.querySelector<HTMLTextAreaElement>("#json-input");
    const reference = this.state.reference ?? (this.state.binding ? {
      id: this.state.binding.sheetId,
      url: this.state.binding.sourceUrl,
      name: this.state.binding.displayName,
      status: "link-only" as const,
      addedAt: this.state.binding.boundAt,
    } : undefined);
    if (!reference) return this.toast("Valide um link de ficha antes de importar os dados.", "warning");
    if (!textarea?.value.trim()) return this.toast("Cole o JSON normalizado no campo de importação.", "warning");

    try {
      const sheet = parseCharacterJson(textarea.value, reference.id, reference.url);
      persistence.save(sheet);
      const updatedReference: CrisSheetReference = {
        ...reference,
        // Não propague a identidade pela metadata sincronizada sem consentimento.
        name: reference.name || `Agente ${reference.id.slice(0, 6)}`,
        status: "imported",
        updatedAt: sheet.updatedAt,
      };
      await upsertRoomSheet(updatedReference);
      if (this.state.tokenId && this.state.binding) {
        await updateTokenSnapshot(this.state.tokenId, sheet, this.state.shareWithPlayers);
        this.state.binding = await this.getUpdatedBinding();
      }
      this.state.reference = updatedReference;
      this.state.sheet = sheet;
      this.state.library = (await getRoomLibrary()).sheets;
      this.state.activeTab = "overview";
      this.toast("Dados importados e armazenados no cache local.", "success");
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Não foi possível importar os dados.", "error");
    }
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
          this.render();
          break;
        }
        case "bind-selected": {
          if (!sheetId || this.state.role !== "GM") return;
          const selected = await getCurrentSelection();
          if (selected.length !== 1) return this.toast("Selecione exatamente um Token na camada de personagens.", "warning");
          const reference = this.state.library.find((entry) => entry.id === sheetId);
          if (!reference) return;
          const sheet = persistence.get(sheetId);
          await bindTokenToSheet(selected[0].id, reference, false, sheet);
          this.toast(`Ficha associada ao Token ${selected[0].name ?? "selecionado"}.`, "success");
          break;
        }
        case "import-json":
          await this.importJson();
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
          if (!this.state.tokenId || !this.state.sheet) return this.toast("Importe os dados e abra a ficha pelo Token antes de alterar o compartilhamento.", "warning");
          const checkbox = this.root.querySelector<HTMLInputElement>("#share-toggle");
          this.state.shareWithPlayers = checkbox?.checked ?? false;
          await updateTokenSnapshot(this.state.tokenId, this.state.sheet, this.state.shareWithPlayers);
          this.state.binding = await this.getUpdatedBinding();
          this.toast(this.state.shareWithPlayers ? "Cópia do dossiê compartilhada com a sala." : "Dados detalhados mantidos somente neste navegador.", "success");
          break;
        }
        case "recheck": {
          const url = this.state.reference?.url ?? this.state.binding?.sourceUrl;
          if (!url) return;
          validateCrisUrl(url);
          this.toast("O formato do link continua válido. A leitura remota não está disponível nesta versão.", "warning");
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
    }
  }

  private setBusy(busy: boolean): void {
    this.state.busy = busy;
    const button = this.root.querySelector<HTMLButtonElement>('#connect-form button[type="submit"]');
    if (button) {
      button.disabled = busy;
      button.textContent = busy ? "VALIDANDO..." : this.state.mode === "bind" ? "VINCULAR" : "VALIDAR";
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
