// Síndico (web) — agenda preventiva e regras (WebAgenda.dc.html)
import { api } from '../../api.js';
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import {
  FREQUENCY, PREVENTIVE_EVENT, WINDOW, addMonths, hhmm, hourLabel, isoDateOf, monthLabel, monthOf, shortDate,
  shortDateTime, timeOf, todayIso, weekdayOf,
} from '../../format.js';
import { createScreen, errorHandlers, errorView, loadingView, switchButton, toast, spin } from '../../ui.js';
import { isStaff, webDenied, webShell } from './shared.js';

const KIND_LABEL = { recurring: 'Recorrente', event: 'Por evento (reserva)', manual: 'Avulsa', corrective: 'Corretiva' };
const WEEKDAYS_MON = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const emptyRule = (locations, types, providers) => ({
  name: '', trigger_type: 'recurring', frequency: 'monthly', first_run_date: todayIso(), run_time: '08:00',
  trigger_event: 'reservation_ended', execution_window: 'within_4h',
  location_id: locations[0]?.id || '', maintenance_type_id: types.find((t) => t.name === 'Limpeza')?.id || types[0]?.id || '',
  default_provider_id: providers[0]?.id || '', description: '',
});

export default function webAgenda(root) {
  const screen = createScreen(root);
  const s = {
    me: null, condo: null, month: monthOf(todayIso()), events: [], rules: [],
    locations: [], types: [], providers: [], form: null, busy: false, error: null,
  };

  async function load() {
    screen.paint(loadingView());
    try {
      [s.me, s.condo] = await Promise.all([api.me(), api.condominium()]);
      if (!isStaff(s.me)) return screen.paint(webShell('preventivas', s.me, s.condo, webDenied()));
      [s.locations, s.types, s.providers, s.rules] = await Promise.all([
        api.maintenanceLocations(), api.maintenanceTypes(), api.providers({ active: true }), api.preventives(),
      ]);
      await loadMonth();
    } catch (err) {
      screen.paint(errorView(err));
    }
  }

  async function loadMonth() {
    s.events = (await api.maintenanceCalendar(s.month)).events;
    paint();
  }

  function calendar() {
    const first = `${s.month}-01`;
    const offset = (weekdayOf(first) + 6) % 7; // semana começando na segunda
    const [y, m] = s.month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const byDay = {};
    for (const e of s.events) (byDay[isoDateOf(e.starts_at)] ||= []).push(e);
    const total = Math.ceil((offset + days) / 7) * 7;
    const today = todayIso();
    const cells = Array.from({ length: total }, (_, i) => {
      const n = i - offset + 1;
      if (n < 1 || n > days) return html`<div class="month__cell month__cell--out" aria-hidden="true"></div>`;
      const date = `${s.month}-${String(n).padStart(2, '0')}`;
      const evs = byDay[date] || [];
      return html`
        <div class="month__cell ${date === today ? 'month__cell--today' : ''}">
          <span class="month__n">${n}</span>
          ${evs.slice(0, 3).map((e) => html`
            <div class="ev ev--${e.kind} ${e.projected ? 'ev--projected' : ''}" title="${timeOf(e.starts_at)} · ${e.title} · ${e.location.name}${e.provider ? ` · ${e.provider.name}` : ''}${e.projected ? ' (prevista)' : ''}">
              ${timeOf(e.starts_at)} ${e.title}
            </div>`)}
          ${evs.length > 3 ? html`<div class="hint">+${evs.length - 3} mais</div>` : ''}
        </div>`;
    });
    return html`
      <section class="panel-card" aria-label="Calendário de ${monthLabel(s.month)}">
        <div class="panel-card__head">
          <button type="button" class="icon-btn icon-btn--sm" data-action="month" data-delta="-1" aria-label="Mês anterior">${icon('chevron-left', 15, 2)}</button>
          <h2 class="panel-card__title" style="min-width:150px;text-align:center">${monthLabel(s.month).replace(/^./, (c) => c.toUpperCase()).replace(' de ', ' ')}</h2>
          <button type="button" class="icon-btn icon-btn--sm" data-action="month" data-delta="1" aria-label="Próximo mês">${icon('chevron-right', 15, 2)}</button>
          <div style="flex:1"></div>
          <div class="prio-legend">
            <span><span class="legend-dot" style="background:var(--accent)"></span> Recorrente</span>
            <span><span class="legend-dot" style="background:#A86F12"></span> Por evento (reserva)</span>
            <span><span class="legend-dot" style="background:var(--info)"></span> Avulsa</span>
            <span><span class="legend-dot" style="background:var(--danger)"></span> Corretiva</span>
            <span><span class="legend-dot" style="border:1px dashed var(--ink-2)"></span> Prevista</span>
          </div>
        </div>
        <div class="month" role="grid">
          ${WEEKDAYS_MON.map((w) => html`<div class="month__wd" role="columnheader">${w}</div>`)}
          ${cells}
        </div>
        ${s.events.length ? '' : html`<div class="hint" style="padding:12px 16px">Nenhuma manutenção prevista neste mês.</div>`}
      </section>`;
  }

  function ruleWhen(r) {
    if (r.trigger_type === 'recurring') {
      return `${FREQUENCY[r.frequency]} · desde ${shortDate(r.first_run_date)} às ${hourLabel(r.run_time || '08:00:00')}`;
    }
    return `Após ${PREVENTIVE_EVENT[r.trigger_event].toLowerCase()} · ${WINDOW[r.execution_window]}`;
  }

  function rulesPanel() {
    return html`
      <section class="panel-card" aria-label="Regras">
        <div class="panel-card__head"><h2 class="panel-card__title">Regras (${s.rules.filter((r) => r.is_active).length} ativas)</h2></div>
        ${s.rules.map((r) => html`
          <div class="rule">
            <div class="rule__body">
              <span class="tag ${r.trigger_type === 'recurring' ? 'tag--accent' : 'tag--warn'}">${r.trigger_type === 'recurring' ? 'Recorrente' : 'Por evento'}</span>
              <div class="rule__title">${r.name}</div>
              <div class="rule__sub">${r.location.name} · ${ruleWhen(r)}</div>
              <div class="rule__sub">${r.default_provider?.name || 'Sem responsável'}${r.is_active && r.next_run_at ? ` · próxima ${shortDateTime(r.next_run_at)}` : ''}${r.is_active ? '' : ' · pausada'}</div>
            </div>
            ${switchButton({ action: `toggle-${r.id}`, checked: r.is_active, label: `${r.is_active ? 'Pausar' : 'Ativar'} ${r.name}` })}
          </div>`)}
      </section>`;
  }

  function summary(f) {
    const loc = s.locations.find((l) => l.id === f.location_id)?.name || 'o local';
    const prov = s.providers.find((p) => p.id === f.default_provider_id)?.name || 'sem responsável';
    if (f.trigger_type === 'recurring') {
      return `${FREQUENCY[f.frequency]}, a partir de ${f.first_run_date ? shortDate(f.first_run_date) : '—'} às ${f.run_time}, em ${loc}. Responsável: ${prov}.`;
    }
    return `Sempre que houver ${PREVENTIVE_EVENT[f.trigger_event].toLowerCase()} em ${loc}, executar ${WINDOW[f.execution_window]}. Responsável: ${prov}.`;
  }

  function formPanel() {
    const f = s.form;
    const rec = f.trigger_type === 'recurring';
    const opts = (map, value) => Object.entries(map).map(([k, l]) => html`<option value="${k}" ${k === value ? 'selected' : ''}>${l}</option>`);
    return html`
      <section class="panel-card side" aria-label="Nova regra">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 class="side__title">Nova regra</h2>
          <button type="button" class="icon-btn icon-btn--sm" data-action="close-form" aria-label="Fechar formulário">${icon('x', 16, 2)}</button>
        </div>
        <div class="field"><label for="wr-nome">Nome da manutenção</label><input id="wr-nome" class="input" name="name" value="${f.name}" placeholder="Ex.: Limpeza pós-reserva do espaço gourmet" autocomplete="off"></div>
        <div class="segmented" role="group" aria-label="Quando acontece">
          <button type="button" data-action="trigger" data-t="recurring" data-focus-key="t-r" aria-pressed="${rec ? 'true' : 'false'}">Recorrente</button>
          <button type="button" data-action="trigger" data-t="event" data-focus-key="t-e" aria-pressed="${rec ? 'false' : 'true'}">Por evento</button>
        </div>
        ${rec
          ? html`
            <div class="field"><label for="wr-freq">Frequência</label><select id="wr-freq" class="select" name="frequency">${opts(FREQUENCY, f.frequency)}</select></div>
            <div class="grid-2">
              <div class="field"><label for="wr-inicio">Primeira data</label><input id="wr-inicio" class="input" type="date" name="first_run_date" value="${f.first_run_date}"></div>
              <div class="field"><label for="wr-hora">Horário</label><input id="wr-hora" class="input" type="time" name="run_time" value="${f.run_time}"></div>
            </div>`
          : html`
            <div class="field"><label for="wr-evento">Evento</label><select id="wr-evento" class="select" name="trigger_event">${opts(PREVENTIVE_EVENT, f.trigger_event)}</select></div>
            <div class="field"><label for="wr-prazo">Executar</label><select id="wr-prazo" class="select" name="execution_window">${opts(WINDOW, f.execution_window)}</select></div>`}
        <div class="grid-2">
          <div class="field"><label for="wr-local">Local</label><select id="wr-local" class="select" name="location_id">${s.locations.map((l) => html`<option value="${l.id}" ${l.id === f.location_id ? 'selected' : ''}>${l.name}</option>`)}</select></div>
          <div class="field"><label for="wr-tipo">Tipo</label><select id="wr-tipo" class="select" name="maintenance_type_id">${s.types.map((t) => html`<option value="${t.id}" ${t.id === f.maintenance_type_id ? 'selected' : ''}>${t.name}</option>`)}</select></div>
        </div>
        <div class="field"><label for="wr-resp">Responsável</label><select id="wr-resp" class="select" name="default_provider_id">${s.providers.map((p) => html`<option value="${p.id}" ${p.id === f.default_provider_id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
        <div class="notice">${icon('info', 18)}<div data-summary>${summary(f)}</div></div>
        ${s.error ? html`<div class="notice notice--danger" role="alert">${icon('alert', 18)}<div>${s.error}</div></div>` : ''}
        <button type="button" class="btn btn--primary btn--block" data-action="save" ${s.busy ? 'disabled' : ''}>${s.busy ? html`${spin()} Salvando…` : 'Salvar regra'}</button>
      </section>`;
  }

  function paint() {
    screen.paint(webShell('preventivas', s.me, s.condo, html`
      <div class="web__head">
        <div>
          <h1 class="web__title">Manutenções preventivas</h1>
          <div class="web__sub">Agenda gerada pelas regras recorrentes e por eventos de reserva</div>
        </div>
        <div class="web__actions">
          <button type="button" class="btn btn--ghost" data-action="run" ${s.busy ? 'disabled' : ''} title="Na produção isto roda sozinho num agendador">${icon('clock', 16)} Gerar preventivas agora</button>
          <button type="button" class="btn btn--primary" data-action="new">${icon('plus', 16, 2.2)} Nova regra</button>
        </div>
      </div>
      <div class="split">
        ${calendar()}
        ${s.form ? formPanel() : rulesPanel()}
      </div>`));
  }

  function payload(f) {
    const rec = f.trigger_type === 'recurring';
    return {
      name: f.name.trim(),
      description: f.description.trim() || null,
      trigger_type: f.trigger_type,
      location_id: f.location_id,
      maintenance_type_id: f.maintenance_type_id,
      default_provider_id: f.default_provider_id || null,
      frequency: rec ? f.frequency : null,
      first_run_date: rec ? f.first_run_date : null,
      run_time: rec ? f.run_time : null,
      trigger_event: rec ? null : f.trigger_event,
      execution_window: rec ? null : f.execution_window,
    };
  }

  screen.on({
    ...errorHandlers(load),
    month: async (d) => {
      s.month = addMonths(s.month, Number(d.delta));
      await loadMonth();
    },
    new: () => {
      s.form = emptyRule(s.locations, s.types, s.providers);
      s.error = null;
      paint();
      screen.el.querySelector('#wr-nome')?.focus();
    },
    'close-form': () => {
      s.form = null;
      s.error = null;
      paint();
    },
    trigger: (d) => {
      s.form.trigger_type = d.t;
      paint();
    },
    save: async () => {
      const f = s.form;
      if (!f.name.trim()) {
        s.error = 'Informe o nome da manutenção';
        return paint();
      }
      if (f.trigger_type === 'recurring' && !f.first_run_date) {
        s.error = 'Informe a primeira data';
        return paint();
      }
      s.busy = true;
      s.error = null;
      paint();
      try {
        await api.createPreventive(payload(f));
        s.rules = await api.preventives();
        s.form = null;
        toast.success('Regra criada');
        await loadMonth();
      } catch (err) {
        s.error = err.message;
      }
      s.busy = false;
      if (screen.alive()) paint();
    },
    run: async () => {
      s.busy = true;
      paint();
      try {
        const res = await api.runPreventiveJob();
        toast(res.created.length ? `${res.created.length} manutenção(ões) gerada(s): ${res.created.join(', ')}` : 'Nenhuma preventiva vencida para gerar agora');
        s.rules = await api.preventives();
        await loadMonth();
      } catch (err) {
        toast.error(err.message);
      }
      s.busy = false;
      if (screen.alive()) paint();
    },
  });

  // Liga/pausa regra: data-action="toggle-<id>"
  screen.el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action^="toggle-"]');
    if (!btn || !screen.el.contains(btn)) return;
    const rule = s.rules.find((r) => `toggle-${r.id}` === btn.dataset.action);
    if (!rule) return;
    try {
      const updated = await api.updatePreventive(rule.id, { is_active: !rule.is_active });
      s.rules = s.rules.map((r) => (r.id === rule.id ? updated : r));
      toast(updated.is_active ? 'Regra reativada' : 'Regra pausada');
      await loadMonth();
    } catch (err) {
      toast.error(err.message);
    }
  });

  const sync = (e) => {
    if (!s.form || !(e.target.name in s.form)) return;
    s.form[e.target.name] = e.target.value;
    const box = screen.el.querySelector('[data-summary]');
    if (box) box.textContent = summary(s.form);
  };
  screen.el.addEventListener('input', sync);
  screen.el.addEventListener('change', sync);
  load();
}
