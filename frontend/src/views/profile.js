// Perfil: na POC (sem login) escolhe o usuário simulado (X-User-Id) e a conexão com a API.
import { api, clearCache } from '../api.js';
import { settings, updateSettings } from '../config.js';
import { clearDraft } from '../draft.js';
import { resetMock } from '../mock.js';
import { html } from '../html.js';
import { ROLE_LABEL, initials } from '../format.js';
import { createScreen, switchButton, tabbar, toast, topbar } from '../ui.js';

export default function profile(root) {
  const screen = createScreen(root);
  let members = null;
  let membersError = null;
  let form = { ...settings() };

  async function loadMembers() {
    members = null;
    membersError = null;
    paint();
    try {
      members = await api.members();
    } catch (err) {
      membersError = err.message;
    }
    paint();
  }

  function memberList() {
    if (membersError) return html`<div class="form-error">${membersError}</div>`;
    if (!members) return html`<div class="skeleton" style="height:120px"></div>`;
    return members.map((m) => html`
      <button type="button" class="member" data-action="user" data-id="${m.user_id}" data-focus-key="user-${m.user_id}" aria-pressed="${m.user_id === settings().userId ? 'true' : 'false'}">
        <span class="avatar" aria-hidden="true">${initials(m.name)}</span>
        <span style="flex:1;min-width:0">
          <span class="row-link__title" style="display:block">${m.name}</span>
          <span class="row-link__sub" style="display:block">
            ${ROLE_LABEL[m.role] || m.role}${m.units.length ? ` · ${m.units.map((u) => u.label).join(', ')}` : ''}${m.has_pending_dues ? ' · com pendência' : ''}
          </span>
        </span>
      </button>`);
  }

  function paint() {
    const s = settings();
    screen.paint(html`
      ${topbar({ back: '#/', title: 'Perfil', subtitle: 'Prova de conceito — sem login' })}
      <main class="content" style="padding-top:14px;gap:16px">
        <section class="card panel">
          <h2 class="panel__title" style="margin:0">Usuário da demonstração</h2>
          <p class="hint" style="margin:0">Quem está usando o app. Vai no cabeçalho <code>X-User-Id</code> de cada requisição.</p>
          <div class="stack">${memberList()}</div>
        </section>

        <section class="card panel">
          <h2 class="panel__title" style="margin:0">Conexão</h2>
          <div class="switch-row">
            <div>
              <div class="switch-row__label">Dados de demonstração</div>
              <div class="switch-row__hint">Simula a API no navegador, sem servidor.</div>
            </div>
            ${switchButton({ action: 'mock', checked: s.mock, label: 'Usar dados de demonstração' })}
          </div>
          <div class="field">
            <label for="api-base">Endereço da API</label>
            <input id="api-base" class="input" name="apiBase" value="${form.apiBase}" inputmode="url" autocomplete="off" ${s.mock ? 'disabled' : ''}>
          </div>
          <div class="field">
            <label for="condo-id">Id do condomínio</label>
            <input id="condo-id" class="input" name="condominiumId" value="${form.condominiumId}" autocomplete="off">
          </div>
          <button type="button" class="btn btn--ghost" data-action="save">Salvar conexão</button>
          ${s.mock ? html`<button type="button" class="btn btn--text" data-action="reset">Restaurar dados de demonstração</button>` : ''}
        </section>
      </main>
      ${tabbar('perfil')}`);
  }

  screen.on({
    user: (d) => {
      updateSettings({ userId: d.id });
      clearDraft();
      toast('Usuário trocado');
      paint();
    },
    mock: () => {
      updateSettings({ mock: !settings().mock });
      clearDraft();
      loadMembers();
    },
    reset: () => {
      resetMock();
      clearDraft();
      clearCache();
      toast('Dados de demonstração restaurados');
    },
    save: () => {
      updateSettings({ apiBase: form.apiBase.trim(), condominiumId: form.condominiumId.trim() });
      clearCache();
      toast('Conexão salva');
      loadMembers();
    },
  });
  screen.el.addEventListener('input', (e) => {
    if (e.target.name) form[e.target.name] = e.target.value;
  });
  loadMembers();
}
