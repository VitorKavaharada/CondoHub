// Síndico (web) — histórico por local ou tipo (WebHistorico.dc.html)
import { api } from '../../api.js';
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import { CONTRACT, money, shortDate, todayIso } from '../../format.js';
import { createScreen, errorHandlers, errorView, loadingView } from '../../ui.js';
import { isStaff, webDenied, webShell } from './shared.js';

const ORIGIN_TAG = {
  preventive: ['Preventiva', 'accent'],
  resident: ['Corretiva', 'danger'],
  manual: ['Avulsa', 'info'],
};

function periods() {
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const minus = (days) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  return [
    { key: '12m', label: 'Últimos 12 meses', start: minus(365), end: null },
    { key: '6m', label: 'Últimos 6 meses', start: minus(182), end: null },
    { key: 'cur', label: String(year), start: `${year}-01-01`, end: `${year}-12-31` },
    { key: 'prev', label: String(year - 1), start: `${year - 1}-01-01`, end: `${year - 1}-12-31` },
  ];
}

export default function webHistory(root, { query }) {
  const screen = createScreen(root);
  const s = {
    me: null, condo: null, by: 'location', period: '12m',
    groups: [], selectedId: query.local || null, data: null, loadingData: false,
  };
  const period = () => periods().find((p) => p.key === s.period);

  async function load() {
    screen.paint(loadingView());
    try {
      [s.me, s.condo] = await Promise.all([api.me(), api.condominium()]);
      if (!isStaff(s.me)) return screen.paint(webShell('historico', s.me, s.condo, webDenied()));
      await loadGroups();
    } catch (err) {
      screen.paint(errorView(err));
    }
  }

  async function loadGroups() {
    const p = period();
    s.groups = await api.historyGroups({ by: s.by, start: p.start, end: p.end });
    if (!s.groups.some((g) => g.id === s.selectedId)) {
      // Um local vindo do painel pode não ter nada concluído no período: ainda assim mostra o histórico dele.
      if (!(s.selectedId && s.by === 'location' && query.local === s.selectedId)) s.selectedId = s.groups[0]?.id || null;
    }
    await loadData();
  }

  async function loadData() {
    s.data = null;
    if (!s.selectedId) return paint();
    s.loadingData = true;
    paint();
    const p = period();
    const key = s.by === 'location' ? 'location_id' : 'maintenance_type_id';
    try {
      s.data = await api.history({ [key]: s.selectedId, start: p.start, end: p.end });
    } finally {
      s.loadingData = false;
      if (screen.alive()) paint();
    }
  }

  async function selectedName() {
    const g = s.groups.find((x) => x.id === s.selectedId);
    if (g) return g.name;
    const list = s.by === 'location' ? await api.maintenanceLocations() : await api.maintenanceTypes();
    return list.find((x) => x.id === s.selectedId)?.name || '';
  }

  function records() {
    if (s.loadingData) return html`<div class="spinner" style="margin:32px auto"></div>`;
    const d = s.data;
    if (!d || !d.records.length) return html`<div class="empty" style="margin:16px">Nenhuma manutenção concluída no período.</div>`;
    return html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Data</th><th>Manutenção</th><th>${s.by === 'location' ? 'Tipo' : 'Local'}</th><th>Origem</th><th>Responsável</th><th style="text-align:right">Custo</th></tr></thead>
          <tbody>
            ${d.records.map((r) => {
              const [label, tone] = ORIGIN_TAG[r.origin];
              return html`
                <tr>
                  <td class="cell-muted">${shortDate(r.finished_at)}</td>
                  <td><div class="row-btn__code">${r.code}</div><div style="font-weight:600">${r.title}</div></td>
                  <td>${s.by === 'location' ? r.maintenance_type.name : r.location.name}</td>
                  <td><span class="tag tag--${tone}">${label}</span></td>
                  <td>${r.provider?.name || '—'}${r.provider_contract_type ? html`<div class="row-btn__sub">${CONTRACT[r.provider_contract_type]}</div>` : r.provider_kind === 'employee' ? html`<div class="row-btn__sub">Equipe interna</div>` : ''}</td>
                  <td style="text-align:right">${money(r.cost)}</td>
                </tr>`;
            })}
          </tbody>
        </table>
      </div>`;
  }

  async function paint() {
    const name = await selectedName();
    const d = s.data;
    const total = d?.total ?? 0;
    const cost = d ? d.records.reduce((sum, r) => sum + (Number(r.cost) || 0), 0) : 0;
    if (!screen.alive()) return;
    screen.paint(webShell('historico', s.me, s.condo, html`
      <div class="web__head">
        <div>
          <h1 class="web__title">Histórico de manutenções</h1>
          <div class="web__sub">Consulte tudo o que já foi feito por local ou por tipo de manutenção</div>
        </div>
        <div class="web__actions">
          <label for="h-periodo" class="hint">Período</label>
          <select id="h-periodo" class="select" data-change="period">
            ${periods().map((p) => html`<option value="${p.key}" ${p.key === s.period ? 'selected' : ''}>${p.label}</option>`)}
          </select>
          <button type="button" class="btn btn--ghost" data-action="print">${icon('download', 16)} Exportar PDF</button>
        </div>
      </div>
      <div class="split split--left">
        <section class="panel-card" aria-label="Filtro" style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div class="segmented" role="group" aria-label="Agrupar por">
            <button type="button" data-action="by" data-by="location" data-focus-key="by-l" aria-pressed="${s.by === 'location' ? 'true' : 'false'}">Por local</button>
            <button type="button" data-action="by" data-by="type" data-focus-key="by-t" aria-pressed="${s.by === 'type' ? 'true' : 'false'}">Por tipo</button>
          </div>
          <div class="stack" style="gap:2px">
            ${s.groups.length
              ? s.groups.map((g) => html`
                <button type="button" class="list-btn" data-action="key" data-id="${g.id}" data-focus-key="g-${g.id}" aria-pressed="${g.id === s.selectedId ? 'true' : 'false'}">
                  <span>${g.name}</span><span class="count-pill">${g.count}</span>
                </button>`)
              : html`<div class="hint" style="padding:8px">Nada concluído no período.</div>`}
          </div>
        </section>
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
          <div class="kpis">
            <div class="panel-card kpi"><div class="kpi__label">${name || '—'}</div><div class="kpi__value">${total}</div><div class="kpi__sub">manutenções registradas</div></div>
            <div class="panel-card kpi"><div class="kpi__label"><span class="kpi__dot" style="background:var(--accent)"></span>Preventivas</div><div class="kpi__value">${d?.by_origin.preventive ?? 0}</div><div class="kpi__sub">por agenda ou evento</div></div>
            <div class="panel-card kpi"><div class="kpi__label"><span class="kpi__dot" style="background:var(--danger)"></span>Corretivas</div><div class="kpi__value">${d?.by_origin.resident ?? 0}</div><div class="kpi__sub">abertas por moradores${d?.by_origin.manual ? ` · ${d.by_origin.manual} avulsa(s)` : ''}</div></div>
            <div class="panel-card kpi"><div class="kpi__label">Última manutenção</div><div class="kpi__value" style="font-size:22px">${d?.last ? shortDate(d.last.finished_at) : '—'}</div><div class="kpi__sub">${d?.last?.title || 'sem registros'}</div></div>
          </div>
          <section class="panel-card" aria-label="Registros">
            <div class="panel-card__head">
              <h2 class="panel-card__title">Registros · ${name || '—'}</h2>
              <div style="flex:1"></div>
              ${cost ? html`<span class="hint">Custo total ${money(cost)}</span>` : ''}
            </div>
            ${records()}
          </section>
        </div>
      </div>`));
  }

  screen.on({
    ...errorHandlers(load),
    by: async (d) => {
      if (s.by === d.by) return;
      s.by = d.by;
      s.selectedId = null;
      await loadGroups();
    },
    key: (d) => {
      s.selectedId = d.id;
      loadData();
    },
    print: () => window.print(),
  });
  screen.el.addEventListener('change', (e) => {
    if (e.target.dataset.change === 'period') {
      s.period = e.target.value;
      loadGroups();
    }
  });
  load();
}
