// Síndico (web) — prestadores e equipe (WebPrestadores.dc.html)
import { api } from '../../api.js';
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import { CONTRACT, FREQUENCY, PREVENTIVE_EVENT, PROVIDER_KIND, SHIFT, initials, shortDate, shortDateTime, visitLabel } from '../../format.js';
import { createScreen, errorHandlers, errorView, loadingView, switchButton, toast, spin } from '../../ui.js';
import { incidentTag, isStaff, webDenied, webShell } from './shared.js';

const TABS = [['all', 'Todos'], ['external', 'Prestadores externos'], ['employee', 'Funcionários']];

function toForm(p) {
  return {
    id: p?.id || null,
    kind: p?.kind || 'external',
    name: p?.name || '',
    document: p?.document || '',
    job_title: p?.job_title || '',
    phone: p?.phone || '',
    team_size: p?.team_size || 1,
    contract_type: p?.contract_type || 'on_demand',
    contract_valid_until: p?.contract_valid_until || '',
    shift: p?.shift || 'business_hours',
    is_active: p?.is_active ?? true,
    specialty_ids: p ? p.specialties.map((s) => s.id) : [],
  };
}

export default function webProviders(root) {
  const screen = createScreen(root);
  const s = {
    me: null, condo: null, providers: [], types: [], tab: 'all', search: '',
    selectedId: null, detail: null, form: null, busy: false, error: null,
  };

  async function load() {
    screen.paint(loadingView());
    try {
      [s.me, s.condo] = await Promise.all([api.me(), api.condominium()]);
      if (!isStaff(s.me)) return screen.paint(webShell('prestadores', s.me, s.condo, webDenied()));
      [s.providers, s.types] = await Promise.all([api.providers(), api.maintenanceTypes()]);
      if (s.providers[0]) await select(s.providers[0].id);
      else paint();
    } catch (err) {
      screen.paint(errorView(err));
    }
  }

  async function select(id) {
    s.selectedId = id;
    s.form = null;
    s.error = null;
    try {
      s.detail = await api.provider(id);
    } catch (err) {
      s.error = err.message;
    }
    paint();
  }

  function filtered() {
    const q = s.search.trim().toLowerCase();
    return s.providers.filter((p) => (s.tab === 'all' || p.kind === s.tab)
      && (!q || p.name.toLowerCase().includes(q) || p.specialties.some((x) => x.name.toLowerCase().includes(q))));
  }

  const kindLabel = (p) => (p.kind === 'employee' ? p.job_title || 'Funcionário' : CONTRACT[p.contract_type] || 'Externo');
  const busyLabel = (p) => (p.open_assignments ? `${p.open_assignments} ${p.open_assignments === 1 ? 'manutenção' : 'manutenções'}` : 'Livre');

  function table() {
    const rows = filtered();
    return html`
      <section class="panel-card" aria-label="Lista de prestadores">
        <div class="panel-card__head">
          <div class="chips chips--filter" role="group" aria-label="Vínculo">
            ${TABS.map(([k, l]) => html`<button type="button" class="chip" data-action="tab" data-key="${k}" data-focus-key="tab-${k}" aria-pressed="${s.tab === k ? 'true' : 'false'}">${l}</button>`)}
          </div>
          <div style="flex:1"></div>
          <input type="search" class="input search" data-change="search" value="${s.search}" aria-label="Buscar prestador" placeholder="Nome ou especialidade">
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Nome</th><th>Vínculo</th><th>Especialidades</th><th>Contato</th><th>Escalado</th><th>Contrato até</th></tr></thead>
            <tbody>
              ${rows.map((p) => html`
                <tr class="${p.id === s.selectedId ? 'is-selected' : ''}">
                  <td>
                    <button type="button" class="row-btn row-btn--inline" data-action="select" data-id="${p.id}" data-focus-key="p-${p.id}" aria-pressed="${p.id === s.selectedId ? 'true' : 'false'}">
                      <span class="avatar" aria-hidden="true">${initials(p.name)}</span>
                      <span><span class="row-btn__title" style="display:block">${p.name}</span>${p.is_active ? '' : html`<span class="tag tag--neutral">Inativo</span>`}</span>
                    </button>
                  </td>
                  <td>${kindLabel(p)}</td>
                  <td class="cell-muted">${p.specialties.map((x) => x.name).join(', ') || '—'}</td>
                  <td class="cell-muted">${p.phone || '—'}</td>
                  <td><span class="tag ${p.open_assignments ? 'tag--info' : 'tag--accent'}">${busyLabel(p)}</span></td>
                  <td class="cell-muted">${p.contract_valid_until ? shortDate(p.contract_valid_until) : '—'}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        ${rows.length ? '' : html`<div class="empty" style="margin:16px">Nenhum prestador encontrado</div>`}
      </section>`;
  }

  function detailPanel() {
    const p = s.detail;
    if (!p) return html`<section class="panel-card side"><div class="hint">Selecione um prestador.</div></section>`;
    const jobs = [
      ...p.schedule.incidents.map((i) => ({
        title: `${i.code} · ${i.title}`,
        sub: `${i.location.name} · ${visitLabel(i.scheduled_start_at, i.scheduled_end_at) || 'sem data marcada'}`,
        tag: incidentTag(i.status, { staff: true }),
      })),
      ...p.schedule.preventive_rules.map((r) => ({
        title: r.name,
        sub: `${r.location.name} · ${r.trigger_type === 'recurring'
          ? `${FREQUENCY[r.frequency]}${r.next_run_at ? `, próxima ${shortDateTime(r.next_run_at)}` : ''}`
          : `após ${PREVENTIVE_EVENT[r.trigger_event]?.toLowerCase()}`}`,
        tag: html`<span class="tag tag--accent">Preventiva</span>`,
      })),
    ];
    return html`
      <section class="panel-card side" aria-label="Detalhes do prestador">
        <div style="display:flex;gap:12px;align-items:center">
          <span class="avatar" style="width:48px;height:48px;color:var(--accent);background:var(--soft);border:none" aria-hidden="true">${initials(p.name)}</span>
          <div>
            <h2 class="side__title">${p.name}</h2>
            <div class="hint">${PROVIDER_KIND[p.kind]} · ${p.specialties.map((x) => x.name).join(', ') || 'sem especialidades'}</div>
          </div>
        </div>
        <div class="facts">
          <div class="fact"><div class="fact__label">Contato</div><div class="fact__value">${p.phone || '—'}</div></div>
          ${p.kind === 'external'
            ? html`<div class="fact"><div class="fact__label">Contrato</div><div class="fact__value">${CONTRACT[p.contract_type] || '—'}${p.contract_valid_until ? ` até ${shortDate(p.contract_valid_until)}` : ''}</div></div>`
            : html`<div class="fact"><div class="fact__label">Turno</div><div class="fact__value">${SHIFT[p.shift] || '—'}${p.team_size > 1 ? ` · ${p.team_size} pessoas` : ''}</div></div>`}
          ${p.document ? html`<div class="fact"><div class="fact__label">CNPJ/CPF</div><div class="fact__value">${p.document}</div></div>` : ''}
          <div class="fact"><div class="fact__label">Situação</div><div class="fact__value">${p.is_active ? 'Ativo' : 'Inativo'}</div></div>
        </div>
        <div class="side__label">Escalado para</div>
        ${jobs.length
          ? html`<div class="stack">${jobs.map((j) => html`
            <div class="card" style="padding:10px 12px;display:flex;gap:10px;align-items:flex-start">
              <div style="flex:1;min-width:0"><div class="row-link__title" style="font-size:13px">${j.title}</div><div class="row-link__sub">${j.sub}</div></div>
              ${j.tag}
            </div>`)}</div>`
          : html`<div class="empty" style="padding:14px">Sem manutenções atribuídas no momento.</div>`}
        <button type="button" class="btn btn--ghost btn--block" data-action="edit">${icon('edit', 16)} Editar cadastro</button>
        <a class="btn btn--text btn--block" href="#/sindico/manutencoes">Atribuir manutenção no painel</a>
      </section>`;
  }

  function formPanel() {
    const f = s.form;
    const ext = f.kind === 'external';
    return html`
      <section class="panel-card side" aria-label="${f.id ? 'Editar prestador' : 'Cadastrar prestador'}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 class="side__title">${f.id ? 'Editar cadastro' : 'Novo cadastro'}</h2>
          <button type="button" class="icon-btn icon-btn--sm" data-action="close-form" aria-label="Fechar formulário">${icon('x', 16, 2)}</button>
        </div>
        <div class="segmented" role="group" aria-label="Vínculo">
          <button type="button" data-action="kind" data-kind="external" data-focus-key="k-ext" aria-pressed="${ext ? 'true' : 'false'}" ${f.id ? 'disabled' : ''}>Prestador externo</button>
          <button type="button" data-action="kind" data-kind="employee" data-focus-key="k-emp" aria-pressed="${ext ? 'false' : 'true'}" ${f.id ? 'disabled' : ''}>Funcionário</button>
        </div>
        <div class="field"><label for="wp-nome">${ext ? 'Empresa ou nome' : 'Nome completo'}</label><input id="wp-nome" class="input" name="name" value="${f.name}" autocomplete="off"></div>
        ${ext
          ? html`<div class="field"><label for="wp-doc">CNPJ ou CPF</label><input id="wp-doc" class="input" name="document" value="${f.document}" autocomplete="off"></div>`
          : html`<div class="grid-2">
              <div class="field"><label for="wp-job">Função</label><input id="wp-job" class="input" name="job_title" value="${f.job_title}" placeholder="Ex.: Zelador" autocomplete="off"></div>
              <div class="field"><label for="wp-team">Pessoas na equipe</label><input id="wp-team" class="input" name="team_size" type="number" min="1" value="${f.team_size}"></div>
            </div>`}
        <div class="field"><label for="wp-tel">Telefone</label><input id="wp-tel" class="input" name="phone" type="tel" value="${f.phone}" autocomplete="off"></div>
        <div class="field">
          <span class="field__label">Especialidades</span>
          <div class="chips chips--filter" role="group" aria-label="Especialidades">
            ${s.types.map((t) => html`<button type="button" class="chip" data-action="skill" data-id="${t.id}" data-focus-key="sk-${t.id}" aria-pressed="${f.specialty_ids.includes(t.id) ? 'true' : 'false'}">${t.name}</button>`)}
          </div>
        </div>
        ${ext
          ? html`
            <div class="grid-2">
              <div class="field"><label for="wp-contrato">Contrato</label>
                <select id="wp-contrato" class="select" name="contract_type" data-repaint="1">${Object.entries(CONTRACT).map(([k, l]) => html`<option value="${k}" ${k === f.contract_type ? 'selected' : ''}>${l}</option>`)}</select></div>
              ${f.contract_type !== 'on_demand'
                ? html`<div class="field"><label for="wp-validade">Validade</label><input id="wp-validade" class="input" type="date" name="contract_valid_until" value="${f.contract_valid_until}"></div>`
                : ''}
            </div>`
          : html`
            <div class="field"><label for="wp-turno">Turno</label>
              <select id="wp-turno" class="select" name="shift">${Object.entries(SHIFT).map(([k, l]) => html`<option value="${k}" ${k === f.shift ? 'selected' : ''}>${l}</option>`)}</select></div>`}
        ${f.id
          ? html`<div class="switch-row"><div><div class="switch-row__label">Ativo</div><div class="switch-row__hint">Desativado, não aparece para novas atribuições.</div></div>${switchButton({ action: 'toggle-active', checked: f.is_active, label: 'Prestador ativo' })}</div>`
          : ''}
        ${s.error ? html`<div class="notice notice--danger" role="alert">${icon('alert', 18)}<div>${s.error}</div></div>` : ''}
        <button type="button" class="btn btn--primary btn--block" data-action="save" ${s.busy ? 'disabled' : ''}>${s.busy ? html`${spin()} Salvando…` : 'Salvar cadastro'}</button>
      </section>`;
  }

  function paint() {
    screen.paint(webShell('prestadores', s.me, s.condo, html`
      <div class="web__head">
        <div>
          <h1 class="web__title">Prestadores e equipe</h1>
          <div class="web__sub">Cadastro de prestadores externos e funcionários, e quem está escalado para cada manutenção</div>
        </div>
        <div class="web__actions">
          <button type="button" class="btn btn--primary" data-action="new">${icon('plus', 16, 2.2)} Cadastrar prestador</button>
        </div>
      </div>
      <div class="split">
        ${table()}
        ${s.form ? formPanel() : detailPanel()}
      </div>`));
  }

  function payload(f) {
    const ext = f.kind === 'external';
    const base = {
      name: f.name.trim(),
      phone: f.phone.trim() || null,
      specialty_ids: f.specialty_ids,
      document: ext ? f.document.trim() || null : null,
      contract_type: ext ? f.contract_type : null,
      contract_valid_until: ext && f.contract_type !== 'on_demand' ? f.contract_valid_until || null : null,
      job_title: ext ? null : f.job_title.trim() || null,
      shift: ext ? null : f.shift,
      team_size: ext ? 1 : Number(f.team_size) || 1,
    };
    return f.id ? { ...base, is_active: f.is_active } : { ...base, kind: f.kind };
  }

  screen.on({
    ...errorHandlers(load),
    tab: (d) => {
      s.tab = d.key;
      paint();
    },
    select: (d) => select(d.id),
    new: () => {
      s.form = toForm(null);
      s.error = null;
      paint();
      screen.el.querySelector('#wp-nome')?.focus();
    },
    edit: () => {
      s.form = toForm(s.detail);
      s.error = null;
      paint();
    },
    'close-form': () => {
      s.form = null;
      s.error = null;
      paint();
    },
    kind: (d) => {
      s.form.kind = d.kind;
      paint();
    },
    skill: (d) => {
      const ids = s.form.specialty_ids;
      s.form.specialty_ids = ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id];
      paint();
    },
    'toggle-active': () => {
      s.form.is_active = !s.form.is_active;
      paint();
    },
    save: async () => {
      const f = s.form;
      if (!f.name.trim()) {
        s.error = 'Informe o nome';
        return paint();
      }
      s.busy = true;
      s.error = null;
      paint();
      try {
        const saved = f.id ? await api.updateProvider(f.id, payload(f)) : await api.createProvider(payload(f));
        s.providers = await api.providers();
        toast.success(f.id ? 'Cadastro atualizado' : 'Prestador cadastrado');
        s.busy = false;
        return select(saved.id);
      } catch (err) {
        s.error = err.message;
      }
      s.busy = false;
      if (screen.alive()) paint();
    },
  });

  screen.el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.change === 'search') {
      s.search = t.value;
      const pos = t.selectionStart;
      paint();
      const el = screen.el.querySelector('[data-change="search"]');
      el?.focus();
      el?.setSelectionRange(pos, pos);
    } else if (s.form && t.name in s.form) s.form[t.name] = t.value;
  });
  screen.el.addEventListener('change', (e) => {
    const t = e.target;
    if (s.form && t.name in s.form) {
      s.form[t.name] = t.value;
      if (t.dataset.repaint) paint();
    }
  });
  load();
}
