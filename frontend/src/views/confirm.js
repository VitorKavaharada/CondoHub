// Confirmar reserva (Confirmacao.dc.html): resumo → enviando → sucesso ou erro.
import { api, clearCache } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { clearDraft, currentDraft } from '../draft.js';
import { STATUS, dateLongLabel, hhmm } from '../format.js';
import { createScreen, errorHandlers, errorView, loadingView, toast, topbar, wait } from '../ui.js';
import { bookableUnits, delinquencyNotice, guardReservationFlow, isDelinquent, showDelinquencyModal } from '../delinquency.js';

// Textos por `code` de erro da API (ver POST /reservations na documentação).
function errorCopy(err, draft) {
  const calendarHref = `#/reservar/${draft.spaceId}`;
  const pick = { label: 'Escolher outro horário', href: calendarHref };
  const home = { label: 'Voltar ao início', href: '#/' };
  const table = {
    slot_taken: {
      title: 'Este horário já foi reservado',
      text: draft.mode === 'full_day'
        ? 'Outro morador reservou esta data poucos instantes antes de você. Escolha uma nova data disponível.'
        : 'Outro morador reservou este horário poucos instantes antes de você. Escolha um novo horário disponível.',
      secondary: draft.mode === 'full_day' ? { label: 'Escolher outra data', href: calendarHref } : pick,
    },
    space_unavailable: {
      title: 'Este local ficou indisponível',
      text: 'Este espaço não está mais disponível para reserva — pode estar em manutenção ou bloqueado pela administração.',
      secondary: { label: 'Escolher outro local', href: '#/areas' },
    },
    unit_conflict: {
      title: 'Conflito com outra reserva',
      text: 'Você já tem uma reserva sua no mesmo período. Verifique "Minhas reservas" ou escolha outro horário.',
      secondary: pick,
    },
    terms_outdated: {
      title: 'O regulamento foi atualizado',
      text: 'A administração publicou uma nova versão do regulamento. Leia e aceite a versão vigente para continuar.',
      secondary: { label: 'Ler o regulamento', href: `#/reservar/${draft.spaceId}/regras` },
    },
    terms_required: {
      title: 'Falta aceitar o regulamento',
      text: 'Esta área exige o aceite do regulamento antes da reserva.',
      secondary: { label: 'Ler o regulamento', href: `#/reservar/${draft.spaceId}/regras` },
    },
    limit_reached: { title: 'Limite de reservas atingido', text: err.message, secondary: { label: 'Ver minhas reservas', href: '#/reservas' } },
    pending_dues: { title: 'Há pendências financeiras', text: `${err.message}.`, secondary: home },
    date_in_past: { title: 'Esse horário já passou', text: err.message, secondary: pick },
    beyond_horizon: { title: 'Data fora do prazo', text: err.message, secondary: pick },
    invalid_slot: { title: 'Horário inválido', text: err.message, secondary: pick },
  };
  return table[err.code] || {
    title: 'Não foi possível processar sua solicitação',
    text: `${err.message}. Nenhuma reserva foi criada — você pode tentar novamente.`,
    secondary: home,
  };
}

