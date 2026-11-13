// Cliente da CondoHub API (FastAPI). Contrato: http://localhost:8000/docs
// Erros chegam como {"error": {"code", "message"}}; o `code` decide a tela.
// Toda falha vira ApiError com mensagem em português (rede, tempo esgotado, erro do servidor),
// e toda gravação bem-sucedida dispara o evento `condohub:changed` para as listas abertas
// se atualizarem sozinhas (ver autoRefresh em ui.js).

import { onSettingsChange, settings } from './config.js';
import { handleMock } from './mock.js';
import { setTimezone } from './format.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function validationMessage(data) {
  const first = Array.isArray(data?.detail) ? data.detail[0] : null;
  if (!first) return null;
  const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : '';
  return `Dado inválido${field ? ` em "${field}"` : ''}: ${first.msg}`;
}

const TIMEOUT_MS = 20000;

function serverMessage(status) {
  if (status >= 500) return 'O servidor encontrou um erro ao processar o pedido. Tente novamente em instantes.';
  if (status === 404) return 'Não encontramos o que você procurou. Ele pode ter sido removido.';
  return `A API respondeu com erro ${status}`;
}

function announceChange(method, path) {
  if (method === 'GET') return;
  window.dispatchEvent(new CustomEvent('condohub:changed', { detail: { method, path } }));
}

async function request(method, path, opts = {}) {
  const data = await send(method, path, opts);
  announceChange(method, path);
  return data;
}

async function send(method, path, { body, query } = {}) {
  const s = settings();
  const fullPath = `/condominiums/${s.condominiumId}${path}`;

  if (s.mock) return handleMock({ method, path: fullPath, query: query || {}, body, userId: s.userId });

  const url = new URL(s.apiBase.replace(/\/+$/, '') + fullPath);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    (Array.isArray(value) ? value : [value]).forEach((v) => url.searchParams.append(key, v));
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (s.userId) headers['X-User-Id'] = s.userId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError(0, 'timeout', 'A API demorou demais para responder. Verifique a conexão e tente novamente.');
    }
    throw new ApiError(0, 'network_error', `Não foi possível conectar à API em ${s.apiBase}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(
      res.status,
      err?.code || (res.status === 422 ? 'validation_error' : 'http_error'),
      err?.message || validationMessage(data) || serverMessage(res.status),
    );
  }
  return data;
}

// Cache para o que quase não muda durante a navegação. `ttl` (ms) faz o dado expirar:
// o usuário atual (/me) expira rápido para refletir, por exemplo, a flag de inadimplência.
const cache = new Map();
function cached(key, loader, ttl = Infinity) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > ttl) {
    const entry = {
      at: Date.now(),
      value: loader().catch((err) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw err;
      }),
    };
    cache.set(key, entry);
    return entry.value;
  }
  return hit.value;
}
export function clearCache() {
  cache.clear();
}
onSettingsChange(clearCache);

export const api = {
  condominium: () => cached('condo', () => request('GET', '').then((c) => {
    setTimezone(c.timezone);
    return c;
  })),
  me: () => cached('me', () => request('GET', '/me'), 15000),
  members: () => request('GET', '/members'),
  notifications: (unread = false) => request('GET', '/notifications', { query: { unread } }),
  readNotification: (id) => request('POST', `/notifications/${id}/read`),

  spaces: (active) => request('GET', '/spaces', { query: { active } }),
  space: (id) => request('GET', `/spaces/${id}`),
  createSpace: (data) => request('POST', '/spaces', { body: data }),
  updateSpace: (id, data) => request('PATCH', `/spaces/${id}`, { body: data }),
  availability: (id, month) => request('GET', `/spaces/${id}/availability`, { query: { month } }),
  slots: (id, date) => request('GET', `/spaces/${id}/slots`, { query: { date } }),
  publishRules: (id, data) => request('POST', `/spaces/${id}/rules-documents`, { body: data }),

  reservations: (query) => request('GET', '/reservations', { query }),
  reservation: (id) => request('GET', `/reservations/${id}`),
  createReservation: (data) => request('POST', '/reservations', { body: data }),
  updateReservation: (id, data) => request('PATCH', `/reservations/${id}`, { body: data }),
  cancelReservation: (id, reason) => request('POST', `/reservations/${id}/cancel`, { body: { reason: reason || null } }),
  approveReservation: (id) => request('POST', `/reservations/${id}/approve`),
  rejectReservation: (id, reason) => request('POST', `/reservations/${id}/reject`, { body: { reason } }),

  // manutenção — cadastros
  maintenanceTypes: () => cached('mtypes', () => request('GET', '/maintenance-types', { query: { active: true } })),
  maintenanceLocations: () => cached('mlocs', () => request('GET', '/maintenance-locations', { query: { active: true } })),

  // manutenção — ocorrências
  incidents: (query) => request('GET', '/incidents', { query }),
  incidentsSummary: () => request('GET', '/incidents/summary'),
  incident: (id) => request('GET', `/incidents/${id}`),
  createIncident: (data) => request('POST', '/incidents', { body: data }),
  scheduleIncident: (data) => request('POST', '/incidents/scheduled', { body: data }),
  reviewIncident: (id) => request('POST', `/incidents/${id}/review`),
  approveIncident: (id, data) => request('POST', `/incidents/${id}/approve`, { body: data }),
  rejectIncident: (id, data) => request('POST', `/incidents/${id}/reject`, { body: data }),
  startIncident: (id) => request('POST', `/incidents/${id}/start`, { body: {} }),
  finishIncident: (id, data) => request('POST', `/incidents/${id}/finish`, { body: data }),
  rateIncident: (id, data) => request('POST', `/incidents/${id}/rating`, { body: data }),

  // manutenção — histórico, prestadores e preventivas
  historyGroups: (query) => request('GET', '/maintenance-history/groups', { query }),
  history: (query) => request('GET', '/maintenance-history', { query }),
  providers: (query) => request('GET', '/service-providers', { query }),
  provider: (id) => request('GET', `/service-providers/${id}`),
  createProvider: (data) => request('POST', '/service-providers', { body: data }),
  updateProvider: (id, data) => request('PATCH', `/service-providers/${id}`, { body: data }),
  preventives: () => request('GET', '/preventive-maintenances'),
  createPreventive: (data) => request('POST', '/preventive-maintenances', { body: data }),
  updatePreventive: (id, data) => request('PATCH', `/preventive-maintenances/${id}`, { body: data }),
  maintenanceCalendar: (month) => request('GET', '/maintenance-calendar', { query: { month } }),
  runPreventiveJob: () => request('POST', '/jobs/preventive-maintenance/run'),
};

/** Endereço público de um arquivo (regulamento). Caminhos relativos vêm da API. */
export function fileHref(fileUrl) {
  if (!fileUrl) return '#';
  if (/^https?:\/\//.test(fileUrl)) return fileUrl;
  return settings().apiBase.replace(/\/+$/, '') + fileUrl;
}
