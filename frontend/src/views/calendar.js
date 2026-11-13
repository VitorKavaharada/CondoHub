// Data e horário (Calendario.dc.html) e data de dia inteiro (CalendarioDiaTodo.dc.html).
import { api } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { currentDraft, setDraft, startDraft } from '../draft.js';
import {
  WEEKDAYS_SHORT, addMonths, dateLabel, hhmm, hourLabel, monthLabel, monthOf, timeOf, todayIso, weekdayOf,
} from '../format.js';
import { createScreen, errorHandlers, errorView, loadingView, topbar } from '../ui.js';
import { guardReservationFlow } from '../delinquency.js';

const SELECTABLE = new Set(['available', 'partial']);
const SLOT_CAPTION = { occupied: 'Ocupado', unavailable: 'Indisponível', past: 'Encerrado' };

export default function calendar(root, { params: [spaceId] }) {
  const screen = createScreen(root);
  const state = {
    space: null,
    month: null,
    availability: null,
    date: null,
    slots: null,
    slotsLoading: false,
    startTime: null,
    error: null,
  };
  let draft = currentDraft();
  const editing = draft?.editingId && draft.spaceId === spaceId ? draft.editingId : null;
  const back = editing ? `#/reservas/${editing}` : '#/areas';

  const isFullDay = () => state.space.booking_mode === 'full_day';
  const minMonth = () => monthOf(todayIso());
  const maxMonth = () => monthOf(state.availability?.last_bookable_date || todayIso());

  async function load() {
    screen.paint(loadingView());
    try {
      let me;
      [state.space, me] = await Promise.all([api.space(spaceId), api.me()]);
      if (!draft || draft.spaceId !== spaceId) draft = startDraft(state.space);
      state.me = me;
      const wanted = draft.date && draft.date >= todayIso() ? draft.date : null;
      state.startTime = wanted ? draft.startTime || null : null;
      await loadMonth(wanted ? monthOf(wanted) : minMonth(), wanted);
      guardReservationFlow(me, draft.unitId || null);
    } catch (err) {
      screen.paint(errorView(err, { back }));
    }
  }

  async function loadMonth(month, preferredDate) {
    state.month = month;
    state.availability = await api.availability(spaceId, month);
    const days = state.availability.days;
    const keep = days.find((d) => d.date === (preferredDate || state.date) && SELECTABLE.has(d.status));
    const first = days.find((d) => SELECTABLE.has(d.status));
    const nextDate = keep?.date || first?.date || null;
    if (nextDate !== state.date) state.startTime = preferredDate === nextDate ? state.startTime : null;
    state.date = nextDate;
    paint();
    await loadSlots();
  }

  async function loadSlots() {
    state.slots = null;
    if (isFullDay() || !state.date) return paint();
    state.slotsLoading = true;
    paint();
    const date = state.date;
    try {
      const res = await api.slots(spaceId, date);
      if (date !== state.date) return;
      state.slots = res.slots;
      if (!state.slots.some((s) => s.start_time === state.startTime && s.status === 'available')) state.startTime = null;
    } catch (err) {
      state.error = err.message;
    } finally {
      state.slotsLoading = false;
      paint();
    }
  }

  function dayCell(day) {
    const n = Number(day.date.slice(8));
    const selectable = SELECTABLE.has(day.status);
    const classes = ['day', `day--${day.status}`, isFullDay() ? '' : 'day--hourly', day.date === todayIso() ? 'day--today' : '']
      .filter(Boolean).join(' ');
    const label = `${dateLabel(day.date)}${
      { partial: ', alguns horários ocupados', full: isFullDay() ? ', já reservado' : ', lotado', unavailable: ', indisponível', past: ', data passada' }[day.status] || ''
    }`;
    return html`
      <button type="button" class="${classes}" data-action="day" data-date="${day.date}" data-focus-key="day-${day.date}"
        aria-pressed="${day.date === state.date ? 'true' : 'false'}" aria-label="${label}" ${selectable ? '' : 'disabled'}>${n}</button>`;
  }

  function grid() {
    const days = state.availability.days;
    const offset = weekdayOf(days[0].date);
    return html`
      <div class="weekdays" aria-hidden="true">${WEEKDAYS_SHORT.map((w) => html`<div>${w}</div>`)}</div>
      <div class="days">
        ${Array.from({ length: offset }, () => html`<div></div>`)}
        ${days.map(dayCell)}
      </div>`;
  }

  function legend() {
    if (isFullDay()) {
      return html`
        <div class="legend">
          <div><span class="swatch"></span> Disponível</div>
          <div><span class="swatch swatch--selected"></span> Selecionado</div>
          <div><span class="swatch swatch--blocked"></span> Já reservado</div>
        </div>`;
    }
    return html`
      <div class="legend">
        <div><span class="swatch"></span> Disponível</div>
        <div><span class="swatch swatch--selected"></span> Selecionado</div>
        <div><span class="swatch swatch--dot"></span> Parcialmente ocupado</div>
        <div><span class="swatch swatch--blocked"></span> Indisponível</div>
      </div>`;
  }

  function slotsSection() {
    if (isFullDay()) return '';
    if (!state.date) return '';
    let body;
    if (state.slotsLoading || !state.slots) {
      body = html`<div class="slots">${[0, 1, 2].map(() => html`<div class="skeleton" style="height:52px;border-radius:12px"></div>`)}</div>`;
    } else if (!state.slots.length) {
      body = html`<div class="empty">Nenhum horário configurado para este dia.</div>`;
    } else {
      body = html`<div class="slots">${state.slots.map((slot) => {
        const time = hhmm(slot.start_time);
        const selected = slot.start_time === state.startTime;
        return html`
          <button type="button" class="slot slot--${slot.status}" data-action="slot" data-time="${slot.start_time}" data-focus-key="slot-${time}"
            aria-pressed="${selected ? 'true' : 'false'}" aria-label="${time} até ${timeOf(slot.end)}${SLOT_CAPTION[slot.status] ? `, ${SLOT_CAPTION[slot.status].toLowerCase()}` : ''}"
            ${slot.status === 'available' ? '' : 'disabled'}>
            <span class="slot__time">${time}</span>
            ${SLOT_CAPTION[slot.status] ? html`<span class="slot__cap">${SLOT_CAPTION[slot.status]}</span>` : ''}
          </button>`;
      })}</div>`;
    }
    return html`
      <section>
        <h2 class="section-label" style="margin-top:0">Horários em ${dateLabel(state.date)}</h2>
        ${body}
      </section>`;
  }

  function paint() {
    const s = state.space;
    const ready = isFullDay() ? Boolean(state.date) : Boolean(state.date && state.startTime);
    const selectedSlot = state.slots?.find((x) => x.start_time === state.startTime);
    const timeText = isFullDay() ? 'Dia todo' : selectedSlot ? `${hhmm(selectedSlot.start_time)} – ${timeOf(selectedSlot.end)}` : 'Selecione um horário';
    const subtitle = isFullDay() ? 'Escolha a data' : `Funciona das ${hourLabel(s.opens_at)} às ${hourLabel(s.closes_at)}`;
    const noDates = !state.availability.days.some((d) => SELECTABLE.has(d.status));

    screen.paint(html`
      ${topbar({ back, title: s.name, subtitle: editing ? `Alterar reserva · ${subtitle.toLowerCase()}` : subtitle })}
      <main class="content content--gap" style="padding-top:12px;gap:18px">
        ${isFullDay()
          ? html`<div class="notice">${icon('info', 18)}<div>Este espaço é reservado para <strong>o dia todo</strong>. Não é necessário escolher um horário.</div></div>`
          : ''}
        ${editing ? html`<div class="notice notice--warn">${icon('edit', 18)}<div>Ao alterar a data ou o horário, a reserva volta para aprovação da administração.</div></div>` : ''}
        <section>
          <div class="month-nav">
            <button type="button" class="icon-btn icon-btn--sm" data-action="month" data-delta="-1" aria-label="Mês anterior" ${state.month <= minMonth() ? 'disabled' : ''}>${icon('chevron-left', 15, 2)}</button>
            <h2 class="month-nav__label" style="margin:0" aria-live="polite">${monthLabel(state.month)}</h2>
            <button type="button" class="icon-btn icon-btn--sm" data-action="month" data-delta="1" aria-label="Próximo mês" ${state.month >= maxMonth() ? 'disabled' : ''}>${icon('chevron-right', 15, 2)}</button>
          </div>
          ${grid()}
        </section>
        ${legend()}
        ${noDates ? html`<div class="empty">Não há datas livres neste mês. Tente o próximo.</div>` : ''}
        ${state.error ? html`<div class="notice notice--danger">${icon('alert', 18)}<div>${state.error}</div></div>` : ''}
        ${slotsSection()}
      </main>
      <footer class="footer">
        <div class="footer-note">${state.date ? dateLabel(state.date) : 'Selecione uma data'} · <strong>${timeText}</strong></div>
        <button type="button" class="btn btn--primary" data-action="continue" ${ready ? '' : 'disabled'}>Continuar</button>
      </footer>`);
  }

  screen.on({
    ...errorHandlers(load),
    month: async (d) => {
      const next = addMonths(state.month, Number(d.delta));
      if (next < minMonth() || next > maxMonth()) return;
      state.error = null;
      try {
        await loadMonth(next);
      } catch (err) {
        state.error = err.message;
        paint();
      }
    },
    day: (d) => {
      if (d.date === state.date) return;
      state.date = d.date;
      state.startTime = null;
      state.error = null;
      loadSlots();
    },
    slot: (d) => {
      state.startTime = d.time;
      paint();
    },
    continue: () => {
      if (guardReservationFlow(state.me, currentDraft()?.unitId || null)) return;
      const slot = state.slots?.find((x) => x.start_time === state.startTime);
      setDraft({
        date: state.date,
        startTime: isFullDay() ? null : state.startTime,
        endTime: slot ? timeOf(slot.end) : null,
      });
      if (!editing && state.space.requires_terms) location.hash = `#/reservar/${spaceId}/regras`;
      else location.hash = '#/confirmar';
    },
  });
  load();
}
