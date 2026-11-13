// API simulada no navegador (modo "Dados de demonstração").
// Segue o mesmo contrato da CondoHub API (rotas, formatos e códigos de erro) e as mesmas
// regras de api/app/reservas/service.py, com os dados de db/02_seed.sql e db/03_demo.sql.
// Serve para usar e testar o front-end sem PostgreSQL nem servidor Python.

import { DEMO_CONDOMINIUM_ID } from './config.js';
import { maintenanceRoutes, seedMaintenance } from './mock-maintenance.js';

const TZ = 'America/Sao_Paulo';
const OFFSET = '-03:00'; // São Paulo não tem horário de verão desde 2019
const STORE_KEY = 'condohub.mock.v3'; // v3: inadimplência na unidade

const U = {
  aline: 'aaaaaaaa-0000-0000-0000-000000000001',
  roberto: 'aaaaaaaa-0000-0000-0000-000000000002',
  marcos: 'aaaaaaaa-0000-0000-0000-000000000003',
  paula: 'aaaaaaaa-0000-0000-0000-000000000004',
};

export class MockError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- datas

const pad = (n) => String(n).padStart(2, '0');
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export const at = (date, time) => `${date}T${time.slice(0, 5)}:00${OFFSET}`;
export const ms = (iso) => Date.parse(iso);
export const nowIso = () => {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return `${d.toISOString().slice(0, 19)}${OFFSET}`;
};
const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;

// ---------------------------------------------------------------- dados iniciais