export default function confirm(root) {
  const screen = createScreen(root);
  const draft = currentDraft();
  let me = null;
  let unitId = null;
  let phase = 'summary';
  let result = null;
  let failure = null;

  const editing = draft?.editingId || null;
  const timeLabel = () => (draft.mode === 'full_day' ? 'Dia todo' : `${hhmm(draft.startTime)}${draft.endTime ? ` – ${draft.endTime}` : ''}`);

  async function load() {
    if (!draft?.spaceId || !draft.date) {
      location.replace('#/areas');
      return;
    }
    screen.paint(loadingView());
    try {
      me = await api.me();
      unitId = draft.unitId || bookableUnits(me)[0]?.id || me.units[0]?.id || null;
      paint();
      guardReservationFlow(me, unitId);
    } catch (err) {
      screen.paint(errorView(err, { back: '#/areas' }));
    }
  }

  function details(status) {
    return html`
      <div class="card kv">
        <div><span>Local</span><span>${draft.spaceName}</span></div>
        <div><span>Data</span><span>${dateLongLabel(draft.date)}</span></div>
        <div><span>Horário</span><span>${timeLabel()}</span></div>
        <div><span>Status</span><span>${status}</span></div>
      </div>`;
  }

  function summary() {
    const back = editing ? `#/reservar/${draft.spaceId}` : draft.accepted ? `#/reservar/${draft.spaceId}/regras` : `#/reservar/${draft.spaceId}`;
    const units = me.units;
    const selectedUnit = units.find((u) => u.id === unitId);
    const blocked = isDelinquent(selectedUnit);
    return html`
      ${topbar({ back, title: editing ? 'Confirmar alteração' : 'Confirmar reserva' })}
      <p class="lede" style="margin:0">Revise os dados antes de enviar sua solicitação</p>
      <main class="content" style="gap:14px">
        <div class="card summary">
          <div class="summary__head">
            <span class="tile-icon">${icon(draft.spaceIcon, 21)}</span>
            <div class="summary__name">${draft.spaceName}</div>
          </div>
          <div class="summary__row">${icon('calendar', 18)}<div><div class="summary__label">Data</div><div class="summary__value">${dateLongLabel(draft.date)}</div></div></div>
          <div class="summary__row">${icon('clock', 18)}<div><div class="summary__label">Horário</div><div class="summary__value">${timeLabel()}</div></div></div>
          ${!editing && units.length > 1
            ? html`
              <div class="summary__row">${icon('home', 18)}<div style="flex:1">
                <label class="summary__label" for="unit">Unidade</label>
                <select id="unit" class="field-select" data-change="unit">
                  ${units.map((u) => html`<option value="${u.id}" ${u.id === unitId ? 'selected' : ''}>${u.label}${isDelinquent(u) ? ' — com pendência' : ''}</option>`)}
                </select>
              </div></div>`
            : !editing && units[0]
              ? html`<div class="summary__row">${icon('home', 18)}<div><div class="summary__label">Unidade</div><div class="summary__value">${units[0].label}</div></div></div>`
              : ''}
        </div>
        ${blocked
          ? delinquencyNotice([selectedUnit])
          : !editing && !unitId
          ? html`<div class="notice notice--warn">${icon('alert', 18)}<div>Seu usuário não está vinculado a nenhuma unidade, por isso não pode reservar. Troque de usuário em Perfil.</div></div>`
          : html`<div class="notice">${icon('info', 18)}<div>${editing
            ? 'Ao confirmar, a alteração volta para análise da administração. Você poderá acompanhar o status em "Minhas reservas".'
            : html`Ao confirmar, enviaremos sua <strong>solicitação de reserva</strong> para a administração. Você poderá acompanhar o status em "Minhas reservas".`}</div></div>`}
      </main>
      <footer class="footer footer--plain">
        <button type="button" class="btn btn--primary" data-action="submit" ${(!editing && !unitId) || blocked ? 'disabled' : ''}>
          ${icon('check', 18, 2.4)} ${editing ? 'Confirmar alteração' : 'Confirmar e enviar solicitação'}
        </button>
        <a class="btn btn--text" href="${back}">Revisar dados</a>
      </footer>`;
  }

  function processing() {
    return html`
      <div class="result" style="justify-content:center;padding-top:24px">
        <div class="spinner" role="status" aria-label="Processando"></div>
        <h1 class="result__title" style="margin:8px 0 0">Enviando sua solicitação</h1>
        <div class="result__text">Isso leva só alguns instantes. Não feche o app nem toque novamente.</div>
      </div>`;
  }

  function success() {
    const status = STATUS[result.status]?.label || result.status;
    return html`
      <div class="result">
        <div class="result__badge">${icon('check', 36, 2.4)}</div>
        <h1 class="result__title" style="margin:0">${editing ? 'Alteração enviada!' : 'Solicitação enviada!'}</h1>
        <div class="result__text">Você receberá uma notificação quando a administração responder ao pedido.</div>
        ${details(result.status === 'pending' ? 'Pendente de aprovação' : status)}
      </div>
      <footer class="footer footer--plain">
        <a class="btn btn--primary" href="#/reservas?nova=${result.id}">Ver minhas reservas</a>
        <a class="btn btn--text" href="#/reservas/${result.id}">Detalhes desta reserva</a>
      </footer>`;
  }

  function error() {
    const copy = errorCopy(failure, draft);
    return html`
      <div class="result">
        <div class="result__badge result__badge--error">${icon('x', 34, 2.4)}</div>
        <h1 class="result__title" style="margin:0" role="alert">${copy.title}</h1>
        <div class="result__text">${copy.text}</div>
        ${details('Não concluída')}
      </div>
      <footer class="footer footer--plain">
        <button type="button" class="btn btn--primary" data-action="retry-summary">Tentar novamente</button>
        <a class="btn btn--text" href="${copy.secondary.href}">${copy.secondary.label}</a>
      </footer>`;
  }

  function paint() {
    screen.paint({ summary, processing, success, error }[phase]());
  }

  async function submit() {
    if (guardReservationFlow(me, unitId)) return;
    phase = 'processing';
    paint();
    const body = { date: draft.date, start_time: draft.mode === 'full_day' ? null : draft.startTime };
    try {
      const [res] = await Promise.all([
        editing
          ? api.updateReservation(editing, body)
          : api.createReservation({
            ...body,
            space_id: draft.spaceId,
            unit_id: unitId,
            accept_terms: Boolean(draft.accepted),
            rules_document_id: draft.rulesDocumentId || null,
          }),
        wait(700), // tempo mínimo para o estado "Enviando" não piscar
      ]);
      result = res;
      phase = 'success';
      clearDraft();
      toast.success(editing ? 'Alteração enviada para análise' : 'Reserva registrada');
    } catch (err) {
      if (err.code === 'pending_dues') {
        // A unidade ficou inadimplente depois de o app carregar: bloqueia com o modal e
        // volta ao resumo (a reserva não foi criada).
        clearCache();
        const unit = me.units.find((u) => u.id === (editing ? draft.unitId : unitId));
        if (unit) unit.inadimplente = true;
        phase = 'summary';
        if (screen.alive()) paint();
        showDelinquencyModal({ units: unit ? [unit] : [], message: err.message });
        return;
      }
      failure = err;
      phase = 'error';
    }
    if (screen.alive()) paint();
  }

  screen.on({
    ...errorHandlers(load),
    submit,
    'retry-summary': () => {
      phase = 'summary';
      paint();
    },
  });
  screen.el.addEventListener('change', (e) => {
    if (e.target.dataset.change !== 'unit') return;
    unitId = e.target.value;
    paint();
    guardReservationFlow(me, unitId);
  });
  load();
}
