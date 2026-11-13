// Morador — minhas manutenções (Main.dc.html do fluxo de manutenção)
import { api } from '../../api.js';
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import { OPEN_INCIDENT, REJECTION, shortDate } from '../../format.js';
import { autoRefresh, createScreen, errorHandlers, errorView, skeletonView, tabbar, topbar } from '../../ui.js';
import { incidentTag, isStaff, progressBar, statusNote } from './shared.js';

const RECENT_REJECTION_DAYS = 15;

export default function maintenanceList(root, { query }) {
  const screen = createScreen(root);
  let me = null;
  let incidents = [];
  let tab = query.aba === 'finalizadas' ? 'done' : 'open';
  const highlight = query.nova || null; // solicitação recém-aberta

  async function load({ silent = false } = {}) {
    if (!silent) screen.paint(skeletonView({ back: '#/', title: 'Manutenções', rows: 3, height: 112, lede: false }));
    try {
      [me, incidents] = await Promise.all([api.me(), api.incidents({ mine: true })]);
      paint();
    } catch (err) {
      if (silent) throw err;
      screen.paint(errorView(err));
    }
  }

  function item(inc) {
    return html`
      <a class="card incident ${inc.id === highlight ? 'row-link--new' : ''}" href="#/manutencao/${inc.id}" aria-label="${inc.code}: ${inc.title}">
        <div class="incident__top">
          <div style="flex:1;min-width:0">
            <div class="incident__meta">${inc.code} · ${inc.maintenance_type.name}</div>
            <div class="incident__title">${inc.title}</div>
            <div class="incident__sub">${inc.location.name} · aberta em ${shortDate(inc.created_at).slice(0, 5)}</div>
          </div>
          ${incidentTag(inc.status)}
        </div>
        ${progressBar(inc.status)}
        <div class="incident__note">${statusNote(inc)}</div>
      </a>`;
  }

  function paint() {
    const open = incidents.filter((i) => OPEN_INCIDENT.includes(i.status));
    const closed = incidents.filter((i) => !OPEN_INCIDENT.includes(i.status));
    const list = tab === 'open' ? open : closed;
    const limit = Date.now() - RECENT_REJECTION_DAYS * 86400000;
    const rejected = closed.find((i) => i.status === 'rejected' && new Date(i.created_at) > limit);
    const unit = me.units[0];

    screen.paint(html`
      ${topbar({ back: '#/', title: 'Manutenções', subtitle: unit ? `Apto ${unit.code} · Bloco ${unit.block}` : null })}
      <main class="content" style="padding-top:14px;gap:14px">
        ${rejected
          ? html`
            <a class="alert-card" href="#/manutencao/${rejected.id}">
              ${icon('alert', 20)}
              <span>
                <span class="alert-card__title" style="display:block">Solicitação recusada</span>
                <span class="alert-card__text" style="display:block">“${rejected.title}” — ${(REJECTION[rejected.rejection_reason] || 'recusada pelo síndico').toLowerCase()}.</span>
                <span class="alert-card__link">Ver justificativa</span>
              </span>
            </a>`
          : ''}
        <a class="btn btn--primary" href="#/manutencao/nova">${icon('plus', 18, 2.2)} Abrir solicitação</a>
        <div class="tabs" role="group" aria-label="Filtrar solicitações">
          <button type="button" data-action="tab" data-tab="open" data-focus-key="tab-open" aria-pressed="${tab === 'open' ? 'true' : 'false'}">Em andamento (${open.length})</button>
          <button type="button" data-action="tab" data-tab="done" data-focus-key="tab-done" aria-pressed="${tab === 'done' ? 'true' : 'false'}">Finalizadas (${closed.length})</button>
        </div>
        <div class="stack">
          ${list.length
            ? list.map(item)
            : html`<div class="empty">${tab === 'open' ? 'Nenhuma solicitação em andamento.' : 'Nenhuma solicitação finalizada ainda.'}</div>`}
        </div>
        ${isStaff(me)
          ? html`
            <a class="row-link" href="#/sindico/manutencoes">
              <span class="tile-icon tile-icon--sm">${icon('settings', 18)}</span>
              <span class="row-link__body">
                <span class="row-link__title" style="display:block">Painel do síndico</span>
                <span class="row-link__sub" style="display:block">Painel web: aprovar, priorizar e agendar</span>
              </span>
              <span class="chev">${icon('chevron-right', 16, 2)}</span>
            </a>`
          : ''}
      </main>
      ${tabbar('home')}`);
  }

  screen.on({
    ...errorHandlers(load),
    tab: (d) => {
      tab = d.tab;
      history.replaceState(null, '', `#/manutencao${tab === 'done' ? '?aba=finalizadas' : ''}`);
      paint();
    },
  });
  load();
  // Em tempo real: status mudados pelo síndico entram na lista sem recarregar a página.
  autoRefresh(screen, () => load({ silent: true }), { ms: 10000 });
}