function seed() {
  const today = todayIso();
  const unit = (code, block, inadimplente = false) => ({ id: uuid(), code, block, label: `Apto ${code} · Bloco ${block}`, inadimplente });
  // 210 A (Paula) está inadimplente, como em db/03_demo.sql
  const units = [unit('101', 'A'), unit('104', 'A'), unit('210', 'A', true), unit('302', 'B'), unit('305', 'B')];
  const byCode = (code) => units.find((u) => u.code === code);

  const space = (name, description, capacity, icon, mode, opens, closes, slot) => ({
    id: uuid(), name, description, capacity, icon, booking_mode: mode,
    opens_at: opens ? `${opens}:00` : null, closes_at: closes ? `${closes}:00` : null, slot_minutes: slot,
    max_per_unit: 3, booking_horizon_days: 90, requires_terms: true, is_active: true,
  });
  const spaces = [
    space('Salão de festas', 'Até 80 pessoas · dia todo', 80, 'sparkle', 'full_day'),
    space('Churrasqueira', 'Até 30 pessoas · dia todo', 30, 'flame', 'full_day'),
    space('Quadra poliesportiva', 'Quadra · 07h às 22h', null, 'ball', 'hourly', '07:00', '22:00', 120),
    space('Espaço gourmet', 'Até 20 pessoas · 10h às 23h', 20, 'chef', 'hourly', '10:00', '23:00', 180),
    space('Piscina', 'Área descoberta · 09h às 18h', null, 'waves', 'hourly', '09:00', '18:00', 120),
    space('Sala de jogos', 'Sinuca · 10h às 22h', null, 'gamepad', 'hourly', '10:00', '22:00', 120),
  ];
  const S = Object.fromEntries(spaces.map((s) => [s.name, s]));

  const rulesDocuments = spaces.map((s) => ({
    id: uuid(), space_id: s.id, version: 1, file_url: `/files/regulamento-${s.id}-v1.pdf`, file_size_bytes: 184320,
    summary: 'Cancelamento sem custo até 48h antes do uso.\nO espaço deve ser devolvido limpo e organizado.\nDanos ao patrimônio são cobrados do responsável.\nSilêncio obrigatório a partir das 22h.',
    published_at: at(addDays(today, -30), '09:00'),
  }));

  const reservation = (spaceName, unitCode, userId, date, time, status) => {
    const s = S[spaceName];
    const start = s.booking_mode === 'full_day' ? at(date, '00:00') : at(date, time);
    const end = s.booking_mode === 'full_day'
      ? at(addDays(date, 1), '00:00')
      : at(date, fromMinutes(toMinutes(time) + s.slot_minutes));
    return {
      id: uuid(), space_id: s.id, unit_id: byCode(unitCode).id, requested_by: userId,
      start_datetime: start, end_datetime: end, status, reviewed_at: status === 'confirmed' ? at(addDays(today, -1), '10:00') : null,
      rejection_reason: null, canceled_at: null, cancel_reason: null,
      terms_accepted_at: at(addDays(today, -2), '20:15'), created_at: at(addDays(today, -2), '20:15'),
    };
  };
  const reservations = [
    reservation('Quadra poliesportiva', '302', U.aline, addDays(today, 6), '18:00', 'confirmed'),
    reservation('Espaço gourmet', '302', U.aline, addDays(today, -12), '19:00', 'confirmed'),
    reservation('Quadra poliesportiva', '104', U.marcos, addDays(today, 3), '09:00', 'confirmed'),
    reservation('Quadra poliesportiva', '104', U.marcos, addDays(today, 3), '19:00', 'confirmed'),
    reservation('Churrasqueira', '104', U.marcos, addDays(today, 4), null, 'pending'),
    reservation('Salão de festas', '210', U.paula, addDays(today, 10), null, 'confirmed'),
  ];

  return {
    condominium: { id: DEMO_CONDOMINIUM_ID, name: 'Residencial Jardins', management_company: 'Administradora Master', timezone: TZ },
    units,
    members: [
      { user_id: U.aline, name: 'Aline Costa', email: 'aline@exemplo.com', role: 'resident', is_active: true, has_pending_dues: false, units: [{ ...byCode('302'), relation: 'resident' }] },
      { user_id: U.roberto, name: 'Roberto Mendes', email: 'roberto@exemplo.com', role: 'manager', is_active: true, has_pending_dues: false, units: [] },
      { user_id: U.marcos, name: 'Marcos Lima', email: 'marcos@exemplo.com', role: 'resident', is_active: true, has_pending_dues: false, units: [{ ...byCode('104'), relation: 'owner' }] },
      { user_id: U.paula, name: 'Paula Rocha', email: 'paula@exemplo.com', role: 'resident', is_active: true, has_pending_dues: true, units: [{ ...byCode('210'), relation: 'resident' }] },
    ],
    spaces,
    rulesDocuments,
    blocks: [
      { id: uuid(), space_id: S.Piscina.id, starts_at: at(addDays(today, -1), '00:00'), ends_at: at(addDays(today, 4), '00:00'), reason: 'Manutenção', incident_id: null },
    ],
    reservations,
    notifications: [
      { id: uuid(), user_id: U.aline, kind: 'reservation_confirmed', title: 'Sua reserva foi confirmada', body: null, incident_id: null, reservation_id: reservations[0].id, read_at: null, created_at: at(addDays(today, -1), '10:00') },
    ],
  };
}

let db = null;
function load() {
  if (db) return db;
  try {
    db = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  } catch {
    db = null;
  }
  if (!db) {
    db = seed();
    seedMaintenance(db);
  }
  return db;
}
function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    /* só memória */
  }
}

// ---------------------------------------------------------------- regras (espelho do service.py)

const ACTIVE = ['pending', 'confirmed'];
export const member = (userId) => db.members.find((m) => m.user_id === userId);
export const notFound = (what) => new MockError(404, 'not_found', `Não encontrado: ${what}`);

export function requireUser(userId) {
  if (!userId) throw new MockError(400, 'user_required', 'Informe o usuário no cabeçalho X-User-Id');
  if (!member(userId)) throw new MockError(422, 'unknown_user', 'O usuário informado não participa deste condomínio');
  return userId;
}

function getSpace(id) {
  const s = db.spaces.find((x) => x.id === id);
  if (!s) throw notFound('Área');
  return s;
}

const currentDoc = (spaceId) => db.rulesDocuments.filter((d) => d.space_id === spaceId).sort((a, b) => b.version - a.version)[0] || null;
const docOut = (d) => d && { id: d.id, version: d.version, file_url: d.file_url, file_size_bytes: d.file_size_bytes, summary: d.summary, published_at: d.published_at };
const blockOut = (b) => b && { id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, reason: b.reason, incident_id: b.incident_id };
function currentBlock(spaceId) {
  const now = Date.now();
  return db.blocks.find((b) => b.space_id === spaceId && ms(b.starts_at) <= now && ms(b.ends_at) > now) || null;
}
function spaceOut(s) {
  return { ...s, current_block: blockOut(currentBlock(s.id)), rules_document: docOut(currentDoc(s.id)) };
}

