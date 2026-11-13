// Admin — gerenciar áreas (AdminAreas.dc.html) e aprovar solicitações de reserva.
import { api } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { durationLabel, reservationWhen, spaceScheduleLabel } from '../format.js';
import { autoRefresh, createScreen, errorHandlers, errorView, loadingView, spin, toast, topbar } from '../ui.js';

const ADMIN_TAG = html`<span class="tag tag--accent">Admin</span>`;

export function staffOnly(me) {
  if (me.role === 'manager' || me.role === 'admin') return null;
  return html`
    ${topbar({ back: '#/', title: 'Área do administrador' })}
    <div class="state">
      <div class="result__badge result__badge--warn">${icon('shield', 32)}</div>
      <div class="state__text">Esta área é só para o síndico e a administração. Troque para o usuário Roberto Mendes em Perfil para testar.</div>
      <a class="btn btn--primary" href="#/perfil" style="max-width:260px">Ir para Perfil</a>
    </div>`;
}

export default function adminAreas(root) {
  const screen = createScreen(root);
  let spaces = [];
  let pending = [];
  let rejecting = null;
  let reasonDraft = '';
  let busyId = null;

  async function load({ silent = false } = {}) {
    if (!silent) screen.paint(loadingView());
    try {
      const me = await api.me();
      const denied = staffOnly(me);
      if (denied) return screen.paint(denied);
      [spaces, pending] = await Promise.all([api.spaces(), api.reservations({ status: ['pending'] })]);
      paint();
    } catch (err) {
      if (silent) throw err;
      screen.paint(errorView(err));
    }
  }

  function spaceTag(s) {
    if (!s.is_active) return html`<span class="tag tag--neutral">Inativa</span>`;
    if (s.current_block) return html`<span class="tag tag--warn">${s.current_block.reason}</span>`;
    return html`<span class="tag tag--accent">Ativa</span>`;
  }

  function spaceSub(s) {
    if (s.booking_mode === 'full_day') return `Dia todo · ${s.max_per_unit} ${s.max_per_unit === 1 ? 'reserva' : 'reservas'} por unidade`;
    return `${spaceScheduleLabel(s)} · blocos de ${durationLabel(s.slot_minutes)}`;
  }

  function request(r) {
    const when = reservationWhen(r);
    const isRejecting = rejecting === r.id;
    const busy = busyId === r.id;
    return html`
      <div class="card request">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="flex:1">
            <div class="row-link__title">${r.space.name}</div>
            <div class="row-link__sub">${when.date} · ${when.time}</div>
            <div class="row-link__sub">${r.requested_by.name} · ${r.unit.label}</div>
          </div>
          <span class="tag tag--warn">Pendente</span>
        </div>
        ${isRejecting
          ? html`
            <div class="field">
              <label for="reason-${r.id}">Motivo da recusa</label>
              <textarea id="reason-${r.id}" class="textarea" style="min-height:70px" data-reason="${r.id}" placeholder="Ex.: Área reservada para manutenção" ${busy ? 'disabled' : ''}>${reasonDraft}</textarea>
            </div>
            <div class="request__actions">
              <button type="button" class="btn btn--danger-solid" data-action="reject" data-id="${r.id}" ${busy ? 'disabled' : ''}>${busy ? html`${spin()} Recusando…` : 'Confirmar recusa'}</button>
              <button type="button" class="btn btn--ghost" data-action="cancel-reject">Voltar</button>
            </div>`
          : html`
            <div class="request__actions">
              <button type="button" class="btn btn--primary" data-action="approve" data-id="${r.id}" ${busy ? 'disabled' : ''}>${busy ? spin() : icon('check', 16, 2.4)} Aprovar</button>
              <button type="button" class="btn btn--danger" data-action="ask-reject" data-id="${r.id}" ${busy ? 'disabled' : ''}>Recusar</button>
            </div>`}
      </div>`;
  }

  function paint() {
    screen.paint(html`
      ${topbar({ back: '#/', title: 'Gerenciar áreas', subtitle: 'Perfil administrador · síndico', right: ADMIN_TAG })}
      <main class="content content--gap" style="padding-top:14px">
        <section>
          <h2 class="section-label">Solicitações pendentes${pending.length ? ` (${pending.length})` : ''}</h2>
          <div class="stack">${pending.length ? pending.map(request) : html`<div class="empty">Nenhuma solicitação aguardando resposta.</div>`}</div>
        </section>
        <section>
          <h2 class="section-label">Áreas comuns</h2>
          <p class="hint" style="margin:-4px 0 10px">Toque em uma área para editar horários e regras</p>
          <div class="stack">
            ${spaces.map((s) => html`
              <a class="row-link" href="#/admin/areas/${s.id}">
                <span class="tile-icon tile-icon--sm">${icon(s.icon, 18)}</span>
                <span class="row-link__body">
                  <span class="row-link__title" style="display:block">${s.name}</span>
                  <span class="row-link__sub" style="display:block">${spaceSub(s)}</span>
                </span>
                ${spaceTag(s)}
              </a>`)}
            <a class="btn btn--ghost" href="#/admin/areas/nova" style="border-style:dashed">${icon('plus', 18, 2.2)} Cadastrar nova área</a>
          </div>
        </section>
      </main>`);
  }

  async function review(id, action) {
    const reason = screen.el.querySelector(`[data-reason="${id}"]`)?.value.trim();
    if (action === 'reject' && !reason) {
      toast.error('Informe o motivo da recusa');
      return;
    }
    reasonDraft = reason || '';
    busyId = id;
    paint();
    try {
      if (action === 'approve') await api.approveReservation(id);
      else await api.rejectReservation(id, reason);
      pending = pending.filter((r) => r.id !== id);
      rejecting = null;
      reasonDraft = '';
      toast.success(action === 'approve' ? 'Reserva aprovada' : 'Reserva recusada');
    } catch (err) {
      toast.error(err.message);
    }
    busyId = null;
    if (screen.alive()) paint();
  }

  screen.on({
    ...errorHandlers(load),
    approve: (d) => review(d.id, 'approve'),
    'ask-reject': (d) => {
      rejecting = d.id;
      reasonDraft = '';
      paint();
      screen.el.querySelector(`[data-reason="${d.id}"]`)?.focus();
    },
    'cancel-reject': () => {
      rejecting = null;
      paint();
    },
    reject: (d) => review(d.id, 'reject'),
  });
  load();
  // Pedidos novos dos moradores aparecem sozinhos (pausa enquanto o síndico recusa um pedido).
  autoRefresh(screen, async () => {
    if (!rejecting && !busyId) await load({ silent: true });
  });
}
