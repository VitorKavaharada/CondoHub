// Ponto de entrada: roteador por hash (#/caminho?query).
import { ApiError, api } from './api.js';
import { errorHandlers, errorView, toast } from './ui.js';
import home from './views/home.js';
import areas from './views/areas.js';
import calendar from './views/calendar.js';
import terms from './views/terms.js';
import confirm from './views/confirm.js';
import myReservations from './views/my-reservations.js';
import reservationDetail from './views/reservation-detail.js';
import notifications from './views/notifications.js';
import profile from './views/profile.js';
import adminAreas from './views/admin-areas.js';
import adminEditArea from './views/admin-edit-area.js';
import maintenanceList from './views/maintenance/list.js';
import maintenanceNew from './views/maintenance/new.js';
import maintenanceDetail from './views/maintenance/detail.js';
import webPanel from './views/maintenance/web-panel.js';
import webProviders from './views/maintenance/web-providers.js';
import webHistory from './views/maintenance/web-history.js';
import webAgenda from './views/maintenance/web-agenda.js';

// wide: telas do painel web do síndico (layout de desktop, fora da moldura de celular)
const ROUTES = [
  [/^\/$/, home],
  [/^\/areas$/, areas],
  [/^\/reservar\/([\w-]+)$/, calendar],
  [/^\/reservar\/([\w-]+)\/regras$/, terms],
  [/^\/confirmar$/, confirm],
  [/^\/reservas$/, myReservations],
  [/^\/reservas\/([\w-]+)$/, reservationDetail],
  [/^\/notificacoes$/, notifications],
  [/^\/perfil$/, profile],
  [/^\/admin\/areas$/, adminAreas],
  [/^\/admin\/areas\/([\w-]+)$/, adminEditArea],
  [/^\/manutencao$/, maintenanceList],
  [/^\/manutencao\/nova$/, maintenanceNew],
  [/^\/manutencao\/([\w-]+)$/, maintenanceDetail],
  [/^\/sindico\/manutencoes$/, webPanel, { wide: true }],
  [/^\/sindico\/prestadores$/, webProviders, { wide: true }],
  [/^\/sindico\/historico$/, webHistory, { wide: true }],
  [/^\/sindico\/preventivas$/, webAgenda, { wide: true }],
];

const root = document.getElementById('app');

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = hash.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

function route() {
  const { path, query } = parseHash();
  for (const [pattern, view, options = {}] of ROUTES) {
    const match = path.match(pattern);
    if (match) {
      root.classList.toggle('app--wide', Boolean(options.wide));
      document.body.classList.toggle('is-wide', Boolean(options.wide));
      try {
        view(root, { params: match.slice(1), query });
      } catch (err) {
        showCrash(err);
      }
      return;
    }
  }
  location.replace('#/');
}

// Falha inesperada ao montar a tela: mostra a tela de erro com "Tentar novamente" em vez de
// deixar o app em branco.
function showCrash(err) {
  console.error(err);
  root.innerHTML = '<div class="screen"></div>';
  const el = root.firstElementChild;
  el.innerHTML = String(errorView({ message: 'Algo inesperado aconteceu nesta tela.' }, { back: '#/' }));
  const handlers = errorHandlers(route);
  el.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target && handlers[target.dataset.action]) handlers[target.dataset.action]();
  });
}

// Rede de segurança: promessa rejeitada sem tratamento (ex.: ação de botão que falhou)
// vira um aviso amigável, sem quebrar a tela atual.
window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  const friendly = event.reason instanceof ApiError ? event.reason.message : null;
  toast.error(friendly || 'Não foi possível concluir a ação. Tente novamente.');
  event.preventDefault();
});

// O fuso do condomínio vale para todas as datas (api.condominium() o registra em format.js).
api.condominium().catch(() => {});

window.addEventListener('hashchange', route);
route();