function daySlots(space, date) {
  if (space.booking_mode === 'full_day') return [[at(date, '00:00'), at(addDays(date, 1), '00:00')]];
  const slots = [];
  const close = toMinutes(space.closes_at);
  for (let t = toMinutes(space.opens_at); t + space.slot_minutes <= close; t += space.slot_minutes) {
    slots.push([at(date, fromMinutes(t)), at(date, fromMinutes(t + space.slot_minutes))]);
  }
  return slots;
}

const lastBookable = (space) => addDays(todayIso(), space.booking_horizon_days);
const overlaps = ([s, e], list) => list.some(([os, oe]) => ms(s) < ms(oe) && ms(e) > ms(os));

function busy(spaceId, start, end, exclude) {
  const reservations = db.reservations
    .filter((r) => r.space_id === spaceId && ACTIVE.includes(r.status) && r.id !== exclude && ms(r.start_datetime) < ms(end) && ms(r.end_datetime) > ms(start))
    .map((r) => [r.start_datetime, r.end_datetime]);
  const blocks = db.blocks
    .filter((b) => b.space_id === spaceId && ms(b.starts_at) < ms(end) && ms(b.ends_at) > ms(start))
    .map((b) => [b.starts_at, b.ends_at]);
  return { reservations, blocks };
}

function slotStatus(space, slot, b) {
  if (ms(slot[0]) < Date.now()) return 'past';
  if (!space.is_active || slot[0].slice(0, 10) > lastBookable(space) || overlaps(slot, b.blocks)) return 'unavailable';
  if (overlaps(slot, b.reservations)) return 'occupied';
  return 'available';
}

function slotsForDay(space, date) {
  const b = busy(space.id, at(date, '00:00'), at(addDays(date, 1), '00:00'));
  return {
    space_id: space.id, date, booking_mode: space.booking_mode,
    slots: daySlots(space, date).map(([s, e]) => ({ start: s, end: e, start_time: `${s.slice(11, 16)}:00`, status: slotStatus(space, [s, e], b) })),
  };
}

function monthAvailability(space, month) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const b = busy(space.id, at(first, '00:00'), at(addDays(first, count), '00:00'));
  const today = todayIso();
  const days = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(first, i);
    if (date < today) {
      days.push({ date, status: 'past', free_slots: 0 });
      continue;
    }
    const statuses = daySlots(space, date).map((slot) => slotStatus(space, slot, b));
    const free = statuses.filter((s) => s === 'available').length;
    const occupied = statuses.filter((s) => s === 'occupied').length;
    let status = 'unavailable';
    if (free && occupied) status = 'partial';
    else if (free) status = 'available';
    else if (occupied) status = 'full';
    else if (statuses.length && statuses.every((s) => s === 'past')) status = 'past';
    days.push({ date, status, free_slots: free });
  }
  return { space_id: space.id, booking_mode: space.booking_mode, month, last_bookable_date: lastBookable(space), days };
}

function resolvePeriod(space, date, startTime) {
  if (space.booking_mode === 'full_day') return daySlots(space, date)[0];
  if (!startTime) throw new MockError(422, 'start_time_required', 'Escolha um horário');
  const slot = daySlots(space, date).find(([s]) => s.slice(11, 16) === startTime.slice(0, 5));
  if (!slot) throw new MockError(422, 'invalid_slot', 'Horário fora da grade de funcionamento da área');
  return slot;
}

function checkPeriod(space, period, exclude) {
  if (!space.is_active) throw new MockError(409, 'space_unavailable', 'Este local está indisponível para reserva');
  if (ms(period[0]) < Date.now()) throw new MockError(422, 'date_in_past', 'Escolha uma data e horário futuros');
  if (period[0].slice(0, 10) > lastBookable(space)) {
    throw new MockError(422, 'beyond_horizon', `Reservas abrem com até ${space.booking_horizon_days} dias de antecedência`);
  }
  const b = busy(space.id, period[0], period[1], exclude);
  if (overlaps(period, b.blocks)) throw new MockError(409, 'space_unavailable', 'Este local está bloqueado no período escolhido');
  if (overlaps(period, b.reservations)) throw new MockError(409, 'slot_taken', 'Este horário já foi reservado');
}

