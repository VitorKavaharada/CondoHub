// Peças de interface compartilhadas entre as telas.
import { html } from './html.js';
import { icon } from './icons.js';
import { STATUS } from './format.js';
import { settings, updateSettings } from './config.js';

/**
 * Tela com estado local: `paint()` redesenha preservando a rolagem,
 * e `on()` registra cliques por data-action uma única vez.
 */
export function createScreen(root) {
  const el = document.createElement('div');
  el.className = 'screen';
  root.replaceChildren(el);
  const handlers = {};

  el.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !el.contains(target) || target.disabled) return;
    const fn = handlers[target.dataset.action];
    if (fn) {
      event.preventDefault();
      fn(target.dataset, target, event);
    }
  });

  return {
    el,
    alive: () => el.isConnected,
    on(map) {
      Object.assign(handlers, map);
    },
    paint(markup) {
      if (!el.isConnected) return;
      const scroller = el.querySelector('.content, .result');
      const top = scroller ? scroller.scrollTop : 0;
      const focusedAction = document.activeElement?.closest?.('[data-action]');
      const focusKey = focusedAction && el.contains(focusedAction) ? focusedAction.dataset.focusKey : null;
      el.innerHTML = String(markup);
      const next = el.querySelector('.content, .result');
      if (next) next.scrollTop = top;
      if (focusKey) el.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
    },
  };
}

export function topbar({ back, title, subtitle, right }) {
  return html`
    <header class="topbar">
      ${back ? html`<a class="icon-btn" href="${back}" aria-label="Voltar">${icon('chevron-left', 18, 2)}</a>` : ''}
      <div class="topbar-spacer">
        <h1 class="topbar-title" style="margin:0">${title}</h1>
        ${subtitle ? html`<div class="topbar-sub">${subtitle}</div>` : ''}
      </div>
      ${right || ''}
    </header>`;
}

export function statusTag(status, extraClass = '') {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return html`<span class="tag tag--${s.tone} ${extraClass}">${s.label}</span>`;
}

export function loadingView(label = 'Carregando') {
  return html`
    <div class="state" role="status">
      <div class="spinner"></div>
      <div class="state__text">${label}…</div>
    </div>`;
}

export function errorView(error, { back = '#/' } = {}) {
  const offline = error?.code === 'network_error' && !settings().mock;
  return html`
    ${topbar({ back, title: 'Algo deu errado' })}
    <div class="state">
      <div class="result__badge result__badge--error">${icon(offline ? 'wifi' : 'alert', 32)}</div>
      <div class="state__text">${error?.message || 'Erro inesperado.'}</div>
      <div style="width:100%;max-width:300px">
        <button type="button" class="btn btn--primary" data-action="retry">Tentar novamente</button>
        ${offline
          ? html`<button type="button" class="btn btn--ghost" data-action="use-mock">Usar dados de demonstração</button>`
          : html`<a class="btn btn--text" href="#/perfil">Ajustar conexão</a>`}
      </div>
    </div>`;
}

/** Liga os botões padrão da tela de erro. */
export function errorHandlers(retry) {
  return {
    retry,
    'use-mock': () => {
      updateSettings({ mock: true });
      retry();
    },
  };
}

export function tabbar(active) {
  const item = (key, href, label, name) => html`
    <a href="${href}" ${active === key ? html`aria-current="page"` : ''}>${icon(name, 20, 1.9)}<span>${label}</span></a>`;
  return html`
    <nav class="tabbar" aria-label="Navegação principal">
      ${item('home', '#/', 'Início', 'home')}
      ${item('reservas', '#/reservas', 'Reservas', 'calendar')}
      ${html`<button type="button" data-action="soon" data-label="Comunicados">${icon('chat', 20, 1.9)}<span>Comunicados</span></button>`}
      ${item('perfil', '#/perfil', 'Perfil', 'user')}
    </nav>`;
}

export function switchButton({ action, checked, label }) {
  return html`<button type="button" class="switch" role="switch" aria-checked="${checked ? 'true' : 'false'}" aria-label="${label}" data-action="${action}" data-focus-key="${action}"></button>`;
}

// ---------------------------------------------------------------- feedback

const TOAST_ICON = { success: 'check', error: 'alert', info: 'info' };
let toastTimer;

/**
 * Aviso rápido no rodapé. `tone`: 'info' (padrão), 'success' ou 'error'.
 * Erros ficam mais tempo na tela e são anunciados como alerta para leitores de tela.
 */
