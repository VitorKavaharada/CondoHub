// Início — acesso à reserva (Main.dc.html)
import { api } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { firstName, initials, reservationWhen } from '../format.js';
import { autoRefresh, comingSoon, createScreen, errorHandlers, errorView, loadingView, statusTag, tabbar } from '../ui.js';
import { blockedUnits, delinquencyNotice, showDelinquencyModal } from '../delinquency.js';

const isStaff = (me) => me.role === 'manager' || me.role === 'admin';

function unitLabel(me) {
  const unit = me.units[0];
  if (!unit) return isStaff(me) ? 'Administração' : 'Sem unidade vinculada';
  return `Apto ${unit.code} · Bloco ${unit.block}`;
}

const SKYLINE = html`
  <svg class="hero__skyline" viewBox="0 0 390 110" preserveAspectRatio="none" aria-hidden="true">
    <path fill="currentColor" d="M0 110V62h34V40h40v22h22V18h52v92h12V52h38v-20h46v78h14V36h44v34h30V58h28v52z"/>
  </svg>`;

export default function home(root) {
  const screen = createScreen(root);
  let me = null;

  async function load({ silent = false } = {}) {
    if (!silent) screen.paint(loadingView());
    try {
      let condo;
      [condo, me] = await Promise.all([api.condominium(), api.me()]);
      const [upcoming, unread] = await Promise.all([
        api.reservations({ mine: true, status: ['pending', 'confirmed'], start: new Date().toISOString() }),
        api.notifications(true).catch(() => []),
      ]);
      screen.paint(render(condo, me, upcoming, unread));
    } catch (err) {
      if (silent) throw err;
      screen.paint(errorView(err, { back: null }));
    }
  }

  function render(condo, me, upcoming, unread) {
    const next = upcoming.slice(0, 2);
    const blocked = blockedUnits(me);
    return html`
      <div class="hero">
        <div class="hero__banner">
          ${SKYLINE}
          <a class="hero__bell" href="#/notificacoes" aria-label="Ver notificações${unread.length ? ` (${unread.length} novas)` : ''}">
            ${icon('bell', 18)}
            ${unread.length ? html`<span class="hero__dot"></span>` : ''}
          </a>
          <div class="hero__who">
            <div class="avatar" aria-hidden="true">${initials(me.name)}</div>
            <div>
              <div class="hero__name">${firstName(me.name)}</div>
              <div class="hero__unit">${unitLabel(me)}</div>
            </div>
          </div>
        </div>
        <button type="button" class="row-link hero__admin" data-action="soon" data-label="Os dados da administradora">
          <span class="tile-icon">${icon('building', 18)}</span>
          <span class="row-link__body">
            <span class="row-link__title" style="display:block">${condo.management_company || condo.name}</span>
            <span class="row-link__sub" style="display:block">${condo.name} · Mais informações</span>
          </span>
          <span class="chev">${icon('chevron-right', 16, 2)}</span>
        </button>
      </div>

      <main class="content content--gap" style="padding-top:18px">
        <section>
          <h2 class="section-label" style="margin-top:0">O que você precisa hoje?</h2>
          ${blocked.length ? html`<div style="margin-bottom:12px">${delinquencyNotice(blocked)}</div>` : ''}
          <div class="quick-grid">
            ${blocked.length
              ? html`<button type="button" class="quick quick--primary" data-action="blocked-reserve" aria-describedby="delinquency-hint">${icon('calendar-dots', 26)}Reserva de espaço<span id="delinquency-hint" class="sr-only">Bloqueada por pendência financeira</span></button>`
              : html`<a class="quick quick--primary" href="#/areas">${icon('calendar-dots', 26)}Reserva de espaço</a>`}
            <button type="button" class="quick" data-action="soon" data-label="Encomendas">${icon('package', 26)}Encomendas</button>
            <a class="quick" href="#/manutencao">${icon('alert', 26)}Manutenções</a>
            <button type="button" class="quick" data-action="soon" data-label="Financeiro">${icon('wallet', 26)}Financeiro</button>
          </div>
        </section>

        <section>
          <div class="section-head">
            <h2 class="section-label" style="margin-top:0">Minhas reservas</h2>
            <a class="link" href="#/reservas">Ver todas</a>
          </div>
          ${next.length
            ? html`<div class="stack">${next.map((r) => {
                const when = reservationWhen(r);
                return html`
                  <a class="row-link" href="#/reservas/${r.id}">
                    <span class="tile-icon tile-icon--sm">${icon('calendar', 18)}</span>
                    <span class="row-link__body">
                      <span class="row-link__title" style="display:block">${r.space.name}</span>
                      <span class="row-link__sub" style="display:block">${when.short}</span>
                    </span>
                    ${statusTag(r.status)}
                  </a>`;
              })}</div>`
            : html`<div class="empty">Você ainda não tem reservas agendadas</div>`}
        </section>

        ${isStaff(me)
          ? html`
            <a class="row-link" href="#/admin/areas">
              <span class="tile-icon tile-icon--sm">${icon('shield', 18)}</span>
              <span class="row-link__body">
                <span class="row-link__title" style="display:block">Área do administrador</span>
                <span class="row-link__sub" style="display:block">Editar áreas, regras e aprovar reservas</span>
              </span>
              <span class="chev">${icon('chevron-right', 16, 2)}</span>
            </a>`
          : ''}
        ${isStaff(me)
          ? html`
            <a class="row-link" href="#/sindico/manutencoes" style="margin-top:-12px">
              <span class="tile-icon tile-icon--sm">${icon('settings', 18)}</span>
              <span class="row-link__body">
                <span class="row-link__title" style="display:block">Painel de manutenções</span>
                <span class="row-link__sub" style="display:block">Painel web: aprovar, priorizar e agendar</span>
              </span>
              <span class="chev">${icon('chevron-right', 16, 2)}</span>
            </a>`
          : ''}
      </main>
      ${tabbar('home')}`;
  }

  screen.on({
    ...errorHandlers(load),
    soon: comingSoon,
    'blocked-reserve': () => showDelinquencyModal({ units: blockedUnits(me), onStay: () => {} }),
  });
  load();
  autoRefresh(screen, () => load({ silent: true }), { ms: 30000 });
}