function checkUnitConflict(unitId, period, exclude) {
  const clash = db.reservations.some((r) => r.unit_id === unitId && r.id !== exclude && ACTIVE.includes(r.status)
    && overlaps(period, [[r.start_datetime, r.end_datetime]]));
  if (clash) throw new MockError(409, 'unit_conflict', 'A unidade já tem uma reserva no mesmo período');
}

function reservationOut(r) {
  const space = getSpace(r.space_id);
  const unit = db.units.find((u) => u.id === r.unit_id);
  const user = member(r.requested_by);
  return {
    id: r.id, space: { id: space.id, name: space.name }, booking_mode: space.booking_mode,
    unit: { id: unit.id, code: unit.code, block: unit.block, label: unit.label, inadimplente: Boolean(unit.inadimplente) },
    requested_by: { id: user.user_id, name: user.name },
    start_datetime: r.start_datetime, end_datetime: r.end_datetime, status: r.status,
    reviewed_at: r.reviewed_at, rejection_reason: r.rejection_reason, canceled_at: r.canceled_at,
    cancel_reason: r.cancel_reason, terms_accepted_at: r.terms_accepted_at, created_at: r.created_at,
  };
}

function getReservation(id) {
  const r = db.reservations.find((x) => x.id === id);
  if (!r) throw notFound('Reserva');
  return r;
}

function requireActiveFuture(r, action) {
  if (!ACTIVE.includes(r.status) || ms(r.start_datetime) <= Date.now()) {
    throw new MockError(409, `not_${action}`, 'Só reservas futuras pendentes ou confirmadas podem ser alteradas');
  }
}

function notify(userIds, kind, title, body, reservationId) {
  for (const userId of userIds) {
    db.notifications.push({ id: uuid(), user_id: userId, kind, title, body: body || null, incident_id: null, reservation_id: reservationId, read_at: null, created_at: nowIso() });
  }
}
export const managers = () => db.members.filter((m) => m.role === 'manager' || m.role === 'admin').map((m) => m.user_id);

// Mesma regra da API: a flag fica na unidade e vale para todos os moradores, em qualquer área.
function checkUnitNotDelinquent(unitId) {
  if (db.units.find((u) => u.id === unitId)?.inadimplente) {
    throw new MockError(403, 'pending_dues', 'A unidade tem pendências financeiras; regularize com a administração para reservar');
  }
}

function createReservation(userId, data) {
  requireUser(userId);
  const space = getSpace(data.space_id);
  const who = member(userId);
  if (!who.is_active) throw new MockError(422, 'user_inactive', 'Usuário inativo não pode reservar');
  if (!who.units.some((u) => u.id === data.unit_id)) throw new MockError(422, 'unit_not_linked', 'Você não está vinculado a esta unidade');
  checkUnitNotDelinquent(data.unit_id);
  const period = resolvePeriod(space, data.date, data.start_time);
  checkPeriod(space, period);
  const future = db.reservations.filter((r) => r.unit_id === data.unit_id && r.space_id === space.id && ACTIVE.includes(r.status) && ms(r.start_datetime) > Date.now());
  if (future.length >= space.max_per_unit) {
    throw new MockError(422, 'limit_reached', `A unidade já tem ${space.max_per_unit} reserva(s) futura(s) nesta área`);
  }
  if (space.requires_terms) {
    const doc = currentDoc(space.id);
    if (!doc) throw new MockError(409, 'terms_unavailable', 'A área exige aceite, mas não há regulamento publicado');
    if (data.rules_document_id && data.rules_document_id !== doc.id) {
      throw new MockError(409, 'terms_outdated', 'O regulamento foi atualizado; leia e aceite a versão vigente');
    }
    if (!data.accept_terms) throw new MockError(422, 'terms_required', 'É preciso aceitar o regulamento para reservar');
  }
  checkUnitConflict(data.unit_id, period);
  const r = {
    id: uuid(), space_id: space.id, unit_id: data.unit_id, requested_by: userId,
    start_datetime: period[0], end_datetime: period[1], status: 'pending', reviewed_at: null,
    rejection_reason: null, canceled_at: null, cancel_reason: null,
    terms_accepted_at: space.requires_terms ? nowIso() : null, created_at: nowIso(),
  };
  db.reservations.push(r);
  notify(managers(), 'reservation_requested', `Nova solicitação de reserva: ${space.name}`, null, r.id);
  return r;
}