export function toast(message, { tone = 'info' } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = `toast toast--${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.innerHTML = String(html`${tone !== 'info' ? icon(TOAST_ICON[tone], 16, 2.2) : ''}<span>${message}</span>`);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, tone === 'error' ? 4500 : 2600);
}
toast.success = (message) => toast(message, { tone: 'success' });
toast.error = (message) => toast(message, { tone: 'error' });

/** Mini spinner dentro de um botão ocupado: html`${spin()} Salvando…`. */
export const spin = () => html`<span class="btn-spinner" aria-hidden="true"></span>`;

let modalEl = null;
let modalOnClose = null;

export function closeModal() {
  if (!modalEl) return;
  modalEl.remove();
  modalEl = null;
  const fn = modalOnClose;
  modalOnClose = null;
  fn?.();
}

/**
 * Modal centralizado por cima da tela (fica fora do conteúdo da tela, então um repaint não o apaga).
 * actions: [{ label, href?, onClick?, variant: 'primary' | 'ghost' | 'text' }]
 * dismissible: false impede fechar pelo fundo ou pela tecla Esc (o usuário escolhe uma ação).
 */
export function showModal({ tone = 'warn', iconName = 'alert', title, text, body = '', actions = [], dismissible = true, onClose }) {
  closeModal();
  const host = document.getElementById('app') || document.body;
  const el = document.createElement('div');
  el.className = 'overlay overlay--center';
  el.innerHTML = String(html`
    <div class="sheet modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-text">
      <div class="result__badge result__badge--${tone}" style="width:60px;height:60px">${icon(iconName, 28)}</div>
      <h2 class="sheet__title" id="modal-title" style="margin:0">${title}</h2>
      <div class="sheet__text" id="modal-text">${text}</div>
      ${body}
      ${actions.map((a, i) => a.href
        ? html`<a class="btn btn--${a.variant || 'primary'}" href="${a.href}" data-modal-action="${i}">${a.label}</a>`
        : html`<button type="button" class="btn btn--${a.variant || 'primary'}" data-modal-action="${i}">${a.label}</button>`)}
    </div>`);
  el.addEventListener('click', (event) => {
    const target = event.target.closest('[data-modal-action]');
    if (target) {
      const action = actions[Number(target.dataset.modalAction)];
      closeModal();
      action?.onClick?.();
      return;
    }
    if (dismissible && event.target === el) closeModal();
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dismissible) closeModal();
    if (event.key === 'Tab') {
      // Mantém o foco dentro do modal
      const items = [...el.querySelectorAll('a, button')];
      const i = items.indexOf(document.activeElement);
      if (event.shiftKey && i <= 0) { items[items.length - 1].focus(); event.preventDefault(); }
      else if (!event.shiftKey && i === items.length - 1) { items[0].focus(); event.preventDefault(); }
    }
  });
  host.appendChild(el);
  modalEl = el;
  modalOnClose = onClose || null;
  el.querySelector('[data-modal-action]')?.focus();
  return el;
}

// Trocar de tela fecha o modal aberto.
window.addEventListener('hashchange', () => {
  modalOnClose = null;
  closeModal();
});

/** Tela de carregamento com esqueleto de lista (cabeçalho real + linhas piscando). */
export function skeletonView({ back = '#/', title, rows = 4, height = 64, lede = true } = {}) {
  return html`
    ${title ? topbar({ back, title }) : ''}
    ${lede ? html`<div class="skeleton skeleton--line" style="width:62%;margin:0 24px"></div>` : ''}
    <main class="content content--gap" aria-busy="true">
      <span class="sr-only" role="status">Carregando…</span>
      <div class="stack">
        ${Array.from({ length: rows }, () => html`<div class="skeleton" style="height:${height}px"></div>`)}
      </div>
    </main>`;
}

/**
 * Mantém a tela em dia com o banco: recarrega em silêncio a cada `ms`, quando a aba volta
 * a ficar visível e quando qualquer tela grava algo pela API (evento condohub:changed).
 * Para sozinho quando a tela sai do DOM. `fn` deve atualizar o estado e repintar sem spinner.
 */
export function autoRefresh(screen, fn, { ms = 15000 } = {}) {
  let running = false;
  const run = async () => {
    if (!screen.alive()) return stop();
    if (running || document.hidden || modalEl) return;
    running = true;
    try {
      await fn();
    } catch {
      /* falha silenciosa: a próxima rodada tenta de novo */
    }
    running = false;
  };
  const timer = setInterval(run, ms);
  const onVisible = () => !document.hidden && run();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('condohub:changed', run);
  function stop() {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('condohub:changed', run);
  }
  return stop;
}

export const comingSoon = (d) => toast(`${d.label || 'Este módulo'} chega numa próxima etapa.`);

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
