// Síndico (web) — painel de manutenções (WebPainel.dc.html): indicadores, lista, decisão e execução.
import { api } from '../../api.js';
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import {
  INCIDENT_STATUS, ORIGIN, PRIORITY, REJECTION, dateLongLabel, localToIso, money, shortDate, shortDateTime, todayIso, visitLabel,
} from '../../format.js';
import { autoRefresh, createScreen, errorHandlers, errorView, loadingView, spin, toast } from '../../ui.js';
import { downloadCsv, incidentTag, isStaff, priorityTag, webDenied, webShell } from './shared.js';

const STATUS_CHIPS = [
  ['all', 'Todas'], ['submitted', 'Novas'], ['under_review', 'Em análise'], ['approved', 'Aprovadas'],
  ['in_progress', 'Em execução'], ['done', 'Concluídas'], ['rejected', 'Recusadas'],
];
const PRIO_COLORS = { high: 'var(--danger)', medium: '#C98A1B', low: 'var(--accent)', none: 'var(--line-strong)' };

const emptyDecision = () => ({
  mode: 'approve', priority: 'medium', providerId: '', date: '', start: '09:00', end: '12:00',
  reason: '', note: '', relatedId: '', cost: '',
});

export default function webPanel(root) {
  const screen = createScreen(root);
  const s = {
    me: null, condo: null, summary: null, incidents: [], providers: [], locations: [], types: [],
    status: 'all', prio: 'todas', search: '',
    selectedId: null, detail: null, detailLoading: false, typeProviders: [],
    decision: emptyDecision(), busy: false, error: null, done: null,
    side: 'detail', sched: null,
  };

  async function load() {
    screen.paint(loadingView());
    try {
      [s.me, s.condo] = await Promise.all([api.me(), api.condominium()]);
      if (!isStaff(s.me)) return screen.paint(webShell('painel', s.me, s.condo, webDenied()));
      [s.providers, s.locations, s.types] = await Promise.all([
        api.providers({ active: true }), api.maintenanceLocations(), api.maintenanceTypes(),
      ]);
      await refresh();
      const first = s.incidents.find((i) => ['submitted', 'under_review'].includes(i.status)) || s.incidents[0];
      if (first) await select(first.id);
      else paint();
    } catch (err) {
      screen.paint(errorView(err));
    }
  }

  async function refresh() {
    [s.summary, s.incidents] = await Promise.all([api.incidentsSummary(), api.incidents({ limit: 500 })]);
  }

  async function select(id) {
    s.selectedId = id;
    s.side = 'detail';
    s.done = null;
    s.error = null;
    s.decision = emptyDecision();
    s.detailLoading = true;
    paint();
    try {
      let inc = s.incidents.find((i) => i.id === id);
      // Abrir uma solicitação nova no painel a coloca "em análise" (POST /review), como pede a API.
      if (inc?.status === 'submitted') {
        await api.reviewIncident(id);
        await refresh();
        inc = s.incidents.find((i) => i.id === id);
      }
      const [detail, typeProviders] = await Promise.all([
        api.incident(id),
        inc ? api.providers({ active: true, maintenance_type_id: inc.maintenance_type.id }).catch(() => []) : [],
      ]);
      if (s.selectedId !== id) return;
      s.detail = detail;
      s.typeProviders = typeProviders.length ? typeProviders : s.providers;
      s.decision.providerId = s.typeProviders[0]?.id || '';
      s.decision.relatedId = detail.location_context.upcoming[0]?.id || '';
    } catch (err) {
      s.error = err.message;
    }
    s.detailLoading = false;
    paint();
  }

  function filtered() {
    const q = s.search.trim().toLowerCase();
    return s.incidents.filter((i) => {
      if (s.status !== 'all' && i.status !== s.status) return false;
      if (s.prio === 'nd' && i.priority) return false;
      if (!['todas', 'nd'].includes(s.prio) && i.priority !== s.prio) return false;
      if (!q) return true;
      return [i.code, i.title, i.location.name, i.requested_by?.name, i.unit?.label].some((v) => v && v.toLowerCase().includes(q));
    });
  }

  const origin = (i) => (i.origin === 'resident' ? i.requested_by?.name || ORIGIN.resident : ORIGIN[i.origin]);

  function kpis() {
    const by = s.summary.by_status;
    const items = [
      ['Novas', by.submitted, 'aguardam análise', 'var(--warn)'],
      ['Em análise', by.under_review, 'decisão pendente', '#C98A1B'],
      ['Aprovadas', by.approved, 'aguardam execução', 'var(--accent)'],
      ['Em execução', by.in_progress, 'com responsável em campo', 'var(--info)'],
      ['Concluídas', s.summary.done_this_month, 'neste mês', 'var(--muted)'],
    ];
    const op = s.summary.open_by_priority;
    const total = op.high + op.medium + op.low + op.none || 1;
    return html`
      <div class="kpis">
        ${items.map(([label, value, sub, color]) => html`
          <div class="panel-card kpi">
            <div class="kpi__label"><span class="kpi__dot" style="background:${color}"></span>${label}</div>
            <div class="kpi__value">${value}</div>
            <div class="kpi__sub">${sub}</div>
          </div>`)}
        <div class="panel-card kpi">
          <div class="kpi__label">Prioridade das abertas</div>
          <div class="prio-bar" aria-hidden="true">
            ${['high', 'medium', 'low', 'none'].map((k) => html`<span style="width:${(op[k] / total) * 100}%;background:${PRIO_COLORS[k]}"></span>`)}
          </div>
          <div class="prio-legend"><span>Alta ${op.high}</span><span>Média ${op.medium}</span><span>Baixa ${op.low}</span>${op.none ? html`<span>Sem ${op.none}</span>` : ''}</div>
        </div>
      </div>`;
  }

  function table(rows) {
    const count = (st) => (st === 'all' ? s.incidents.length : s.incidents.filter((i) => i.status === st).length);
    return html`
      <section class="panel-card" aria-label="Lista de manutenções">
        <div class="panel-card__head">
          <div class="chips chips--filter" role="group" aria-label="Filtrar por status">
            ${STATUS_CHIPS.map(([key, label]) => html`
              <button type="button" class="chip" data-action="status" data-key="${key}" data-focus-key="st-${key}" aria-pressed="${s.status === key ? 'true' : 'false'}">${label} <span class="chip__count">${count(key)}</span></button>`)}
          </div>
          <div style="flex:1"></div>
          <label for="f-prio" class="hint">Prioridade</label>
          <select id="f-prio" class="select" data-change="prio">
            ${[['todas', 'Todas'], ['high', 'Alta'], ['medium', 'Média'], ['low', 'Baixa'], ['nd', 'Sem prioridade']].map(([v, l]) => html`<option value="${v}" ${s.prio === v ? 'selected' : ''}>${l}</option>`)}
          </select>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Solicitação</th><th>Tipo</th><th>Origem</th><th>Aberta</th><th>Prioridade</th><th>Status</th><th>Responsável</th></tr></thead>
            <tbody>
              ${rows.map((r) => html`
                <tr class="${r.id === s.selectedId ? 'is-selected' : ''}">
                  <td>
                    <button type="button" class="row-btn" data-action="select" data-id="${r.id}" data-focus-key="row-${r.id}" aria-pressed="${r.id === s.selectedId ? 'true' : 'false'}">
                      <span class="row-btn__code">${r.code}</span>
                      <span class="row-btn__title">${r.title}</span>
                      <span class="row-btn__sub">${r.location.name}</span>
                    </button>
                  </td>
                  <td>${r.maintenance_type.name}</td>
                  <td class="cell-muted">${origin(r)}</td>
                  <td class="cell-muted">${shortDate(r.created_at).slice(0, 5)}</td>
                  <td>${priorityTag(r.priority)}</td>
                  <td>${incidentTag(r.status, { staff: true })}</td>
                  <td class="cell-muted">${r.assigned_provider?.name || '—'}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        ${rows.length ? '' : html`<div class="empty" style="margin:16px">Nenhuma manutenção com esses filtros</div>`}
      </section>`;
  }

  function contextHint(d) {
    const ctx = d.location_context;
    const parts = [];
    if (ctx.upcoming.length) parts.push(`${ctx.upcoming.length} agendada(s) neste local`);
    if (ctx.last_done) parts.push(`última concluída em ${shortDate(ctx.last_done.finished_at)}: ${ctx.last_done.title}`);
    return parts.length ? parts.join(' · ') : 'Sem outras manutenções registradas neste local';
  }

  function decisionForm(d) {
    const dec = s.decision;
    const approve = dec.mode === 'approve';
    const upcoming = d.location_context.upcoming;
    return html`
      <div class="segmented" role="group" aria-label="Decisão">
        <button type="button" data-action="mode" data-mode="approve" data-focus-key="mode-a" aria-pressed="${approve ? 'true' : 'false'}">Aprovar</button>
        <button type="button" data-action="mode" data-mode="reject" data-focus-key="mode-r" aria-pressed="${approve ? 'false' : 'true'}">Recusar</button>
      </div>
      ${approve
        ? html`
          <div class="field">
            <span class="field__label">Prioridade</span>
            <div class="chips" role="group" aria-label="Prioridade">
              ${Object.entries(PRIORITY).map(([k, p]) => html`
                <button type="button" class="chip chip--block" data-action="prio" data-key="${k}" data-focus-key="p-${k}" aria-pressed="${dec.priority === k ? 'true' : 'false'}">${p.label}<small>${p.sla}</small></button>`)}
            </div>
          </div>
          <div class="field">
            <label for="w-resp">Responsável</label>
            <select id="w-resp" class="select" name="providerId">
              ${s.typeProviders.map((p) => html`<option value="${p.id}" ${p.id === dec.providerId ? 'selected' : ''}>${p.name}${p.job_title ? ` (${p.job_title.toLowerCase()})` : ''}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="w-data">Data prevista (opcional)</label>
            <input id="w-data" class="input" type="date" name="date" min="${todayIso()}" value="${dec.date}">
          </div>
          ${dec.date
            ? html`
              <div class="grid-2">
                <div class="field"><label for="w-ini">Das</label><input id="w-ini" class="input" type="time" name="start" value="${dec.start}"></div>
                <div class="field"><label for="w-fim">Até</label><input id="w-fim" class="input" type="time" name="end" value="${dec.end}"></div>
              </div>`
            : ''}`
        : html`
          <div class="field">
            <span class="field__label">Motivo</span>
            <div class="chips" role="group" aria-label="Motivo da recusa">
              ${Object.entries(REJECTION).map(([k, label]) => html`
                <button type="button" class="chip" style="text-align:left" data-action="reason" data-key="${k}" data-focus-key="r-${k}" aria-pressed="${dec.reason === k ? 'true' : 'false'}">${label}</button>`)}
            </div>
          </div>
          ${dec.reason === 'already_scheduled'
            ? upcoming.length
              ? html`
                <div class="field">
                  <label for="w-rel">Manutenção já agendada</label>
                  <select id="w-rel" class="select" name="relatedId">
                    ${upcoming.map((u) => html`<option value="${u.id}" ${u.id === dec.relatedId ? 'selected' : ''}>${u.code} · ${u.title}${u.scheduled_start_at ? ` · ${shortDate(u.scheduled_start_at).slice(0, 5)}` : ''}</option>`)}
                  </select>
                </div>`
              : html`<div class="notice notice--warn">${icon('alert', 18)}<div>Não há manutenção aprovada neste local. Escolha outro motivo.</div></div>`
            : ''}
          <div class="field">
            <label for="w-just">Justificativa para o morador</label>
            <textarea id="w-just" class="textarea" name="note" rows="3" placeholder="Explique ao morador por que o pedido foi recusado.">${dec.note}</textarea>
          </div>`}
      <button type="button" class="btn btn--primary btn--block" data-action="confirm" ${s.busy ? 'disabled' : ''}>
        ${s.busy ? html`${spin()} Salvando…` : approve ? 'Aprovar e notificar morador' : 'Recusar e notificar morador'}
      </button>`;
  }

  function executionBlock(d) {
    if (d.status === 'approved') {
      return html`
        <div class="kv card" style="margin:0">
          <div><span>Prioridade</span><span>${PRIORITY[d.priority]?.label || '—'}</span></div>
          <div><span>Responsável</span><span>${d.assigned_provider?.name || '—'}</span></div>
          <div><span>Visita</span><span>${visitLabel(d.scheduled_start_at, d.scheduled_end_at) || 'A combinar'}</span></div>
          <div><span>Prazo</span><span>${d.due_at ? shortDateTime(d.due_at) : '—'}</span></div>
        </div>
        <button type="button" class="btn btn--primary btn--block" data-action="start" ${s.busy ? 'disabled' : ''}>${s.busy ? spin() : icon('clock', 16, 2)} Iniciar execução</button>`;
    }
    if (d.status === 'in_progress') {
      return html`
        <div class="kv card" style="margin:0">
          <div><span>Responsável</span><span>${d.assigned_provider?.name || '—'}</span></div>
          <div><span>Iniciada em</span><span>${d.started_at ? shortDateTime(d.started_at) : '—'}</span></div>
        </div>
        <div class="field">
          <label for="w-cost">Custo (R$, opcional)</label>
          <input id="w-cost" class="input" name="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${s.decision.cost}">
        </div>
        <button type="button" class="btn btn--primary btn--block" data-action="finish" ${s.busy ? 'disabled' : ''}>${s.busy ? spin() : icon('check', 16, 2.4)} Concluir manutenção</button>`;
    }
    if (d.status === 'done') {
      return html`
        <div class="kv card" style="margin:0">
          <div><span>Concluída em</span><span>${shortDateTime(d.finished_at)}</span></div>
          <div><span>Responsável</span><span>${d.assigned_provider?.name || '—'}</span></div>
          <div><span>Custo</span><span>${money(d.cost)}</span></div>
          <div><span>Avaliação</span><span>${d.resident_rating ? `${'★'.repeat(d.resident_rating)}` : '—'}</span></div>
        </div>`;
    }
    if (d.status === 'rejected') {
      return html`<div class="notice notice--danger">${icon('x', 18)}<div><strong>${REJECTION[d.rejection_reason]}</strong>${d.rejection_note ? html`<br>${d.rejection_note}` : ''}</div></div>`;
    }
    return '';
  }

  function detailPanel() {
    if (s.detailLoading) return html`<section class="panel-card side"><div class="spinner" style="margin:24px auto"></div></section>`;
    const d = s.detail;
    if (!d) return html`<section class="panel-card side"><div class="hint">Selecione uma manutenção na lista.</div></section>`;
    const deciding = ['submitted', 'under_review'].includes(d.status);
    return html`
      <section class="panel-card side" aria-label="Detalhes da solicitação">
        <div class="side__meta">${d.code} · ${d.maintenance_type.name} · ${d.location.name}</div>
        <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between">
          <h2 class="side__title">${d.title}</h2>
          ${incidentTag(d.status, { staff: true })}
        </div>
        ${d.description ? html`<div class="side__text">${d.description}</div>` : ''}
        <div class="hint">${d.origin === 'resident'
          ? `Aberta por ${d.requested_by?.name || 'morador'}${d.unit ? ` (${d.unit.label})` : ''} · ${shortDateTime(d.created_at)}`
          : `${ORIGIN[d.origin]}${d.preventive_maintenance ? `: ${d.preventive_maintenance.name}` : ''} · ${shortDateTime(d.created_at)}`}</div>
        <a class="row-link" href="#/sindico/historico?local=${d.location.id}" style="padding:10px 12px">
          <span class="tile-icon tile-icon--sm">${icon('clock', 16)}</span>
          <span class="row-link__body"><span class="row-link__sub" style="display:block;margin:0">${contextHint(d)}</span></span>
          <span class="tag tag--neutral">Histórico</span>
        </a>
        ${s.done
          ? html`
            <div class="notice">${icon('check', 18, 2.2)}<div><strong>Decisão registrada</strong><br>${s.done}</div></div>`
          : ''}
        ${deciding && !s.done ? decisionForm(d) : executionBlock(d)}
        ${s.error ? html`<div class="notice notice--danger" role="alert">${icon('alert', 18)}<div>${s.error}</div></div>` : ''}
      </section>`;
  }

  function schedulePanel() {
    const f = s.sched;
    const providers = s.providers;
    return html`
      <section class="panel-card side" aria-label="Agendar manutenção avulsa">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 class="side__title">Agendar manutenção</h2>
          <button type="button" class="icon-btn icon-btn--sm" data-action="close-sched" aria-label="Fechar formulário">${icon('x', 16, 2)}</button>
        </div>
        <div class="hint">Manutenção avulsa: já nasce aprovada, sem passar por análise.</div>
        <div class="field"><label for="s-title">Título</label><input id="s-title" class="input" name="sched.title" value="${f.title}" autocomplete="off"></div>
        <div class="field"><label for="s-desc">Descrição</label><textarea id="s-desc" class="textarea" name="sched.description" style="min-height:70px">${f.description}</textarea></div>
        <div class="grid-2">
          <div class="field"><label for="s-loc">Local</label>
            <select id="s-loc" class="select" name="sched.locationId">${s.locations.map((l) => html`<option value="${l.id}" ${l.id === f.locationId ? 'selected' : ''}>${l.name}</option>`)}</select></div>
          <div class="field"><label for="s-type">Tipo</label>
            <select id="s-type" class="select" name="sched.typeId">${s.types.map((t) => html`<option value="${t.id}" ${t.id === f.typeId ? 'selected' : ''}>${t.name}</option>`)}</select></div>
        </div>
        <div class="grid-2">
          <div class="field"><label for="s-prio">Prioridade</label>
            <select id="s-prio" class="select" name="sched.priority">${Object.entries(PRIORITY).map(([k, p]) => html`<option value="${k}" ${k === f.priority ? 'selected' : ''}>${p.label} (${p.sla})</option>`)}</select></div>
          <div class="field"><label for="s-prov">Responsável</label>
            <select id="s-prov" class="select" name="sched.providerId">${providers.map((p) => html`<option value="${p.id}" ${p.id === f.providerId ? 'selected' : ''}>${p.name}</option>`)}</select></div>
        </div>
        <div class="field"><label for="s-date">Data</label><input id="s-date" class="input" type="date" name="sched.date" min="${todayIso()}" value="${f.date}"></div>
        <div class="grid-2">
          <div class="field"><label for="s-ini">Das</label><input id="s-ini" class="input" type="time" name="sched.start" value="${f.start}"></div>
          <div class="field"><label for="s-fim">Até</label><input id="s-fim" class="input" type="time" name="sched.end" value="${f.end}"></div>
        </div>
        ${s.error ? html`<div class="notice notice--danger" role="alert">${icon('alert', 18)}<div>${s.error}</div></div>` : ''}
        <button type="button" class="btn btn--primary btn--block" data-action="save-sched" ${s.busy ? 'disabled' : ''}>${s.busy ? html`${spin()} Salvando…` : 'Agendar'}</button>
      </section>`;
  }

  function paint() {
    const rows = filtered();
    const waiting = s.summary.awaiting_decision;
    const today = dateLongLabel(todayIso());
    screen.paint(webShell('painel', s.me, s.condo, html`
      <div class="web__head">
        <div>
          <h1 class="web__title">Painel de manutenções</h1>
          <div class="web__sub">${today[0].toUpperCase()}${today.slice(1)} · ${waiting === 1 ? '1 solicitação aguarda' : `${waiting} solicitações aguardam`} sua decisão</div>
        </div>
        <div class="web__actions">
          <input type="search" class="input search" data-change="search" value="${s.search}" aria-label="Buscar manutenção" placeholder="Buscar por protocolo, local ou morador">
          <button type="button" class="btn btn--ghost" data-action="csv">${icon('download', 16)} Exportar CSV</button>
          <button type="button" class="btn btn--primary" data-action="open-sched">${icon('plus', 16, 2.2)} Agendar manutenção</button>
        </div>
      </div>
      ${kpis()}
      <div class="split">
        ${table(rows)}
        ${s.side === 'schedule' ? schedulePanel() : detailPanel()}
      </div>`));
  }

  async function act(fn, message) {
    s.busy = true;
    s.error = null;
    paint();
    try {
      s.detail = await fn();
      await refresh();
      s.done = message ? message(s.detail) : null;
      toast.success(message ? 'Decisão registrada e morador notificado' : 'Status atualizado');
    } catch (err) {
      s.error = err.message;
      toast.error(err.message);
    }
    s.busy = false;
    if (screen.alive()) paint();
  }

  screen.on({
    ...errorHandlers(load),
    status: (d) => {
      s.status = d.key;
      paint();
    },
    select: (d) => select(d.id),
    mode: (d) => {
      s.decision.mode = d.mode;
      s.error = null;
      paint();
    },
    prio: (d) => {
      s.decision.priority = d.key;
      paint();
    },
    reason: (d) => {
      s.decision.reason = d.key;
      paint();
    },
    confirm: () => {
      const dec = s.decision;
      const d = s.detail;
      if (dec.mode === 'approve') {
        if (!dec.providerId) {
          s.error = 'Escolha o responsável';
          return paint();
        }
        if (dec.date && dec.end <= dec.start) {
          s.error = 'O fim da visita deve ser depois do início';
          return paint();
        }
        const provider = s.typeProviders.find((p) => p.id === dec.providerId);
        return act(
          () => api.approveIncident(d.id, {
            priority: dec.priority,
            assigned_provider_id: dec.providerId,
            scheduled_start_at: dec.date ? localToIso(dec.date, dec.start) : null,
            scheduled_end_at: dec.date ? localToIso(dec.date, dec.end) : null,
          }),
          (r) => `Aprovada com prioridade ${PRIORITY[dec.priority].label.toLowerCase()} para ${provider?.name}${r.scheduled_start_at ? `, visita em ${visitLabel(r.scheduled_start_at, r.scheduled_end_at)}` : ''}. O morador foi notificado.`,
        );
      }
      if (!dec.reason || !dec.note.trim()) {
        s.error = 'Escolha o motivo e escreva a justificativa para o morador';
        return paint();
      }
      if (dec.reason === 'already_scheduled' && !dec.relatedId) {
        s.error = 'Informe a manutenção já agendada';
        return paint();
      }
      return act(
        () => api.rejectIncident(d.id, {
          reason: dec.reason,
          note: dec.note.trim(),
          related_incident_id: dec.reason === 'already_scheduled' ? dec.relatedId : null,
        }),
        () => `Recusada: ${REJECTION[dec.reason].toLowerCase()}. O morador recebeu a justificativa.`,
      );
    },
    start: () => act(() => api.startIncident(s.detail.id)),
    finish: () => act(() => api.finishIncident(s.detail.id, { cost: s.decision.cost === '' ? null : Number(s.decision.cost) })),
    csv: () => {
      downloadCsv(
        `manutencoes-${todayIso()}.csv`,
        ['Protocolo', 'Título', 'Local', 'Tipo', 'Origem', 'Aberta em', 'Prioridade', 'Status', 'Responsável'],
        filtered().map((r) => [r.code, r.title, r.location.name, r.maintenance_type.name, origin(r), shortDate(r.created_at),
          PRIORITY[r.priority]?.label || '', INCIDENT_STATUS[r.status].staff, r.assigned_provider?.name || '']),
      );
    },
    'open-sched': () => {
      s.side = 'schedule';
      s.error = null;
      s.sched = {
        title: '', description: '', locationId: s.locations[0]?.id || '', typeId: s.types[0]?.id || '',
        priority: 'medium', providerId: s.providers[0]?.id || '', date: '', start: '08:00', end: '10:00',
      };
      paint();
      screen.el.querySelector('#s-title')?.focus();
    },
    'close-sched': () => {
      s.side = 'detail';
      s.error = null;
      paint();
    },
    'save-sched': async () => {
      const f = s.sched;
      if (!f.title.trim()) {
        s.error = 'Informe o título';
        return paint();
      }
      if (f.date && f.end <= f.start) {
        s.error = 'O fim deve ser depois do início';
        return paint();
      }
      s.busy = true;
      s.error = null;
      paint();
      try {
        const created = await api.scheduleIncident({
          title: f.title.trim(),
          description: f.description.trim() || null,
          location_id: f.locationId,
          maintenance_type_id: f.typeId,
          priority: f.priority,
          assigned_provider_id: f.providerId,
          scheduled_start_at: f.date ? localToIso(f.date, f.start) : null,
          scheduled_end_at: f.date ? localToIso(f.date, f.end) : null,
        });
        await refresh();
        toast.success(`Manutenção ${created.code} agendada`);
        s.busy = false;
        return select(created.id);
      } catch (err) {
        s.error = err.message;
        toast.error(err.message);
      }
      s.busy = false;
      if (screen.alive()) paint();
    },
  });

  const sync = (e) => {
    const t = e.target;
    if (t.dataset.change === 'prio') {
      s.prio = t.value;
      return paint();
    }
    if (t.dataset.change === 'search') {
      s.search = t.value;
      const pos = t.selectionStart;
      paint();
      const el = screen.el.querySelector('[data-change="search"]');
      el?.focus();
      el?.setSelectionRange(pos, pos);
      return;
    }
    if (!t.name) return;
    if (t.name.startsWith('sched.')) s.sched[t.name.slice(6)] = t.value;
    else if (t.name in s.decision) {
      s.decision[t.name] = t.value;
      if (t.name === 'date' && e.type === 'change') paint();
    }
  };
  screen.el.addEventListener('input', (e) => {
    if (e.target.dataset.change === 'search' || e.target.name) sync(e);
  });
  screen.el.addEventListener('change', (e) => {
    if (e.target.dataset.change === 'prio' || e.target.name) sync(e);
  });
  load();

  // Em tempo real: solicitações novas dos moradores entram na tabela e nos indicadores sem
  // recarregar. Não atualiza enquanto o síndico digita, salva ou agenda, para não atrapalhar.
  autoRefresh(screen, async () => {
    const typing = screen.el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!s.summary || s.busy || s.detailLoading || s.side === 'schedule' || typing) return;
    const before = new Set(s.incidents.map((i) => i.id));
    await refresh();
    const fresh = s.incidents.filter((i) => !before.has(i.id) && i.origin === 'resident');
    if (fresh.length) toast(fresh.length === 1 ? `Nova solicitação: ${fresh[0].title}` : `${fresh.length} novas solicitações`);
    if (screen.alive()) paint();
  }, { ms: 10000 });
}
