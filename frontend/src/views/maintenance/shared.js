// Peças compartilhadas do fluxo de manutenção.
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import {
  INCIDENT_STATUS, INCIDENT_STEPS, PRIORITY, REJECTION, ROLE_LABEL, initials, shortDate, visitLabel,
} from '../../format.js';
import { settings } from '../../config.js';

export const isStaff = (me) => me.role === 'manager' || me.role === 'admin';

export function incidentTag(status, { staff = false } = {}) {
  const s = INCIDENT_STATUS[status] || { label: status, tone: 'neutral' };
  return html`<span class="tag tag--${s.tone}">${staff ? s.staff : s.label}</span>`;
}

export function priorityTag(priority) {
  if (!priority) return html`<span class="tag tag--neutral">Sem prioridade</span>`;
  const p = PRIORITY[priority];
  return html`<span class="tag tag--${p.tone}">${p.label}</span>`;
}

/** Barrinha de 5 etapas (Enviado → Concluído). */
export function progressBar(status) {
  const rejected = status === 'rejected';
  const reached = rejected ? 2 : INCIDENT_STEPS.indexOf(status) + 1;
  return html`
    <div class="progress ${rejected ? 'progress--danger' : ''}" aria-hidden="true">
      ${INCIDENT_STEPS.map((_, i) => html`<span class="${i < reached ? 'on' : ''}"></span>`)}
    </div>`;
}

/** Frase curta do momento atual, para a lista do morador. */
export function statusNote(inc) {
  const provider = inc.assigned_provider?.name;
  switch (inc.status) {
    case 'submitted': return 'Aguardando análise do síndico';
    case 'under_review': return 'O síndico está analisando o pedido';
    case 'approved': {
      const visit = visitLabel(inc.scheduled_start_at, inc.scheduled_end_at);
      return `${provider || 'Responsável definido'}${visit ? ` · visita ${visit}` : ''}`;
    }
    case 'in_progress': return `Em execução${provider ? ` por ${provider}` : ''}`;
    case 'done': return `Concluída em ${shortDate(inc.finished_at)}`;
    case 'rejected': return REJECTION[inc.rejection_reason] || 'Solicitação recusada';
    default: return '';
  }
}

/** Menu lateral do painel web do síndico. */
export function webShell(active, me, condo, main) {
  const item = (key, href, label, name) => html`
    <a href="${href}" ${active === key ? html`aria-current="page"` : ''}>${icon(name, 18)}${label}</a>`;
  return html`
    <div class="web">
      <aside class="web__side">
        <div>
          <div class="web__brand">CondoHub</div>
          <div class="web__brand web__condo">${condo?.name || ''}</div>
        </div>
        <nav class="web__nav" aria-label="Menu do síndico">
          ${item('painel', '#/sindico/manutencoes', 'Painel de manutenções', 'alert')}
          ${item('prestadores', '#/sindico/prestadores', 'Prestadores e equipe', 'user')}
          ${item('historico', '#/sindico/historico', 'Histórico', 'clock')}
          ${item('preventivas', '#/sindico/preventivas', 'Preventivas', 'calendar')}
        </nav>
        <div class="web__foot">
          <div class="web__user">
            <span class="avatar" aria-hidden="true">${initials(me?.name)}</span>
            <span>
              <span class="web__user-name" style="display:block">${me?.name || ''}</span>
              <span class="web__user-role" style="display:block">${ROLE_LABEL[me?.role] || ''}</span>
            </span>
          </div>
          <a class="web__back" href="#/">← Voltar ao app${settings().mock ? ' (demonstração)' : ''}</a>
        </div>
      </aside>
      <main class="web__main">${main}</main>
    </div>`;
}

export function webDenied() {
  return html`
    <div class="state">
      <div class="result__badge result__badge--warn">${icon('shield', 32)}</div>
      <div class="state__text">O painel de manutenções é só para o síndico e a administração. Troque para o usuário Roberto Mendes em Perfil para testar.</div>
      <a class="btn btn--primary" href="#/perfil" style="max-width:260px">Ir para Perfil</a>
    </div>`;
}

/** Baixa um CSV gerado no navegador. */
export function downloadCsv(filename, header, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
