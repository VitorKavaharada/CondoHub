// Minhas reservas (MinhasReservas.dc.html)
import { api } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { reservationWhen } from '../format.js';
import { autoRefresh, createScreen, errorHandlers, errorView, skeletonView, statusTag, tabbar, topbar } from '../ui.js';

const ACTIVE = new Set(['pending', 'confirmed']);

export default function myReservations(root, { query = {} } = {}) {
  const screen = createScreen(root);
  const highlight = query.nova || null; // reserva recém-criada (vem da confirmação)

  async function load({ silent = false } = {}) {
    if (!silent) screen.paint(skeletonView({ back: '#/', title: 'Minhas reservas', rows: 4 }));
    try {
      const [reservations, spaces] = await Promise.all([api.reservations({ mine: true }), api.spaces().catch(() => [])]);
      const icons = Object.fromEntries(spaces.map((s) => [s.id, s.icon]));
      const now = Date.now();
      const upcoming = reservations.filter((r) => ACTIVE.has(r.status) && new Date(r.end_datetime) > now);
      const history = reservations.filter((r) => !upcoming.includes(r)).reverse();
      screen.paint(render(upcoming, history, icons));
    } catch (err) {
      if (silent) throw err;
      screen.paint(errorView(err));
    }
  }

  const item = (r, icons) => html`
    <a class="row-link ${r.id === highlight ? 'row-link--new' : ''}" href="#/reservas/${r.id}" aria-label="Ver detalhes da reserva: ${r.space.name}, ${reservationWhen(r).short}">
      <span class="tile-icon tile-icon--sm">${icon(icons[r.space.id], 18)}</span>
      <span class="row-link__body">
        <span class="row-link__title" style="display:block">${r.space.name}</span>
        <span class="row-link__sub" style="display:block">${reservationWhen(r).short}</span>
      </span>
      ${r.id === highlight ? html`<span class="tag tag--small tag--accent">Nova</span>` : ''}
      ${statusTag(r.status)}
    </a>`;

  function render(upcoming, history, icons) {
    return html`
      ${topbar({ back: '#/', title: 'Minhas reservas' })}
      <p class="lede" style="margin:0">Toque em uma reserva para ver os detalhes ou editar</p>
      <main class="content content--gap">
        <section class="stack">
          ${upcoming.length
            ? upcoming.map((r) => item(r, icons))
            : html`<div class="empty">Você ainda não tem reservas agendadas</div>`}
          <a class="btn btn--primary" href="#/areas" style="margin-top:4px">${icon('plus', 18, 2.2)} Nova reserva</a>
        </section>
        ${history.length
          ? html`
            <section>
              <h2 class="section-label">Histórico</h2>
              <div class="stack">${history.map((r) => item(r, icons))}</div>
            </section>`
          : ''}
      </main>
      ${tabbar('reservas')}`;
  }

  screen.on(errorHandlers(load));
  load();
  // Aprovação/recusa feita pela administração aparece sem recarregar a página.
  autoRefresh(screen, () => load({ silent: true }));
}