function mineFilter(userId) {
  requireUser(userId);
  const myUnits = member(userId).units.map((u) => u.id);
  return (r) => r.requested_by === userId || myUnits.includes(r.unit_id);
}

function spaceFields(data) {
  if (data.booking_mode === 'hourly' && (!data.opens_at || !data.closes_at || !data.slot_minutes)) {
    throw new MockError(422, 'invalid_hours', 'Áreas por horário exigem abertura, fechamento e duração do bloco');
  }
  const norm = (t) => (t ? `${t.slice(0, 5)}:00` : null);
  return { ...data, opens_at: norm(data.opens_at), closes_at: norm(data.closes_at) };
}

function checkName(name, exceptId) {
  if (db.spaces.some((s) => s.id !== exceptId && s.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
    throw new MockError(409, 'duplicate_name', 'Já existe uma área com este nome');
  }
}

// ---------------------------------------------------------------- roteamento

const ROUTES = [
  ['GET', /^$/, () => db.condominium],
  ['GET', /^\/units$/, () => db.units],
  ['GET', /^\/members$/, () => db.members],
  ['GET', /^\/me$/, ({ userId }) => member(requireUser(userId))],
  ['GET', /^\/notifications$/, ({ userId, query }) => db.notifications
    .filter((n) => n.user_id === requireUser(userId) && (String(query.unread) !== 'true' || !n.read_at))
    .sort((a, b) => ms(b.created_at) - ms(a.created_at))],
  ['POST', /^\/notifications\/([\w-]+)\/read$/, ({ m }) => {
    const n = db.notifications.find((x) => x.id === m[1]);
    if (!n) throw notFound('Notificação');
    n.read_at = n.read_at || nowIso();
    return n;
  }],
  ['GET', /^\/spaces$/, ({ query }) => db.spaces
    .filter((s) => query.active === undefined || query.active === null || String(s.is_active) === String(query.active))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(spaceOut)],
  ['POST', /^\/spaces$/, ({ body }) => {
    checkName(body.name);
    const s = { id: uuid(), max_per_unit: 3, booking_horizon_days: 90, requires_terms: false, is_active: true, ...spaceFields(body) };
    db.spaces.push(s);
    return spaceOut(s);
  }],
  ['GET', /^\/spaces\/([\w-]+)$/, ({ m }) => spaceOut(getSpace(m[1]))],
  ['PATCH', /^\/spaces\/([\w-]+)$/, ({ m, body }) => {
    const s = getSpace(m[1]);
    if (body.name) checkName(body.name, s.id);
    Object.assign(s, spaceFields({ ...s, ...body }));
    return spaceOut(s);
  }],
  ['GET', /^\/spaces\/([\w-]+)\/availability$/, ({ m, query }) => monthAvailability(getSpace(m[1]), query.month)],
  ['GET', /^\/spaces\/([\w-]+)\/slots$/, ({ m, query }) => slotsForDay(getSpace(m[1]), query.date)],
  ['GET', /^\/spaces\/([\w-]+)\/rules-document$/, ({ m }) => {
    const d = currentDoc(getSpace(m[1]).id);
    if (!d) throw notFound('Regulamento');
    return docOut(d);
  }],
  ['POST', /^\/spaces\/([\w-]+)\/rules-documents$/, ({ m, body, userId }) => {
    requireUser(userId);
    const s = getSpace(m[1]);
    const last = currentDoc(s.id);
    const d = { id: uuid(), space_id: s.id, version: (last?.version || 0) + 1, published_at: nowIso(), file_size_bytes: null, summary: null, ...body };
    db.rulesDocuments.push(d);
    return docOut(d);
  }],
  ['GET', /^\/reservations$/, ({ query, userId }) => {
    let list = db.reservations;
    if (String(query.mine) === 'true') list = list.filter(mineFilter(userId));
    if (query.space_id) list = list.filter((r) => r.space_id === query.space_id);
    if (query.unit_id) list = list.filter((r) => r.unit_id === query.unit_id);
    if (query.status) {
      const wanted = [].concat(query.status);
      list = list.filter((r) => wanted.includes(r.status));
    }
    if (query.start) list = list.filter((r) => ms(r.end_datetime) > ms(query.start));
    if (query.end) list = list.filter((r) => ms(r.start_datetime) < ms(query.end));
    return [...list].sort((a, b) => ms(a.start_datetime) - ms(b.start_datetime)).map(reservationOut);
  }],
  ['POST', /^\/reservations$/, ({ body, userId }) => reservationOut(createReservation(userId, body))],
  ['GET', /^\/reservations\/([\w-]+)$/, ({ m }) => reservationOut(getReservation(m[1]))],
  ['PATCH', /^\/reservations\/([\w-]+)$/, ({ m, body }) => {
    const r = getReservation(m[1]);
    requireActiveFuture(r, 'editable');
    checkUnitNotDelinquent(r.unit_id);
    const space = getSpace(r.space_id);
    const period = resolvePeriod(space, body.date, body.start_time);
    checkPeriod(space, period, r.id);
    checkUnitConflict(r.unit_id, period, r.id);
    Object.assign(r, { start_datetime: period[0], end_datetime: period[1], status: 'pending', reviewed_at: null });
    return reservationOut(r);
  }],
  ['POST', /^\/reservations\/([\w-]+)\/cancel$/, ({ m, body, userId }) => {
    const r = getReservation(m[1]);
    requireActiveFuture(r, 'cancelable');
    requireUser(userId);
    Object.assign(r, { status: 'canceled', canceled_at: nowIso(), cancel_reason: body?.reason || null });
    return reservationOut(r);
  }],
  ['POST', /^\/reservations\/([\w-]+)\/(approve|reject)$/, ({ m, body, userId }) => {
    const r = getReservation(m[1]);
    if (r.status !== 'pending') throw new MockError(409, 'not_pending', 'Só reservas pendentes podem ser aprovadas ou recusadas');
    requireUser(userId);
    if (m[2] === 'reject' && !body?.reason?.trim()) throw new MockError(422, 'reason_required', 'Informe o motivo da recusa');
    r.reviewed_at = nowIso();
    if (m[2] === 'approve') r.status = 'confirmed';
    else Object.assign(r, { status: 'rejected', rejection_reason: body.reason });
    notify([r.requested_by], `reservation_${r.status}`, r.status === 'confirmed' ? 'Sua reserva foi confirmada' : 'Sua reserva foi recusada', r.rejection_reason, r.id);
    return reservationOut(r);
  }],
];

export async function handleMock({ method, path, query, body, userId }) {
  await new Promise((r) => setTimeout(r, 180 + Math.random() * 220));
  load();
  const match = path.match(/^\/condominiums\/([\w-]+)(.*)$/);
  try {
    if (!match || match[1] !== db.condominium.id) throw notFound('Condomínio');
    if (userId && !member(userId)) throw new MockError(422, 'unknown_user', 'O usuário informado não participa deste condomínio');
    for (const [verb, pattern, fn] of [...ROUTES, ...maintenanceRoutes(() => db)]) {
      const m = match[2].match(pattern);
      if (verb === method && m) {
        const result = fn({ m, query, body, userId });
        if (method !== 'GET') save();
        return JSON.parse(JSON.stringify(result));
      }
    }
    throw new MockError(404, 'not_found', `Rota não encontrada: ${method} ${path}`);
  } catch (err) {
    if (err instanceof MockError) {
      const { ApiError } = await import('./api.js');
      throw new ApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/** Volta os dados de demonstração ao estado inicial. */
export function resetMock() {
  db = seed();
  seedMaintenance(db);
  save();
}
