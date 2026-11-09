import OBR from "@owlbear-rodeo/sdk";
import { STATUS_LABELS } from "../config";
import { importCrisCharacter } from "../cris/importer";
import { CharacterRepository } from "../storage/repository";
import { getCharacterTokens, linkTokenToCharacter, registerTokenContextMenu, unlinkToken } from "../owlbear/tokens";
import { escapeHtml, safeHttpsUrl, stringifyUnknown, timeAgo } from "../utils/safe";
import type { AppSettings, CharacterSheet, SceneState } from "../types";

const esc = escapeHtml;
const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) =>
  `<option value="${value}">${esc(label)}</option>`).join("");
const vitalValue = (c: CharacterSheet, id: string, fallback: number) =>
  c.session.vitalOverrides[id] ?? fallback;

export class CharacterApp {
  private repo = new CharacterRepository();
  private state!: SceneState;
  private selectedId?: string;
  private isGM = false;
  private toast = "";
  private toastKind = "info";
  private busy = false;
  private unsubscribe?: () => void;
  private autoTimer?: number;
  private clickHandler = (event: Event) => void this.onClick(event);
  private submitHandler = (event: Event) => void this.onSubmit(event);
  private changeHandler = (event: Event) => void this.onChange(event);

  constructor(private root: HTMLElement) {}

