// Áreas comuns — seleção (Areas.dc.html)
import { api } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { currentDraft, startDraft } from '../draft.js';
import { createScreen, errorHandlers, errorView, skeletonView, topbar } from '../ui.js';
import { blockedUnits, delinquencyNotice, guardReservationFlow } from '../delinquency.js';

export default function areas(root) {
  const screen = createScreen(root);
  let spaces = [];
  let selectedId = null;
  let blocked = [];
  let me = null;

  async function load() {
    screen.paint(skeletonView({ back: '#/', title: 'Áreas comuns', rows: 5, height: 72 }));
    try {
      let all;
      [all, me] = await Promise.all([api.spaces(true), api.me()]);
      spaces = all.filter((s) => s.is_active);
      blocked = blockedUnits(me);
      const draft = currentDraft();
      const bookable = spaces.filter((s) => !s.current_block);
      selectedId = bookable.find((s) => s.id === draft?.spaceId)?.id || bookable[0]?.id || null;
      paint();
      guardReservationFlow(me);
    } catch (err) {
      screen.paint(errorView(err));
    }
  }

  function option(space) {
    const blocked = Boolean(space.current_block);
    const selected = space.id === selectedId;
    return html`
      <button type="button" class="option" data-action="pick" data-id="${space.id}" data-focus-key="space-${space.id}"
        aria-pressed="${selected ? 'true' : 'false'}" ${blocked ? 'disabled' : ''}>
        <span class="tile-icon">${icon(space.icon, 21)}</span>
        <span style="flex:1;min-width:0">
          <span class="option__title">
            ${space.name}
            ${space.booking_mode === 'full_day' ? html`<span class="tag tag--small tag--accent">Dia todo</span>` : ''}
            ${blocked ? html`<span class="tag tag--small tag--warn">${space.current_block.reason}</span>` : ''}
          </span>
          <span class="option__sub" style="display:block">${space.description || ''}</span>
        </span>
        <span class="radio">${selected ? icon('check', 12, 3) : ''}</span>
      </button>`;
  }

  function paint() {
    const selected = spaces.find((s) => s.id === selectedId);
    screen.paint(html`
      ${topbar({ back: '#/', title: 'Áreas comuns' })}
      <p class="lede" style="margin:0">Selecione o local que deseja reservar</p>
      <main class="content">
        ${spaces.length ? spaces.map(option) : html`<div class="empty">Nenhuma área disponível para reserva no momento.</div>`}
      </main>
      <footer class="footer">
        ${blocked.length ? delinquencyNotice(blocked) : ''}
        <div class="footer-note">Local selecionado: <strong>${selected ? selected.name : 'nenhum'}</strong></div>
        ${selected?.booking_mode === 'full_day'
          ? html`<div class="footer-note" style="color:var(--accent);margin-top:-4px">Este espaço é reservado para o dia todo, sem escolha de horário.</div>`
          : ''}
        <button type="button" class="btn btn--primary" data-action="continue" ${selected && !blocked.length ? '' : 'disabled'}>Continuar</button>
      </footer>`);
  }

  screen.on({
    ...errorHandlers(load),
    pick: (d) => {
      selectedId = d.id;
      paint();
    },
    continue: () => {
      const space = spaces.find((s) => s.id === selectedId);
      if (!space || guardReservationFlow(me)) return;
      startDraft(space);
      location.hash = `#/reservar/${space.id}`;
    },
  });
  load();
}
