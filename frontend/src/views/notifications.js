// Notificações do usuário atual (respostas da administração às reservas).
import { api } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { dateTimeLabel } from '../format.js';
import { createScreen, errorHandlers, errorView, loadingView, topbar } from '../ui.js';

export default function notifications(root) {
  const screen = createScreen(root);
  let items = [];

  async function load() {
    screen.paint(loadingView());
    try {
      items = await api.notifications(false);
      paint();
    } catch (err) {
      screen.paint(errorView(err));
    }
  }

  function paint() {
    screen.paint(html`
      ${topbar({ back: '#/', title: 'Notificações' })}
      <main class="content" style="padding-top:14px">
        ${items.length
          ? items.map((n) => html`
            <button type="button" class="row-link" data-action="open" data-id="${n.id}" style="${n.read_at ? '' : 'border-color:var(--accent)'}">
              <span class="tile-icon tile-icon--sm">${icon(n.reservation_id ? 'calendar' : n.incident_id ? 'alert' : 'bell', 18)}</span>
              <span class="row-link__body">
                <span class="row-link__title" style="display:block">${n.title}</span>
                ${n.body ? html`<span class="row-link__sub" style="display:block">${n.body}</span>` : ''}
                <span class="row-link__sub" style="display:block">${dateTimeLabel(n.created_at)}</span>
              </span>
              ${n.read_at ? '' : html`<span class="tag tag--accent">Nova</span>`}
            </button>`)
          : html`<div class="empty">Nenhuma notificação por enquanto.</div>`}
      </main>`);
  }

  screen.on({
    ...errorHandlers(load),
    open: async (d) => {
      const n = items.find((x) => x.id === d.id);
      if (!n) return;
      if (!n.read_at) await api.readNotification(n.id).catch(() => {});
      if (n.reservation_id) location.hash = `#/reservas/${n.reservation_id}`;
      else if (n.incident_id) location.hash = `#/manutencao/${n.incident_id}`;
      else load();
    },
  });
  load();
}
