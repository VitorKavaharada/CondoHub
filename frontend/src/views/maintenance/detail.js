// Morador — acompanhar status (Acompanhamento.dc.html) e solicitação recusada (Recusada.dc.html)
import { api, fileHref } from '../../api.js';
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import {
  INCIDENT_STATUS, INCIDENT_STEPS, MONTHS, PRIORITY, REJECTION, hourLabel, isoDateOf, shortDateTime, timeOf, visitLabel,
} from '../../format.js';
import { autoRefresh, comingSoon, createScreen, errorHandlers, errorView, loadingView, spin, toast, topbar } from '../../ui.js';
import { incidentTag } from './shared.js';

const STEP_DESC = {
  submitted: 'Solicitação recebida pelo síndico.',
  under_review: 'O síndico está avaliando o pedido.',
  approved: 'Prioridade e responsável definidos.',
  in_progress: 'O responsável está executando o serviço.',
  done: 'Serviço concluído.',
  rejected: 'Solicitação recusada.',
};

export default function maintenanceDetail(root, { params: [id] }) {
  const screen = createScreen(root);
  let inc = null;
  let rating = 0;
  let feedback = '';
  let sending = false;

  async function load({ silent = false } = {}) {
    if (!silent) screen.paint(loadingView());
    try {
      const next = await api.incident(id);
      if (silent && inc && next.status !== inc.status) toast(`Status atualizado: ${INCIDENT_STATUS[next.status]?.label || next.status}`);
      inc = next;
      paint();
    } catch (err) {
      if (silent) throw err;
      screen.paint(errorView(err, { back: '#/manutencao' }));
    }
  }

  function timeline() {
    const entry = (status) => [...inc.history].reverse().find((h) => h.status === status);
    let steps;
    if (inc.status === 'rejected') {
      steps = inc.history.map((h) => ({ status: h.status, state: h.status === 'rejected' ? 'rejected' : 'done', h }));
    } else {
      const current = INCIDENT_STEPS.indexOf(inc.status);
      steps = INCIDENT_STEPS.map((status, i) => ({
        status,
        h: entry(status),
        state: i < current || inc.status === 'done' ? 'done' : i === current ? 'current' : 'todo',
      }));
    }
    return html`
      <ol class="timeline">
        ${steps.map((s) => html`
          <li class="${s.state}">
            <span class="timeline__dot">${s.state === 'done' ? icon('check', 12, 3) : s.state === 'rejected' ? icon('x', 12, 3) : ''}</span>
            <div>
              <div class="timeline__title">
                <span>${INCIDENT_STATUS[s.status].label}</span>
                ${s.h ? html`<span class="timeline__when">${shortDateTime(s.h.changed_at)}</span>` : ''}
              </div>
              ${s.state !== 'todo' ? html`<div class="timeline__desc">${s.h?.note || STEP_DESC[s.status]}</div>` : ''}
            </div>
          </li>`)}
      </ol>`;
  }

  function approvedBanner() {
    if (!['approved', 'in_progress'].includes(inc.status) || !inc.assigned_provider) return '';
    const visit = visitLabel(inc.scheduled_start_at, inc.scheduled_end_at);
    const text = inc.status === 'in_progress'
      ? `${inc.assigned_provider.name} está executando o serviço.`
      : `${inc.assigned_provider.name} foi designado(a).${visit ? ` Visita prevista para ${visit}.` : ''}`;
    return html`
      <div class="notice">${icon('check', 18, 2.2)}<div><strong>${inc.status === 'in_progress' ? 'Manutenção em execução' : 'Solicitação aprovada'}</strong><br>${text}</div></div>`;
  }

  function rejection() {
    if (inc.status !== 'rejected') return '';
    const rel = inc.related_incident;
    const relWhen = rel?.scheduled_start_at;
    return html`
      <div class="alert-card">
        ${icon('x', 20, 2.2)}
        <span>
          <span class="alert-card__title" style="display:block">Solicitação recusada</span>
          <span class="alert-card__text" style="display:block">Pelo ${inc.reviewed_by ? `síndico (${inc.reviewed_by.name})` : 'síndico'}${inc.reviewed_at ? ` · ${shortDateTime(inc.reviewed_at).replace(' · ', ' às ')}` : ''}</span>
        </span>
      </div>
      <div class="card card--pad">
        <div class="side__label">Justificativa</div>
        <div style="font-size:14px;font-weight:600;margin-top:6px">${REJECTION[inc.rejection_reason] || 'Recusada'}</div>
        ${inc.rejection_note ? html`<div class="side__text" style="margin-top:4px">${inc.rejection_note}</div>` : ''}
      </div>
      ${rel
        ? html`
          <div>
            <div class="section-label">Manutenção já agendada</div>
            <div class="card card--pad" style="display:flex;gap:12px;align-items:center">
              ${relWhen
                ? html`<div class="date-chip"><div class="date-chip__m">${MONTHS[Number(isoDateOf(relWhen).slice(5, 7)) - 1].slice(0, 3).toUpperCase()}</div><div class="date-chip__d">${Number(isoDateOf(relWhen).slice(8, 10))}</div></div>`
                : html`<span class="tile-icon">${icon('calendar', 20)}</span>`}
              <div style="min-width:0">
                <div class="row-link__title">${rel.title}</div>
                <div class="row-link__sub">${rel.location.name}${relWhen ? ` · ${hourLabel(`${timeOf(relWhen)}:00`)}${rel.scheduled_end_at ? `–${hourLabel(`${timeOf(rel.scheduled_end_at)}:00`)}` : ''}` : ''}${rel.assigned_provider ? ` · ${rel.assigned_provider.name}` : ''}</div>
              </div>
            </div>
          </div>`
        : ''}`;
  }

  function ratingBlock() {
    if (inc.status !== 'done') return '';
    if (inc.resident_rating) {
      return html`
        <div class="card card--pad">
          <div class="side__label">Sua avaliação</div>
          <div class="stars" style="margin-top:8px" aria-label="${inc.resident_rating} de 5 estrelas">
            ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" disabled aria-pressed="${n <= inc.resident_rating ? 'true' : 'false'}">★</button>`)}
          </div>
          ${inc.resident_feedback ? html`<div class="side__text" style="margin-top:8px">${inc.resident_feedback}</div>` : ''}
        </div>`;
    }
    return html`
      <div class="card panel">
        <div class="panel__title">Como foi o serviço?</div>
        <div class="stars" role="group" aria-label="Nota de 1 a 5">
          ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-action="star" data-n="${n}" data-focus-key="star-${n}" aria-pressed="${n <= rating ? 'true' : 'false'}" aria-label="${n} ${n === 1 ? 'estrela' : 'estrelas'}">★</button>`)}
        </div>
        <div class="field">
          <label for="m-feedback">Comentário (opcional)</label>
          <textarea id="m-feedback" class="textarea" name="feedback" style="min-height:70px">${feedback}</textarea>
        </div>
        <button type="button" class="btn btn--primary" data-action="rate" ${rating && !sending ? '' : 'disabled'}>${sending ? html`${spin()} Enviando…` : 'Enviar avaliação'}</button>
      </div>`;
  }

  function paint() {
    const prio = inc.priority ? `${PRIORITY[inc.priority].label} · ${PRIORITY[inc.priority].sla}` : 'A definir';
    screen.paint(html`
      ${topbar({ back: '#/manutencao', title: 'Acompanhar', subtitle: `Protocolo ${inc.code}` })}
      <main class="content" style="padding-top:14px;gap:14px">
        <div class="card card--pad" style="display:flex;flex-direction:column;gap:12px">
          <div class="incident__top">
            <div style="flex:1;min-width:0">
              <div class="incident__meta">${inc.maintenance_type.name} · ${inc.location.name}</div>
              <div class="incident__title" style="font-family:var(--font-display);font-size:18px">${inc.title}</div>
            </div>
            ${incidentTag(inc.status)}
          </div>
          ${inc.description ? html`<div class="side__text">${inc.description}</div>` : ''}
          ${inc.attachments.length
            ? html`<div class="photo-row">${inc.attachments.map((a, i) => html`<a href="${fileHref(a.file_url)}" target="_blank" rel="noopener">Foto ${i + 1}</a>`)}</div>`
            : ''}
          <div class="facts">
            <div class="fact"><div class="fact__label">Aberta em</div><div class="fact__value">${shortDateTime(inc.created_at)}</div></div>
            <div class="fact"><div class="fact__label">Prioridade</div><div class="fact__value">${inc.status === 'rejected' ? '—' : prio}</div></div>
          </div>
        </div>
        ${approvedBanner()}
        ${rejection()}
        <section class="card card--pad">
          <h2 class="section-label" style="margin-top:0">Linha do tempo</h2>
          ${timeline()}
        </section>
        ${ratingBlock()}
      </main>
      <footer class="footer footer--plain">
        ${inc.status === 'rejected'
          ? html`
            <a class="btn btn--primary" href="#/manutencao/nova">Abrir nova solicitação</a>
            <button type="button" class="btn btn--text" data-action="soon" data-label="O chat com o síndico">Contestar com o síndico</button>`
          : html`<button type="button" class="btn btn--ghost" data-action="soon" data-label="O chat com o síndico">${icon('chat', 18)} Enviar mensagem ao síndico</button>`}
      </footer>`);
  }

  screen.on({
    ...errorHandlers(load),
    soon: comingSoon,
    star: (d) => {
      rating = Number(d.n);
      paint();
    },
    rate: async () => {
      sending = true;
      paint();
      try {
        inc = await api.rateIncident(inc.id, { rating, feedback: feedback.trim() || null });
        toast.success('Obrigado pela avaliação!');
      } catch (err) {
        toast.error(err.message);
      }
      sending = false;
      if (screen.alive()) paint();
    },
  });
  screen.el.addEventListener('input', (e) => {
    if (e.target.name === 'feedback') feedback = e.target.value;
  });
  load();
  // A linha do tempo acompanha as decisões do síndico sem recarregar (pausa enquanto avalia).
  autoRefresh(screen, async () => {
    if (!sending && !rating && !feedback) await load({ silent: true });
  });
}
