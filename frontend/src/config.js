// Configuração do app. Padrões para a POC; podem ser trocados na tela Perfil
// (gravados no localStorage) ou pela URL: ?api=http://host:8000, ?mock=1, ?user=<uuid>.

export const DEMO_CONDOMINIUM_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

const DEFAULTS = {
  apiBase: 'http://localhost:8000',
  condominiumId: DEMO_CONDOMINIUM_ID,
  userId: DEMO_USER_ID,
  mock: false,
};

const KEY = 'condohub.settings';

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function readQuery() {
  const params = new URLSearchParams(location.search);
  const out = {};
  if (params.has('api')) out.apiBase = params.get('api');
  if (params.has('mock')) out.mock = params.get('mock') !== '0';
  if (params.has('user')) out.userId = params.get('user');
  if (params.has('condominium')) out.condominiumId = params.get('condominium');
  return out;
}

const fromQuery = readQuery();
let current = { ...DEFAULTS, ...readStored(), ...fromQuery };
const listeners = new Set();

// Parâmetros da URL passam a valer também nos próximos carregamentos.
if (Object.keys(fromQuery).length) {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* navegação privada */
  }
}

export function settings() {
  return current;
}

export function updateSettings(patch) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* navegação privada: vale só para esta sessão */
  }
  listeners.forEach((fn) => fn(current));
}

export function onSettingsChange(fn) {
  listeners.add(fn);
}
