// Detalhes da reserva (DetalheReserva.dc.html): ver, editar e cancelar.
import { api } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { setDraft, startDraft } from '../draft.js';
import { STATUS, dateTimeLabel, hhmm, isoDateOf, reservationWhen, timeOf } from '../format.js';
import { autoRefresh, createScreen, errorHandlers, errorView, loadingView, statusTag, toast, topbar, spin } from '../ui.js';
import { isDelinquent, showDelinquencyModal } from '../delinquency.js';

export default function reservationDetail(root, { params: [id] }) {
  const screen = createScreen(root);
  let reservation = null;
  let space = null;
  let phase = 'view';
  let busy = false;
  let actionError = null;

  const editable = () => ['pending', 'confirmed'].includes(reservation.status) && new Date(reservation.start_datetime) > Date.now();

  async function load({ silent = false } = {}) {
    if (!silent) screen.paint(loadingView());
    try {
      const next = await api.reservation(id);
      if (silent && reservation && next.status !== reservation.status) toast(`Status da reserva: ${STATUS[next.status]?.label || next.status}`);
      reservation = next;
      if (!silent) space = await api.space(reservation.space.id).catch(() => null);
      paint();
    } catch (err) {
      if (silent) throw err;
      screen.paint(errorView(err, { back: '#/reservas' }));
    }
  }

  function statusNote() {
    const r = reservation;
    if (r.status === 'rejected') {
      return html`<div class="notice notice--danger">${icon('x', 18)}<div><strong>Reserva recusada.</strong> ${r.rejection_reason || 'A administração não informou o motivo.'}</div></div>`;
    }
    if (r.status === 'canceled') {
      return html`<div class="notice">${icon('info', 18)}<div>Cancelada em ${dateTimeLabel(r.canceled_at)}.${r.cancel_reason ? ` Motivo: ${r.cancel_reason}` : ''}</div></div>`;
    }
    if (!editable()) {
      return html`<div class="notice">${icon('info', 18)}<div>Esta reserva já aconteceu e não pode mais ser alterada.</div></div>`;
    }
    if (r.status === 'pending') {
      return html`<div class="notice notice--warn">${icon('clock', 18)}<div>Sua solicitação está aguardando a aprovação da administração. Você será notificado da resposta.</div></div>`;
    }
    return html`<div class="notice">${icon('info', 18)}<div>Confira se estes são os dados corretos antes de editar. As alterações valem apenas para esta reserva e voltam para aprovação.</div></div>`;
  }

  function view() {
    const r = reservation;
    const when = reservationWhen(r);
    return html`
      ${topbar({ back: '#/reservas', title: 'Detalhes da reserva' })}
      <main class="content" style="padding-top:14px;gap:14px">
        <div>${statusTag(r.status)}</div>
        <div class="card summary">
          <div class="summary__head">
            <span class="tile-icon">${icon(space?.icon, 21)}</span>
            <div class="summary__name">${r.space.name}</div>
          </div>
          <div class="summary__row">${icon('calendar', 18)}<div><div class="summary__label">Data</div><div class="summary__value">${when.date}</div></div></div>
          <div class="summary__row">${icon('clock', 18)}<div><div class="summary__label">Horário</div><div class="summary__value">${when.time}</div></div></div>
          <div class="summary__row">${icon('home', 18)}<div><div class="summary__label">Unidade</div><div class="summary__value">${r.unit.label}</div></div></div>
          <div class="summary__row">${icon('user', 18)}<div><div class="summary__label">Solicitada por</div><div class="summary__value">${r.requested_by.name} · ${dateTimeLabel(r.created_at)}</div></div></div>
        </div>
        ${statusNote()}
        ${actionError ? html`<div class="notice notice--danger">${icon('alert', 18)}<div>${actionError}</div></div>` : ''}
      </main>
      ${editable()
        ? html`
          <footer class="footer footer--plain">
            <button type="button" class="btn btn--primary" data-action="edit">${icon('edit', 18)} Editar reserva</button>
            <button type="button" class="btn btn--danger" data-action="ask-cancel">Cancelar reserva</button>
          </footer>`
        : html`<footer class="footer footer--plain"><a class="btn btn--ghost" href="#/reservas">Voltar para minhas reservas</a></footer>`}
      ${phase === 'confirm'
        ? html`
          <div class="overlay" data-action="keep">
            <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-title" data-action="noop">
              <div class="result__badge result__badge--error" style="width:56px;height:56px">${icon('alert', 26)}</div>
              <h2 class="sheet__title" id="cancel-title" style="margin:0">Cancelar esta reserva?</h2>
              <div class="sheet__text">Você perderá a reserva de ${r.space.name} em ${when.date}. Essa ação não pode ser desfeita.</div>
              <button type="button" class="btn btn--danger-solid" data-action="cancel" ${busy ? 'disabled' : ''}>${busy ? html`${spin()} Cancelando…` : 'Sim, cancelar reserva'}</button>
              <button type="button" class="btn btn--ghost" data-action="keep" ${busy ? 'disabled' : ''}>Não, manter reserva</button>
            </div>
          </div>`
        : ''}`;
  }

  function canceled() {
    const when = reservationWhen(reservation);
    return html`
      <div class="result">
        <div class="result__badge">${icon('check', 36, 2.4)}</div>
        <h1 class="result__title" style="margin:0">Reserva cancelada</h1>
        <div class="result__text">A reserva de ${reservation.space.name} em ${when.date} foi cancelada e o horário voltou a ficar disponível.</div>
      </div>
      <footer class="footer footer--plain">
        <a class="btn btn--primary" href="#/reservas">Voltar para minhas reservas</a>
      </footer>`;
  }

  function paint() {
    screen.paint(phase === 'canceled' ? canceled() : view());
    if (phase === 'confirm') screen.el.querySelector('[data-action="cancel"]')?.focus();
  }

  screen.on({
    ...errorHandlers(load),
    noop: () => {},
    edit: () => {
      const r = reservation;
      if (isDelinquent(r.unit)) {
        showDelinquencyModal({ units: [r.unit], onStay: () => {} });
        return;
      }
      startDraft(space || { id: r.space.id, name: r.space.name, icon: null, booking_mode: r.booking_mode });
      setDraft({
        editingId: r.id,
        date: isoDateOf(r.start_datetime),
        startTime: r.booking_mode === 'full_day' ? null : `${hhmm(timeOf(r.start_datetime))}:00`,
        unitId: r.unit.id,
      });
      location.hash = `#/reservar/${r.space.id}`;
    },
    'ask-cancel': () => {
      actionError = null;
      phase = 'confirm';
      paint();
    },
    keep: (d, el, event) => {
      if (busy) return;
      if (el.classList.contains('overlay') && event.target !== el) return;
      phase = 'view';
      paint();
    },
    cancel: async () => {
      busy = true;
      paint();
      try {
        reservation = await api.cancelReservation(reservation.id);
        phase = 'canceled';
        toast.success('Reserva cancelada');
      } catch (err) {
        actionError = err.message;
        phase = 'view';
      }
      busy = false;
      if (screen.alive()) paint();
    },
  });
  load();
  // Aprovação ou recusa da administração aparece nesta tela sem recarregar.
  autoRefresh(screen, async () => {
    if (phase === 'view' && !busy) await load({ silent: true });
  });
}
