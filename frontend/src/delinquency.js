// Restrição por inadimplência no fluxo de reserva.
// A flag `inadimplente` fica na unidade (GET /me → units[].inadimplente) e vale para todos os
// moradores dela. A API recusa a reserva com 403 `pending_dues`; aqui o app avisa antes,
// para o morador não percorrer o fluxo à toa, e trata a recusa da API do mesmo jeito.
import { html } from './html.js';
import { icon } from './icons.js';
import { showModal } from './ui.js';

export const isDelinquent = (unit) => Boolean(unit?.inadimplente);

/** Unidades da pessoa que podem reservar (sem pendência). */
export const bookableUnits = (me) => (me?.units || []).filter((u) => !isDelinquent(u));

/** Todas as unidades da pessoa estão inadimplentes (e ela tem ao menos uma). */
export const fullyBlocked = (me) => Boolean(me?.units?.length) && bookableUnits(me).length === 0;

function unitNames(units) {
  const labels = units.map((u) => u.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}` : labels[0] || 'sua unidade';
}

/** Aviso fixo na tela (acima do botão de continuar). */
export function delinquencyNotice(units) {
  return html`
    <div class="notice notice--danger" role="alert" data-testid="delinquency-notice">
      ${icon('alert', 18)}
      <div><strong>Reserva bloqueada.</strong> ${unitNames(units)} ${units.length > 1 ? 'têm' : 'tem'} pendências financeiras.
      Regularize com a administração para voltar a reservar.</div>
    </div>`;
}

/**
 * Modal de bloqueio. Não fecha pelo fundo: o morador escolhe sair do fluxo.
 * `units`: unidades inadimplentes envolvidas (para o texto). `message`: texto vindo da API, se houver.
 */
export function showDelinquencyModal({ units = [], message, onStay } = {}) {
  return showModal({
    tone: 'error',
    iconName: 'wallet',
    title: 'Reserva indisponível',
    text: message
      ? `${message}.`
      : `${unitNames(units)} ${units.length > 1 ? 'estão' : 'está'} com pendências financeiras. Enquanto a situação não for regularizada, nenhum morador da unidade consegue reservar áreas comuns.`,
    body: html`<div class="hint" style="margin-top:-4px">Procure a administração do condomínio para regularizar. Suas reservas já feitas continuam em "Minhas reservas".</div>`,
    dismissible: false,
    actions: [
      { label: 'Voltar ao início', href: '#/' },
      onStay
        ? { label: 'Entendi', variant: 'text', onClick: onStay }
        : { label: 'Ver minhas reservas', variant: 'text', href: '#/reservas' },
    ],
  });
}

/**
 * Para as telas do fluxo (áreas, calendário, regras): se nenhuma unidade da pessoa pode reservar,
 * mostra o modal e devolve true. A tela continua desenhada por baixo, com o botão desativado.
 */
export function guardReservationFlow(me, unitId = null) {
  const blocked = blockedUnits(me, unitId);
  if (!blocked.length) return false;
  showDelinquencyModal({ units: blocked });
  return true;
}

/**
 * Unidades que impedem o fluxo: a unidade escolhida (edição ou seleção feita), se estiver
 * inadimplente; sem escolha, todas as unidades quando nenhuma pode reservar.
 */
export function blockedUnits(me, unitId = null) {
  const units = me?.units || [];
  if (unitId) {
    const unit = units.find((u) => u.id === unitId);
    return isDelinquent(unit) ? [unit] : [];
  }
  return fullyBlocked(me) ? units : [];
}