  async init(): Promise<void> {
    if (OBR.isAvailable) {
      await OBR.onReady();
      try { this.isGM = (await OBR.player.getRole()) === "GM"; } catch { this.isGM = false; }
      await registerTokenContextMenu();
    }
    await this.repo.load();
    this.root.addEventListener("click", this.clickHandler);
    this.root.addEventListener("submit", this.submitHandler);
    this.root.addEventListener("change", this.changeHandler);
    this.unsubscribe = this.repo.subscribe((state) => {
      this.state = state;
      this.render();
      this.scheduleAutoRefresh();
    });
    const tokenId = new URLSearchParams(location.search).get("tokenId");
    if (tokenId) {
      const token = (await getCharacterTokens()).find((item) => item.id === tokenId);
      if (token?.characterId && this.state.characters[token.characterId]) {
        this.selectedId = token.characterId;
        this.render();
      }
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    if (this.autoTimer) window.clearInterval(this.autoTimer);
    this.root.removeEventListener("click", this.clickHandler);
    this.root.removeEventListener("submit", this.submitHandler);
    this.root.removeEventListener("change", this.changeHandler);
    this.repo.dispose();
  }

  private notify(message: string, kind = "info"): void {
    this.toast = message;
    this.toastKind = kind;
    this.render();
  }

  private scheduleAutoRefresh(): void {
    if (this.autoTimer) window.clearInterval(this.autoTimer);
    const minutes = this.state?.settings.autoRefreshMinutes ?? 0;
    if (!minutes || document.visibilityState !== "visible") return;
    this.autoTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void Promise.all(Object.values(this.state.characters).map((c) => this.refresh(c.id, true)));
      }
    }, minutes * 60_000);
  }

  private async onSubmit(event: Event): Promise<void> {
    const form = (event.target as HTMLElement).closest("form[data-import]");
    if (!form) return;
    event.preventDefault();
    if (!this.isGM) return this.notify("Somente o Mestre pode adicionar fichas.", "warning");
    const data = new FormData(form as HTMLFormElement);
    const url = String(data.get("url") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    this.busy = true;
    this.render();
    try {
      const result = await importCrisCharacter(url);
      const character = { ...result.character, ...(name ? { customName: name } : {}) };
      await this.repo.upsert(character);
      this.selectedId = character.id;
      this.notify(result.warnings.length ? result.warnings.join(" ") : "Ficha importada e adicionada à cena.", result.warnings.length ? "warning" : "success");
    } catch (error) {
      this.notify(error instanceof Error ? error.message : "Falha inesperada ao importar a ficha.", "error");
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async onClick(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id ?? this.selectedId;
    if (action === "open" && id) { this.selectedId = id; this.render(); }
    if (action === "back") { this.selectedId = undefined; this.render(); }
    if (action === "refresh" && id) await this.refresh(id);
    if (action === "delete" && id && this.isGM) {
      const tokens = await getCharacterTokens();
      for (const token of tokens.filter((item) => item.characterId === id)) await unlinkToken(token.id);
      await this.repo.remove(id);
      this.selectedId = undefined;
      this.notify("Ficha removida da biblioteca desta cena.", "success");
    }
    if (action === "link" && id) {
      const select = this.root.querySelector<HTMLSelectElement>("#token-select");
      if (!select?.value) return this.notify("Selecione um Token da cena.", "warning");
      try {
        await linkTokenToCharacter(select.value, id);
        this.notify("Ficha vinculada ao Token.", "success");
      } catch (error) { this.notify(error instanceof Error ? error.message : "Não foi possível vincular o Token.", "error"); }
    }
    if (action === "unlink" && id) {
      const tokens = await getCharacterTokens();
      for (const token of tokens.filter((item) => item.characterId === id)) await unlinkToken(token.id);
      this.notify("Vínculo removido. A ficha continua salva.", "success");
    }
    if (action === "settings") { this.selectedId = "__settings"; this.render(); }
  }

  private async onChange(event: Event): Promise<void> {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    if (el.matches("[data-status]") && this.selectedId) {
      const c = this.state.characters[this.selectedId];
      if (c) await this.repo.upsert({ ...c, session: { ...c.session, status: el.value as CharacterSheet["session"]["status"] } });
    }
    if (el.matches("[data-vital]") && this.selectedId) {
      const c = this.state.characters[this.selectedId];
      const vital = c?.vitals.find((v) => v.id === el.dataset.vital);
      if (c && vital) {
        const next = { ...c.session.vitalOverrides, [vital.id]: Math.max(0, Math.min(vital.max, Number(el.value))) };
        await this.repo.upsert({ ...c, session: { ...c.session, vitalOverrides: next } });
      }
    }
    if (el.matches("[data-setting]") && this.isGM) {
      const key = el.dataset.setting as keyof AppSettings;
      const value = key === "autoRefreshMinutes" ? Number(el.value) : el instanceof HTMLInputElement ? el.checked : el.value === "true";
      await this.repo.updateSettings({ ...this.state.settings, [key]: value } as AppSettings);
    }
  }

  private async refresh(id: string, automatic = false): Promise<void> {
    const old = this.state.characters[id];
    if (!old) return;
    if (!automatic) { this.busy = true; this.render(); }
    try {
      const result = await importCrisCharacter(old.source.url);
      const fresh = result.character;
      await this.repo.upsert({
        ...fresh,
        id: old.id,
        customName: old.customName,
        session: old.session,
        source: { ...fresh.source, refreshedAt: Date.now() },
      });
      if (!automatic) this.notify("Ficha atualizada a partir do CRIS.", "success");
    } catch (error) {
      this.notify(`Não foi possível atualizar. Exibindo a última versão disponível. ${error instanceof Error ? error.message : ""}`, "warning");
    } finally {
      if (!automatic) { this.busy = false; this.render(); }
    }
  }

  private portrait(url?: string, className = "card-portrait"): string {
    const safe = safeHttpsUrl(url);
    return safe
      ? `<img class="${className}" src="${esc(safe)}" alt="Retrato do personagem" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'portrait-placeholder',innerHTML:'<span>✕</span><small>SEM RETRATO</small>'}))">`
      : `<div class="portrait-placeholder ${className}"><span>✕</span><small>SEM RETRATO</small></div>`;
  }

  private card(c: CharacterSheet): string {
    const name = c.customName || c.identity.name || "Agente sem nome";
    const vitals = c.vitals.filter((v) => ["hp", "pe", "san"].includes(v.id)).map((v) =>
      `<span class="mini-vital"><b>${esc(v.label)}</b><strong>${vitalValue(c, v.id, v.current)}/${v.max}</strong></span>`).join("");
    const subtitle = [c.identity.className, c.identity.origin].filter(Boolean).join(" • ");
    return `<button class="character-card" data-action="open" data-id="${esc(c.id)}">${this.portrait(c.avatarUrl)}<span class="card-copy"><strong class="card-name">${esc(name)}</strong><span class="card-subtitle">${esc(subtitle || "Identidade não informada")}</span><span class="card-meta">${esc(c.identity.nex || c.identity.level || "NEX não informado")}</span><span class="card-vitals">${vitals}</span></span><span class="card-chevron">›</span></button>`;
  }

  private async details(c: CharacterSheet): Promise<string> {
    const name = c.customName || c.identity.name || "Agente sem nome";
    const statusControl = Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${c.session.status === value ? "selected" : ""}>${esc(label)}</option>`).join("");
    const vitals = c.vitals.map((v) => {
      const value = vitalValue(c, v.id, v.current);
      const pct = v.max > 0 ? Math.max(0, Math.min(100, value / v.max * 100)) : 0;
      return `<div class="vital-card"><div class="vital-heading"><b>${esc(v.label)}</b><strong>${value} / ${v.max}</strong></div><div class="vital-track"><i style="width:${pct}%;background:${esc(v.color)}"></i></div>${this.isGM ? `<input aria-label="Valor atual de ${esc(v.label)}" type="number" min="0" max="${v.max}" value="${value}" data-vital="${esc(v.id)}">` : ""}</div>`;
    }).join("");
    const attrs = Object.entries(c.attributes).map(([k, v]) => `<div class="attribute-cell"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
    const sections = c.sections.map((s, i) => `<details class="collapsible-section" open><summary><span class="section-index">${String(i + 1).padStart(2, "0")}</span>${esc(s.title)}<span class="summary-arrow">⌄</span></summary><div class="section-items">${s.items.map((item) => `<article class="record-item"><div class="record-title"><b>${esc(item.name)}</b><strong>${esc(item.value || "")}</strong></div>${item.tags?.length ? `<div class="record-tags">${item.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}${item.description ? `<p>${esc(item.description)}</p>` : ""}</article>`).join("")}</div></details>`).join("");
    const combat = Object.entries(c.combat).map(([k, v]) => `<div class="additional-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
    const extra = Object.entries(c.additional).map(([k, v]) => `<div class="additional-row"><span>${esc(k)}</span><pre>${esc(stringifyUnknown(v))}</pre></div>`).join("");
    return `<button class="back-button" data-action="back">← VOLTAR À BIBLIOTECA</button><section class="dossier-hero">${this.state.settings.showPhoto ? this.portrait(c.avatarUrl, "detail-portrait") : ""}<div class="dossier-identity"><div class="eyebrow">DOSSIÊ DE AGENTE · C.R.I.S.</div><h1>${esc(name)}</h1><p>${esc([c.identity.className, c.identity.origin].filter(Boolean).join(" • "))}</p><div class="card-meta">${esc(c.identity.nex || c.identity.level || "NEX/nível não informado")} · ${esc(c.identity.rank || "PATENTE NÃO INFORMADA")}</div></div></section><section class="sheet-section"><h2>ESTADO DO AGENTE</h2><select data-status>${statusControl}</select></section><div class="detail-actions"><button class="secondary-button" data-action="refresh" data-id="${esc(c.id)}" ${this.busy ? "disabled" : ""}>↻ ATUALIZAR</button>${this.isGM ? `<button class="danger-button" data-action="delete" data-id="${esc(c.id)}">REMOVER</button>` : ""}</div><section class="sheet-section"><h2>RECURSOS</h2><div class="vital-grid">${vitals || '<p class="muted-copy">Sem recursos identificados na ficha.</p>'}</div></section>${attrs ? `<section class="sheet-section"><h2>ATRIBUTOS</h2><div class="attribute-grid">${attrs}</div></section>` : ""}${combat ? `<section class="sheet-section"><h2>COMBATE</h2><div class="additional-list">${combat}</div></section>` : ""}${sections}<section class="sheet-section"><h2>VÍNCULO COM TOKEN</h2><p class="muted-copy">O vínculo acompanha o Token enquanto ele existir na cena.</p><div class="token-panel"><select id="token-select"><option value="">Selecionar Token da cena</option>${(await getCharacterTokens()).map((t) => `<option value="${esc(t.id)}" ${t.characterId === c.id ? "selected" : ""}>${esc(t.name)}${t.characterId === c.id ? " · vinculado" : ""}</option>`).join("")}</select>${this.isGM ? `<button class="secondary-button full-width" data-action="link" data-id="${esc(c.id)}">VINCULAR AO TOKEN</button><button class="secondary-button full-width" data-action="unlink" data-id="${esc(c.id)}">REMOVER VÍNCULO</button>` : ""}</div></section>${extra ? `<section class="sheet-section"><h2>INFORMAÇÕES ADICIONAIS</h2><div class="additional-list">${extra}</div></section>` : ""}<footer class="source-footer"><div><span>ÚLTIMA ATUALIZAÇÃO</span><strong>${timeAgo(c.source.refreshedAt || c.source.importedAt)}</strong></div><div><span>FONTE</span><a href="${esc(c.source.url)}" target="_blank" rel="noopener noreferrer">ABRIR NO CRIS ↗</a></div></footer>`;
  }

  private settingsView(): string {
    const s = this.state.settings;
    return `<button class="back-button" data-action="back">← VOLTAR</button><div class="section-heading"><div><div class="eyebrow">PREFERÊNCIAS DO ARQUIVO</div><h1>Configurações</h1></div></div><section class="settings-group"><label>Atualização automática</label><select data-setting="autoRefreshMinutes" ${this.isGM ? "" : "disabled"}><option value="0" ${s.autoRefreshMinutes === 0 ? "selected" : ""}>Desativada</option><option value="5" ${s.autoRefreshMinutes === 5 ? "selected" : ""}>A cada 5 minutos</option><option value="15" ${s.autoRefreshMinutes === 15 ? "selected" : ""}>A cada 15 minutos</option><option value="30" ${s.autoRefreshMinutes === 30 ? "selected" : ""}>A cada 30 minutos</option></select><p class="settings-note">A atualização só ocorre enquanto este painel estiver aberto e visível.</p></section><section class="settings-group"><label>Exibição da ficha</label>${(["showPhoto","showAttributes","showAbilities","showInventory","compactMode","animations"] as const).map((key) => `<label class="toggle-row">${({showPhoto:"Exibir retrato",showAttributes:"Exibir atributos",showAbilities:"Exibir habilidades",showInventory:"Exibir inventário",compactMode:"Modo compacto",animations:"Animações"} as Record<string,string>)[key]}<input type="checkbox" data-setting="${key}" ${s[key] ? "checked" : ""} ${this.isGM ? "" : "disabled"}></label>`).join("")}</section><p class="scope-note">As preferências compartilhadas e fichas sincronizam na cena atual. O cache local pertence a este navegador.</p>`;
  }

  private async render(): Promise<void> {
    if (!this.state) return;
    const selected = this.selectedId && this.state.characters[this.selectedId];
    const body = selected
      ? await this.details(selected)
      : this.selectedId === "__settings"
        ? this.settingsView()
        : `<div class="section-heading"><div><div class="eyebrow">ARQUIVO DE INVESTIGAÇÃO · C.R.I.S.</div><h1>Agentes <span>registrados</span></h1><p>Fichas públicas vinculadas à cena atual.</p></div><button class="icon-button" data-action="settings" aria-label="Configurações">⚙</button></div><details class="import-panel" ${Object.keys(this.state.characters).length ? "" : "open"}><summary class="panel-kicker"><span>+</span> ADICIONAR PERSONAGEM</summary><form data-import><label>Nome da ficha <span>OPCIONAL</span><input name="name" placeholder="Nome para exibição"></label><label>Link público da ficha no CRIS<input name="url" type="url" placeholder="https://crisordemparanormal.com/agente/..." required></label><button class="primary-button full-width" type="submit" ${this.busy || !this.isGM ? "disabled" : ""}>${this.busy ? "IMPORTANDO..." : "IMPORTAR FICHA"}</button><p class="form-footnote">Somente fichas acessíveis publicamente. Nenhuma senha ou cookie é solicitado.</p></form></details><div class="list-meta"><span>REGISTROS DA CENA</span><span>${Object.keys(this.state.characters).length} AGENTE(S)</span></div><div class="character-list">${Object.values(this.state.characters).map((c) => this.card(c)).join("") || '<div class="empty-state"><div class="empty-symbol">✚</div><h2>Nenhum agente registrado</h2><p>Adicione uma ficha pública do CRIS para montar o arquivo de investigação.</p></div>'}</div><p class="scope-note">${this.isGM ? "Mestre: você pode importar, atualizar e vincular fichas." : "Modo jogador: visualização das fichas compartilhadas nesta cena."} As alterações temporárias não modificam a ficha original no CRIS.</p>`;
    this.root.innerHTML = `<main class="app-shell"><header class="topbar"><div class="brand-mark">C<i></i></div><div class="brand-copy"><div class="eyebrow">SISTEMA DE ARQUIVAMENTO</div><div class="brand-title">CONEXÃO <span>COM CRIS</span></div></div></header><div class="status-strip"><i class="status-dot online"></i> CANAL DE DADOS <span class="role-label">${this.isGM ? "MESTRE" : "JOGADOR"}</span></div><section class="content ${this.selectedId === "__settings" ? "settings-content" : ""}">${body}${this.toast ? `<p class="toast ${this.toastKind}">${esc(this.toast)}</p>` : ""}</section><footer class="footer-line"><span>ARQUIVO 0.1 · CENA ATUAL</span><span>ACESSO REGISTRADO</span></footer></main>`;
  }
}
