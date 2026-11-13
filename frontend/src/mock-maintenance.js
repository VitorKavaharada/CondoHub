// Parte de manutenção da API simulada (modo "Dados de demonstração").
// Espelha api/app/manutencao/service.py e recurrence.py, com os dados de db/02_seed.sql e db/03_demo.sql.

import { MockError, addDays, at, managers, member, ms, notFound, nowIso, requireUser, todayIso, uuid } from './mock.js';

const OPEN = ['submitted', 'under_review', 'approved', 'in_progress'];
const TRANSITIONS = {
  submitted: ['under_review', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['in_progress'],
  in_progress: ['done'],
};
const PRIORITY_HOURS = { high: 48, medium: 5 * 24, low: 15 * 24 };
const PRIORITY_LABEL = { high: 'alta', medium: 'média', low: 'baixa' };
const MONTH_STEP = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const pad = (n) => String(n).padStart(2, '0');
const plusHours = (iso, h) => isoAt(ms(iso) + h * 3600000);
function isoAt(epoch) {
  const d = new Date(epoch - 3 * 3600000);
  return `${d.toISOString().slice(0, 19)}-03:00`;
}

// ---------------------------------------------------------------- recorrência (recurrence.py)

function addMonthsClamped(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}
const occurrenceDate = (rule, k) => (rule.frequency === 'weekly' ? addDays(rule.first_run_date, 7 * k) : addMonthsClamped(rule.first_run_date, k * MONTH_STEP[rule.frequency]));
const occurrenceAt = (rule, k) => at(occurrenceDate(rule, k), (rule.run_time || '08:00:00').slice(0, 5));

function occurrencesBetween(rule, startEpoch, endEpoch) {
  const out = [];
  for (let k = 0; k < 2000; k++) {
    const when = occurrenceAt(rule, k);
    if (ms(when) >= endEpoch) break;
    if (ms(when) >= startEpoch) out.push(when);
  }
  return out;
}
function nextOccurrence(rule, afterEpoch, inclusive = true) {
  for (let k = 0; k < 2000; k++) {
    const when = occurrenceAt(rule, k);
    if (ms(when) > afterEpoch || (inclusive && ms(when) === afterEpoch)) return when;
  }
  return null;
}
function eventDueAt(window, eventAt) {
  if (window === 'within_2h') return plusHours(eventAt, 2);
  if (window === 'within_4h') return plusHours(eventAt, 4);
  return at(addDays(eventAt.slice(0, 10), 1), '10:00');
}

// ---------------------------------------------------------------- dados iniciais

export function seedMaintenance(db) {
  const today = todayIso();
  const U = Object.fromEntries(db.members.map((m) => [m.name.split(' ')[0].toLowerCase(), m]));

  const types = ['Elétrica', 'Hidráulica', 'Limpeza', 'Estrutura e pintura', 'Portões e acesso', 'Elevador', 'Ar-condicionado', 'Piscina', 'Jardinagem', 'Outro']
    .map((name) => ({ id: uuid(), name, is_active: true }));
  const T = Object.fromEntries(types.map((t) => [t.name, t]));

  const locations = [
    ...db.spaces.map((s) => ({ id: uuid(), name: s.name, is_active: true, condo_space_id: s.id })),
    ...['Garagem G1', 'Garagem G2', 'Hall · Bloco A', 'Hall · Bloco B', 'Térreo · Bloco B', 'Elevador social · Bloco A',
      'Elevador social · Bloco B', 'Elevador de serviço · Bloco B', 'Portaria', 'Academia']
      .map((name) => ({ id: uuid(), name, is_active: true, condo_space_id: null })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const L = Object.fromEntries(locations.map((l) => [l.name, l]));

  const prov = (kind, name, extra, skills) => ({
    id: uuid(), kind, name, document: null, job_title: null, team_size: 1, phone: null, contract_type: null,
    contract_valid_until: null, shift: null, is_active: true, created_at: at(addDays(today, -200), '10:00'),
    specialty_ids: skills.map((s) => T[s].id), ...extra,
  });
  const providers = [
    prov('employee', 'Carlos Souza', { job_title: 'Zelador', phone: '(11) 98812-4410', shift: 'business_hours' }, ['Hidráulica', 'Portões e acesso', 'Piscina', 'Limpeza']),
    prov('employee', 'Equipe de limpeza', { job_title: 'Auxiliar de limpeza', team_size: 3, phone: 'Ramal 12', shift: 'morning' }, ['Limpeza']),
    prov('external', 'Hidráulica Ramos', { document: '12.345.678/0001-01', phone: '(11) 3321-9087', contract_type: 'on_demand' }, ['Hidráulica']),
    prov('external', 'Eletro Silva', { document: '23.456.789/0001-02', phone: '(11) 97455-1203', contract_type: 'on_demand' }, ['Elétrica']),
    prov('external', 'Elevadores Atlas', { document: '34.567.890/0001-03', phone: '0800 771 2020', contract_type: 'monthly', contract_valid_until: addDays(today, 145) }, ['Elevador']),
    prov('external', 'Clima Frio Serviços', { document: '45.678.901/0001-04', phone: '(11) 4002-3311', contract_type: 'semiannual_annual', contract_valid_until: addDays(today, 24) }, ['Ar-condicionado']),
    prov('external', 'Multi Reparos', { document: '56.789.012/0001-05', phone: '(11) 96610-5544', contract_type: 'on_demand' }, ['Estrutura e pintura', 'Outro']),
  ];
  const P = Object.fromEntries(providers.map((p) => [p.name, p]));

  const rule = (name, description, type, location, trigger, extra, provider, active = true) => ({
    id: uuid(), name, description, maintenance_type_id: T[type].id, location_id: L[location].id, trigger_type: trigger,
    frequency: null, first_run_date: null, run_time: null, trigger_event: null, execution_window: null,
    default_provider_id: provider ? P[provider].id : null, reminder_days_before: 2, next_run_at: null, is_active: active,
    created_at: at(addDays(today, -120), '10:00'), ...extra,
  });
  const ev = { trigger_event: 'reservation_ended', execution_window: 'within_4h' };
  const preventives = [
    rule('Limpeza pós-reserva · Salão', 'Limpeza completa após o uso', 'Limpeza', 'Salão de festas', 'event', ev, 'Equipe de limpeza'),
    rule('Limpeza pós-reserva · Churrasqueira', 'Limpeza completa após o uso', 'Limpeza', 'Churrasqueira', 'event', ev, 'Equipe de limpeza'),
    rule('Limpeza pós-reserva · Gourmet', 'Limpeza completa após o uso', 'Limpeza', 'Espaço gourmet', 'event', ev, 'Equipe de limpeza'),
    rule('Manutenção da churrasqueira', 'Grelhas, coifa e ralos', 'Limpeza', 'Churrasqueira', 'recurring', { frequency: 'monthly', first_run_date: addDays(today, -52), run_time: '08:00:00' }, 'Carlos Souza'),
    rule('Revisão do ar-condicionado', 'Filtros e PMOC', 'Ar-condicionado', 'Salão de festas', 'recurring', { frequency: 'semiannual', first_run_date: addDays(today, -202), run_time: '09:00:00' }, 'Clima Frio Serviços'),
    rule('Tratamento da piscina', 'Tratamento semanal da água', 'Piscina', 'Piscina', 'recurring', { frequency: 'weekly', first_run_date: addDays(today, -36), run_time: '07:00:00' }, 'Carlos Souza'),
    rule('Revisão dos elevadores', 'Obrigatória por contrato', 'Elevador', 'Elevador social · Bloco A', 'recurring', { frequency: 'monthly', first_run_date: addDays(today, -78), run_time: '09:00:00' }, 'Elevadores Atlas'),
    rule('Recarga de extintores', null, 'Outro', 'Portaria', 'recurring', { frequency: 'annual', first_run_date: addDays(today, 124), run_time: '09:00:00' }, null, false),
  ];
  for (const r of preventives) if (r.trigger_type === 'recurring') r.next_run_at = nextOccurrence(r, Date.now());
  const R = Object.fromEntries(preventives.map((r) => [r.name, r]));

  let counter = 128;
  const incidents = [];
  const roberto = U.roberto.user_id;
  const inc = (o) => {
    counter += 1;
    const created = o.created;
    const history = [{ status: 'submitted', note: o.origin === 'manual' ? 'Manutenção agendada pelo síndico.' : null, changed_by: o.by || null, changed_at: created }];
    const step = (status, when, note, by = roberto) => history.push({ status, note, changed_by: by, changed_at: when });
    const i = {
      id: uuid(), code: `MNT-0${counter}`, title: o.title, description: o.description || null, status: o.status,
      origin: o.origin || 'resident', location_id: L[o.location].id, maintenance_type_id: T[o.type].id,
      assigned_provider_id: o.provider ? P[o.provider].id : null, scheduled_start_at: o.start || null, scheduled_end_at: o.end || null,
      finished_at: o.finished || null, requested_by: o.by || null, unit_id: o.by ? member(o.by).units[0]?.id || null : null,
      priority: o.priority || null, due_at: o.priority ? plusHours(o.reviewed || created, PRIORITY_HOURS[o.priority]) : null,
      rejection_reason: o.reason || null, rejection_note: o.note || null, started_at: o.started || null, cost: o.cost ?? null,
      created_at: created, reviewed_by: o.reviewed ? roberto : null, reviewed_at: o.reviewed || null,
      related_incident_id: o.related || null, preventive_maintenance_id: o.rule ? R[o.rule].id : null, trigger_reservation_id: null,
      resident_rating: o.rating || null, resident_feedback: null, rated_at: o.rating ? o.finished : null, history, attachments: [],
    };
    if (o.origin === 'manual' || o.origin === 'preventive') history[0].status = 'approved';
    if (!['submitted'].includes(o.status) && (o.origin || 'resident') === 'resident') step('under_review', o.reviewing || plusHours(created, 2), null);
    if (['approved', 'in_progress', 'done'].includes(o.status) && (o.origin || 'resident') === 'resident') {
      step('approved', o.reviewed, `Prioridade ${PRIORITY_LABEL[o.priority]}. Responsável: ${o.provider}.`);
    }
    if (['in_progress', 'done'].includes(o.status)) step('in_progress', o.started, null);
    if (o.status === 'done') step('done', o.finished, null);
    if (o.status === 'rejected') step('rejected', o.reviewed, o.note);
    incidents.push(i);
    return i;
  };
  const d = (days, time) => at(addDays(today, days), time);

  const portao = inc({ title: 'Troca de dobradiças do portão', type: 'Portões e acesso', location: 'Piscina', origin: 'manual', status: 'approved', priority: 'medium', provider: 'Carlos Souza', created: d(-6, '10:00'), reviewed: d(-6, '10:00'), start: d(6, '08:00'), end: d(6, '10:00'), description: 'Troca das dobradiças e lubrificação do portão de acesso à piscina.' });
  inc({ title: 'Vazamento no teto da garagem', type: 'Hidráulica', location: 'Garagem G2', by: U.aline.user_id, status: 'approved', priority: 'high', provider: 'Hidráulica Ramos', created: d(-1, '08:41'), reviewing: d(-1, '09:30'), reviewed: d(-1, '10:05'), start: d(3, '09:00'), end: d(3, '12:00'), description: 'Goteira constante perto da vaga 214 desde ontem à noite. Já formou poça no piso.' });
  inc({ title: 'Lâmpada queimada no hall', type: 'Elétrica', location: 'Hall · Bloco B', by: U.aline.user_id, status: 'submitted', created: d(0, '07:50'), description: 'A lâmpada perto do elevador está apagada, o hall fica escuro à noite.' });
  inc({ title: 'Portão da piscina rangendo', type: 'Portões e acesso', location: 'Piscina', by: U.aline.user_id, status: 'rejected', created: d(-5, '19:02'), reviewing: d(-4, '09:47'), reviewed: d(-4, '11:20'), reason: 'already_scheduled', related: portao.id, note: 'A troca das dobradiças e a lubrificação do portão da piscina já estão programadas com a equipe interna. Obrigado pelo aviso!' });
  inc({ title: 'Interfone sem som', type: 'Elétrica', location: 'Portaria', by: U.aline.user_id, status: 'done', priority: 'medium', provider: 'Eletro Silva', created: d(-40, '18:20'), reviewed: d(-39, '09:00'), started: d(-36, '14:00'), finished: d(-36, '16:30'), cost: 180 });
  inc({ title: 'Infiltração na parede da academia', type: 'Estrutura e pintura', location: 'Academia', by: U.marcos.user_id, status: 'under_review', created: d(-2, '21:15'), reviewing: d(-1, '08:30'), description: 'Mancha de umidade crescendo na parede do fundo, perto da esteira.' });
  inc({ title: 'Elevador parando entre andares', type: 'Elevador', location: 'Elevador social · Bloco B', by: U.marcos.user_id, status: 'in_progress', priority: 'high', provider: 'Elevadores Atlas', created: d(-1, '07:12'), reviewed: d(-1, '07:40'), started: d(0, '09:00'), start: d(0, '09:00'), end: d(0, '13:00') });
  inc({ title: 'Ralo entupido na churrasqueira', type: 'Hidráulica', location: 'Churrasqueira', by: U.paula.user_id, status: 'submitted', created: d(-1, '22:40') });
  inc({ title: 'Tratamento da piscina', type: 'Piscina', location: 'Piscina', origin: 'preventive', rule: 'Tratamento da piscina', status: 'done', priority: 'medium', provider: 'Carlos Souza', created: d(-8, '07:00'), started: d(-8, '07:00'), finished: d(-8, '08:10') });
  inc({ title: 'Tratamento da piscina', type: 'Piscina', location: 'Piscina', origin: 'preventive', rule: 'Tratamento da piscina', status: 'done', priority: 'medium', provider: 'Carlos Souza', created: d(-15, '07:00'), started: d(-15, '07:00'), finished: d(-15, '08:05'), cost: 95 });
  inc({ title: 'Revisão dos elevadores', type: 'Elevador', location: 'Elevador social · Bloco A', origin: 'preventive', rule: 'Revisão dos elevadores', status: 'done', priority: 'medium', provider: 'Elevadores Atlas', created: d(-17, '09:00'), started: d(-17, '09:00'), finished: d(-17, '11:30'), cost: 0 });
  inc({ title: 'Limpeza pós-reserva · Gourmet', type: 'Limpeza', location: 'Espaço gourmet', origin: 'preventive', rule: 'Limpeza pós-reserva · Gourmet', status: 'done', priority: 'medium', provider: 'Equipe de limpeza', created: d(-12, '22:00'), started: d(-11, '08:00'), finished: d(-11, '09:20') });
  inc({ title: 'Pintura do hall', type: 'Estrutura e pintura', location: 'Hall · Bloco A', origin: 'manual', status: 'done', priority: 'low', provider: 'Multi Reparos', created: d(-75, '10:00'), started: d(-62, '08:00'), finished: d(-60, '17:00'), cost: 1450 });
  inc({ title: 'Troca do sifão da garagem', type: 'Hidráulica', location: 'Garagem G1', by: U.marcos.user_id, status: 'done', priority: 'medium', provider: 'Hidráulica Ramos', created: d(-95, '20:00'), reviewed: d(-94, '09:00'), started: d(-90, '10:00'), finished: d(-90, '12:00'), cost: 220, rating: 5 });
  inc({ title: 'Revisão do ar-condicionado', type: 'Ar-condicionado', location: 'Salão de festas', origin: 'preventive', rule: 'Revisão do ar-condicionado', status: 'done', priority: 'medium', provider: 'Clima Frio Serviços', created: d(-202, '09:00'), started: d(-202, '09:00'), finished: d(-202, '15:00'), cost: 980 });

  Object.assign(db, { maintenanceTypes: types, maintenanceLocations: locations, providers, preventives, incidents, incidentCounter: counter });
}

// ---------------------------------------------------------------- saída (formato da API)

export function maintenanceRoutes(getDb) {
  const db = () => getDb();
  const ref = (list, id) => {
    const x = id && db()[list].find((i) => i.id === id);
    return x ? { id: x.id, name: x.name } : null;
  };
  const userRef = (id) => {
    const m = id && member(id);
    return m ? { id: m.user_id, name: m.name } : null;
  };
  const unitOut = (id) => {
    const u = id && db().units.find((x) => x.id === id);
    return u ? { id: u.id, code: u.code, block: u.block, label: u.label } : null;
  };
  const brief = (i) => ({
    id: i.id, code: i.code, title: i.title, status: i.status, origin: i.origin,
    location: ref('maintenanceLocations', i.location_id), maintenance_type: ref('maintenanceTypes', i.maintenance_type_id),
    assigned_provider: ref('providers', i.assigned_provider_id),
    scheduled_start_at: i.scheduled_start_at, scheduled_end_at: i.scheduled_end_at, finished_at: i.finished_at,
  });
  const ruleOf = (i) => db().preventives.find((r) => r.id === i.preventive_maintenance_id);
  const out = (i) => ({
    ...brief(i), description: i.description, preventive_trigger: i.origin === 'preventive' ? ruleOf(i)?.trigger_type || 'recurring' : null,
    requested_by: userRef(i.requested_by), unit: unitOut(i.unit_id), priority: i.priority, due_at: i.due_at,
    rejection_reason: i.rejection_reason, rejection_note: i.rejection_note, started_at: i.started_at, cost: i.cost, created_at: i.created_at,
  });
  function detail(i) {
    const same = db().incidents.filter((x) => x.location_id === i.location_id && x.id !== i.id);
    const lastDone = same.filter((x) => x.status === 'done').sort((a, b) => ms(b.finished_at) - ms(a.finished_at))[0];
    const upcoming = same.filter((x) => ['approved', 'in_progress'].includes(x.status))
      .sort((a, b) => (a.scheduled_start_at ? ms(a.scheduled_start_at) : Infinity) - (b.scheduled_start_at ? ms(b.scheduled_start_at) : Infinity))
      .slice(0, 5);
    const related = db().incidents.find((x) => x.id === i.related_incident_id);
    return {
      ...out(i), reviewed_by: userRef(i.reviewed_by), reviewed_at: i.reviewed_at, related_incident: related ? brief(related) : null,
      preventive_maintenance: ref('preventives', i.preventive_maintenance_id), trigger_reservation_id: i.trigger_reservation_id,
      resident_rating: i.resident_rating, resident_feedback: i.resident_feedback, rated_at: i.rated_at,
      history: i.history.map((h) => ({ status: h.status, note: h.note, changed_by: userRef(h.changed_by), changed_at: h.changed_at })),
      attachments: i.attachments, location_context: { last_done: lastDone ? brief(lastDone) : null, upcoming: upcoming.map(brief) },
    };
  }
  const providerOut = (p) => ({
    ...p, specialty_ids: undefined, specialties: p.specialty_ids.map((id) => ref('maintenanceTypes', id)).filter(Boolean),
    open_assignments: db().incidents.filter((i) => i.assigned_provider_id === p.id && OPEN.includes(i.status)).length,
  });
  const preventiveBrief = (r) => ({
    id: r.id, name: r.name, trigger_type: r.trigger_type, frequency: r.frequency, trigger_event: r.trigger_event,
    location: ref('maintenanceLocations', r.location_id), next_run_at: r.next_run_at,
  });
  const providerDetail = (p) => ({
    ...providerOut(p),
    schedule: {
      incidents: db().incidents.filter((i) => i.assigned_provider_id === p.id && OPEN.includes(i.status)).map(brief),
      preventive_rules: db().preventives.filter((r) => r.is_active && r.default_provider_id === p.id).map(preventiveBrief),
    },
  });
  const preventiveOut = (r) => ({
    id: r.id, name: r.name, description: r.description, maintenance_type: ref('maintenanceTypes', r.maintenance_type_id),
    location: ref('maintenanceLocations', r.location_id), trigger_type: r.trigger_type, frequency: r.frequency,
    first_run_date: r.first_run_date, run_time: r.run_time, trigger_event: r.trigger_event, execution_window: r.execution_window,
    default_provider: ref('providers', r.default_provider_id), reminder_days_before: r.reminder_days_before,
    next_run_at: r.next_run_at, is_active: r.is_active, created_at: r.created_at,
  });

  // ------------------------------------------------------------ regras do ciclo (service.py)

  const getIncident = (id) => db().incidents.find((i) => i.id === id) || (() => { throw notFound('Ocorrência'); })();
  const getProvider = (id) => db().providers.find((p) => p.id === id) || (() => { throw notFound('Prestador'); })();
  const getRule = (id) => db().preventives.find((r) => r.id === id) || (() => { throw notFound('Regra preventiva'); })();

  function transition(i, target, note, userId) {
    if (!(TRANSITIONS[i.status] || []).includes(target)) {
      throw new MockError(409, 'invalid_transition', `Não é possível passar de ${i.status} para ${target}`);
    }
    i.status = target;
    i.history.push({ status: target, note: note || null, changed_by: userId || null, changed_at: nowIso() });
  }
  function notify(userIds, kind, title, body, incidentId) {
    for (const userId of userIds.filter(Boolean)) {
      db().notifications.push({ id: uuid(), user_id: userId, kind, title, body: body || null, incident_id: incidentId, reservation_id: null, read_at: null, created_at: nowIso() });
    }
  }
  function checkCatalog(locationId, typeId) {
    const loc = db().maintenanceLocations.find((l) => l.id === locationId);
    const type = db().maintenanceTypes.find((t) => t.id === typeId);
    if (!loc) throw notFound('Local');
    if (!type) throw notFound('Tipo de manutenção');
    if (!loc.is_active) throw new MockError(422, 'location_inactive', 'Este local não aceita novas solicitações');
    if (!type.is_active) throw new MockError(422, 'type_inactive', 'Este tipo de manutenção não aceita novas solicitações');
  }
  function newIncident(fields) {
    const d = db();
    d.incidentCounter += 1;
    const i = {
      id: uuid(), code: `MNT-${String(d.incidentCounter).padStart(4, '0')}`, description: null, assigned_provider_id: null,
      scheduled_start_at: null, scheduled_end_at: null, finished_at: null, requested_by: null, unit_id: null, priority: null,
      due_at: null, rejection_reason: null, rejection_note: null, started_at: null, cost: null, created_at: nowIso(),
      reviewed_by: null, reviewed_at: null, related_incident_id: null, preventive_maintenance_id: null, trigger_reservation_id: null,
      resident_rating: null, resident_feedback: null, rated_at: null, history: [], attachments: [], ...fields,
    };
    if (i.priority && !i.due_at) i.due_at = plusHours(i.created_at, PRIORITY_HOURS[i.priority]);
    i.history.push({ status: i.status, note: fields.note || null, changed_by: fields.requested_by || fields.reviewed_by || null, changed_at: i.created_at });
    delete i.note;
    d.incidents.push(i);
    return i;
  }

  function generate(rule, scheduledAt, dueAt, reservationId) {
    return newIncident({
      title: rule.name, description: rule.description, origin: 'preventive', status: 'approved', location_id: rule.location_id,
      maintenance_type_id: rule.maintenance_type_id, assigned_provider_id: rule.default_provider_id, priority: 'medium',
      scheduled_start_at: scheduledAt, due_at: dueAt, preventive_maintenance_id: rule.id, trigger_reservation_id: reservationId || null,
      note: rule.trigger_type === 'recurring' ? 'Gerada pela agenda preventiva.' : 'Gerada após reserva.',
    });
  }

  function runJob() {
    const now = Date.now();
    const created = [];
    for (const rule of db().preventives.filter((r) => r.is_active && r.trigger_type === 'recurring' && r.default_provider_id)) {
      while (rule.next_run_at && ms(rule.next_run_at) <= now) {
        created.push(generate(rule, rule.next_run_at, plusHours(rule.next_run_at, 5 * 24)).code);
        rule.next_run_at = nextOccurrence(rule, ms(rule.next_run_at), false);
      }
    }
    const done = new Set(db().incidents.map((i) => i.trigger_reservation_id).filter(Boolean));
    for (const rule of db().preventives.filter((r) => r.is_active && r.trigger_type === 'event' && r.default_provider_id)) {
      const loc = db().maintenanceLocations.find((l) => l.id === rule.location_id);
      if (!loc?.condo_space_id) continue;
      for (const res of db().reservations) {
        if (res.space_id !== loc.condo_space_id || done.has(res.id)) continue;
        const ended = rule.trigger_event === 'reservation_ended' && res.status === 'confirmed' && ms(res.end_datetime) <= now;
        const canceled = rule.trigger_event === 'reservation_canceled' && res.status === 'canceled';
        if (!ended && !canceled) continue;
        const eventAt = ended ? res.end_datetime : res.canceled_at;
        created.push(generate(rule, null, eventDueAt(rule.execution_window, eventAt), res.id).code);
        done.add(res.id);
      }
    }
    return { created, errors: [] };
  }

  function doneInPeriod(query) {
    const start = query.start || addDays(todayIso(), -365);
    return db().incidents.filter((i) => i.status === 'done' && i.finished_at.slice(0, 10) >= start
      && (!query.end || i.finished_at.slice(0, 10) <= query.end));
  }

  function calendar(month) {
    const [y, m] = month.split('-').map(Number);
    const start = ms(at(`${month}-01`, '00:00'));
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
    const end = ms(at(next, '00:00'));
    const events = [];
    const generated = new Set();
    for (const i of db().incidents) {
      const when = i.scheduled_start_at || i.due_at;
      if (i.status === 'rejected' || !when || ms(when) < start || ms(when) >= end) continue;
      const rule = ruleOf(i);
      if (rule) generated.add(`${rule.id}|${ms(when)}`);
      events.push({
        starts_at: when, kind: i.origin === 'manual' ? 'manual' : i.origin === 'resident' ? 'corrective' : rule?.trigger_type || 'recurring',
        projected: false, title: i.title, location: ref('maintenanceLocations', i.location_id), provider: ref('providers', i.assigned_provider_id),
        incident_id: i.id, incident_code: i.code, status: i.status, preventive_maintenance_id: i.preventive_maintenance_id,
      });
    }
    for (const rule of db().preventives.filter((r) => r.is_active && r.trigger_type === 'recurring')) {
      for (const when of occurrencesBetween(rule, Math.max(start, Date.now()), end)) {
        if (generated.has(`${rule.id}|${ms(when)}`)) continue;
        events.push({
          starts_at: when, kind: 'recurring', projected: true, title: rule.name, location: ref('maintenanceLocations', rule.location_id),
          provider: ref('providers', rule.default_provider_id), incident_id: null, incident_code: null, status: null, preventive_maintenance_id: rule.id,
        });
      }
    }
    return { month, events: events.sort((a, b) => ms(a.starts_at) - ms(b.starts_at)) };
  }

  function providerFields(body, kind) {
    if (kind === 'external' && (body.job_title || body.shift)) throw new MockError(422, 'invalid_provider', 'Função e turno valem apenas para funcionários');
    if (kind === 'employee' && (body.document || body.contract_type)) throw new MockError(422, 'invalid_provider', 'Documento e contrato valem apenas para prestadores externos');
    if (body.contract_valid_until && !['monthly', 'semiannual_annual'].includes(body.contract_type)) {
      throw new MockError(422, 'invalid_provider', 'Validade de contrato exige contrato mensal ou semestral/anual');
    }
    if (body.document && db().providers.some((p) => p.document === body.document && p.id !== body.id)) {
      throw new MockError(409, 'duplicate_document', 'Já existe um prestador com este CNPJ/CPF');
    }
  }

  function preventiveCheck(r) {
    if (r.trigger_type === 'recurring' && (!r.frequency || !r.first_run_date)) throw new MockError(422, 'invalid_rule', 'Regra recorrente exige frequência e primeira data');
    if (r.trigger_type === 'event' && (!r.trigger_event || !r.execution_window)) throw new MockError(422, 'invalid_rule', 'Regra por evento exige evento e prazo de execução');
    if (r.is_active && !r.default_provider_id) throw new MockError(422, 'provider_required', 'Regra ativa exige um responsável');
    r.run_time = r.run_time ? `${r.run_time.slice(0, 5)}:00` : r.trigger_type === 'recurring' ? '08:00:00' : null;
    r.next_run_at = r.trigger_type === 'recurring' && r.is_active ? nextOccurrence(r, Date.now()) : null;
  }

  const list = (v) => (v === undefined || v === null ? [] : [].concat(v));

  // ------------------------------------------------------------ rotas

  return [
    ['GET', /^\/maintenance-types$/, ({ query }) => db().maintenanceTypes.filter((t) => query.active == null || String(t.is_active) === String(query.active))],
    ['GET', /^\/maintenance-locations$/, ({ query }) => db().maintenanceLocations.filter((l) => query.active == null || String(l.is_active) === String(query.active))],

    ['GET', /^\/incidents$/, ({ query, userId }) => {
      let rows = db().incidents;
      if (String(query.mine) === 'true') rows = rows.filter((i) => i.requested_by === requireUser(userId));
      if (String(query.open) === 'true') rows = rows.filter((i) => OPEN.includes(i.status));
      if (String(query.open) === 'false') rows = rows.filter((i) => !OPEN.includes(i.status));
      if (query.status) rows = rows.filter((i) => list(query.status).includes(i.status));
      if (query.priority || String(query.without_priority) === 'true') {
        rows = rows.filter((i) => list(query.priority).includes(i.priority) || (String(query.without_priority) === 'true' && !i.priority));
      }
      if (query.origin) rows = rows.filter((i) => list(query.origin).includes(i.origin));
      if (query.location_id) rows = rows.filter((i) => i.location_id === query.location_id);
      if (query.maintenance_type_id) rows = rows.filter((i) => i.maintenance_type_id === query.maintenance_type_id);
      if (query.provider_id) rows = rows.filter((i) => i.assigned_provider_id === query.provider_id);
      return [...rows].sort((a, b) => ms(b.created_at) - ms(a.created_at)).slice(0, Number(query.limit) || 200).map(out);
    }],
    ['GET', /^\/incidents\/summary$/, () => {
      const by = { submitted: 0, under_review: 0, approved: 0, in_progress: 0, done: 0, rejected: 0 };
      const prio = { high: 0, medium: 0, low: 0, none: 0 };
      const monthStart = `${todayIso().slice(0, 7)}-01`;
      let doneMonth = 0;
      for (const i of db().incidents) {
        by[i.status] += 1;
        if (OPEN.includes(i.status)) prio[i.priority || 'none'] += 1;
        if (i.status === 'done' && i.finished_at.slice(0, 10) >= monthStart) doneMonth += 1;
      }
      return { by_status: by, awaiting_decision: by.submitted + by.under_review, open_by_priority: prio, done_this_month: doneMonth };
    }],
    ['POST', /^\/incidents$/, ({ body, userId }) => {
      requireUser(userId);
      checkCatalog(body.location_id, body.maintenance_type_id);
      if (!member(userId).units.some((u) => u.id === body.unit_id)) throw new MockError(422, 'unit_not_linked', 'Você não está vinculado a esta unidade');
      if (!body.title?.trim()) throw new MockError(422, 'validation_error', 'Informe o título');
      const i = newIncident({
        title: body.title.trim(), description: body.description || null, location_id: body.location_id,
        maintenance_type_id: body.maintenance_type_id, origin: 'resident', requested_by: userId, unit_id: body.unit_id, status: 'submitted',
      });
      i.attachments = (body.photo_urls || []).map((url) => ({ id: uuid(), file_url: url, created_at: nowIso() }));
      notify(managers(), 'incident_submitted', `Nova solicitação ${i.code}: ${i.title}`, null, i.id);
      return detail(i);
    }],
    ['POST', /^\/incidents\/scheduled$/, ({ body, userId }) => {
      requireUser(userId);
      checkCatalog(body.location_id, body.maintenance_type_id);
      getProvider(body.assigned_provider_id);
      if (body.scheduled_start_at && body.scheduled_end_at && ms(body.scheduled_end_at) <= ms(body.scheduled_start_at)) {
        throw new MockError(422, 'invalid_schedule', 'O fim da visita deve ser depois do início');
      }
      return detail(newIncident({
        title: body.title.trim(), description: body.description || null, location_id: body.location_id, maintenance_type_id: body.maintenance_type_id,
        origin: 'manual', status: 'approved', priority: body.priority, assigned_provider_id: body.assigned_provider_id,
        scheduled_start_at: body.scheduled_start_at || null, scheduled_end_at: body.scheduled_end_at || null,
        reviewed_by: userId, reviewed_at: nowIso(), note: 'Manutenção agendada pelo síndico.',
      }));
    }],
    ['GET', /^\/incidents\/([\w-]+)$/, ({ m }) => detail(getIncident(m[1]))],
    ['POST', /^\/incidents\/([\w-]+)\/review$/, ({ m, userId }) => {
      const i = getIncident(m[1]);
      transition(i, 'under_review', null, userId);
      return detail(i);
    }],
    ['POST', /^\/incidents\/([\w-]+)\/approve$/, ({ m, body, userId }) => {
      const i = getIncident(m[1]);
      const p = getProvider(body.assigned_provider_id);
      if (body.scheduled_start_at && body.scheduled_end_at && ms(body.scheduled_end_at) <= ms(body.scheduled_start_at)) {
        throw new MockError(422, 'invalid_schedule', 'O fim da visita deve ser depois do início');
      }
      const note = body.note || `Prioridade ${PRIORITY_LABEL[body.priority]}. Responsável: ${p.name}.`;
      transition(i, 'approved', note, requireUser(userId));
      Object.assign(i, {
        priority: body.priority, assigned_provider_id: p.id, scheduled_start_at: body.scheduled_start_at || null,
        scheduled_end_at: body.scheduled_end_at || null, reviewed_by: userId, reviewed_at: nowIso(),
        due_at: plusHours(nowIso(), PRIORITY_HOURS[body.priority]),
      });
      notify([i.requested_by], 'incident_approved', `Solicitação ${i.code} aprovada`, note, i.id);
      return detail(i);
    }],
    ['POST', /^\/incidents\/([\w-]+)\/reject$/, ({ m, body, userId }) => {
      const i = getIncident(m[1]);
      if (!body.note?.trim()) throw new MockError(422, 'rejection_incomplete', 'Recusar exige motivo e justificativa');
      if (body.related_incident_id) {
        const rel = getIncident(body.related_incident_id);
        if (rel.location_id !== i.location_id || rel.id === i.id) {
          throw new MockError(422, 'invalid_related_incident', 'A manutenção relacionada deve ser de outro registro no mesmo local');
        }
      } else if (body.reason === 'already_scheduled') {
        throw new MockError(422, 'related_incident_required', 'Informe a manutenção já agendada');
      }
      transition(i, 'rejected', body.note, requireUser(userId));
      Object.assign(i, {
        rejection_reason: body.reason, rejection_note: body.note, related_incident_id: body.related_incident_id || null,
        reviewed_by: userId, reviewed_at: nowIso(),
      });
      notify([i.requested_by], 'incident_rejected', `Solicitação ${i.code} recusada`, body.note, i.id);
      return detail(i);
    }],
    ['POST', /^\/incidents\/([\w-]+)\/start$/, ({ m, userId }) => {
      const i = getIncident(m[1]);
      transition(i, 'in_progress', null, userId);
      i.started_at = nowIso();
      notify([i.requested_by], 'incident_in_progress', `Manutenção ${i.code} em execução`, null, i.id);
      return detail(i);
    }],
    ['POST', /^\/incidents\/([\w-]+)\/finish$/, ({ m, body, userId }) => {
      const i = getIncident(m[1]);
      transition(i, 'done', null, userId);
      i.finished_at = nowIso();
      i.cost = body?.cost ?? null;
      notify([i.requested_by], 'incident_done', `Manutenção ${i.code} concluída`, null, i.id);
      return detail(i);
    }],
    ['POST', /^\/incidents\/([\w-]+)\/rating$/, ({ m, body }) => {
      const i = getIncident(m[1]);
      if (i.status !== 'done') throw new MockError(409, 'not_done', 'Só é possível avaliar uma manutenção concluída');
      Object.assign(i, { resident_rating: body.rating, resident_feedback: body.feedback || null, rated_at: nowIso() });
      return detail(i);
    }],

    ['GET', /^\/maintenance-history\/groups$/, ({ query }) => {
      const byLoc = query.by !== 'type';
      const groups = new Map();
      for (const i of doneInPeriod(query)) {
        const id = byLoc ? i.location_id : i.maintenance_type_id;
        const g = groups.get(id) || { id, name: ref(byLoc ? 'maintenanceLocations' : 'maintenanceTypes', id).name, count: 0, last_finished_at: null };
        g.count += 1;
        if (!g.last_finished_at || ms(i.finished_at) > ms(g.last_finished_at)) g.last_finished_at = i.finished_at;
        groups.set(id, g);
      }
      return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
    }],
    ['GET', /^\/maintenance-history$/, ({ query }) => {
      const records = doneInPeriod(query)
        .filter((i) => (!query.location_id || i.location_id === query.location_id) && (!query.maintenance_type_id || i.maintenance_type_id === query.maintenance_type_id))
        .sort((a, b) => ms(b.finished_at) - ms(a.finished_at))
        .map((i) => {
          const p = db().providers.find((x) => x.id === i.assigned_provider_id);
          return {
            id: i.id, code: i.code, title: i.title, finished_at: i.finished_at, origin: i.origin,
            location: ref('maintenanceLocations', i.location_id), maintenance_type: ref('maintenanceTypes', i.maintenance_type_id),
            provider: p ? { id: p.id, name: p.name } : null, provider_kind: p?.kind || null, provider_contract_type: p?.contract_type || null, cost: i.cost,
          };
        });
      const byOrigin = { resident: 0, manual: 0, preventive: 0 };
      records.forEach((r) => { byOrigin[r.origin] += 1; });
      return { total: records.length, by_origin: byOrigin, last: records[0] || null, records };
    }],

    ['GET', /^\/service-providers$/, ({ query }) => db().providers
      .filter((p) => (!query.kind || p.kind === query.kind)
        && (query.active == null || String(p.is_active) === String(query.active))
        && (!query.maintenance_type_id || p.specialty_ids.includes(query.maintenance_type_id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map(providerOut)],
    ['POST', /^\/service-providers$/, ({ body }) => {
      if (!body.name?.trim()) throw new MockError(422, 'validation_error', 'Informe o nome');
      providerFields(body, body.kind);
      const p = {
        id: uuid(), kind: body.kind, name: body.name.trim(), document: body.document || null, job_title: body.job_title || null,
        team_size: body.team_size || 1, phone: body.phone || null, contract_type: body.contract_type || null,
        contract_valid_until: body.contract_valid_until || null, shift: body.shift || null, is_active: body.is_active ?? true,
        created_at: nowIso(), specialty_ids: body.specialty_ids || [],
      };
      db().providers.push(p);
      return providerDetail(p);
    }],
    ['GET', /^\/service-providers\/([\w-]+)$/, ({ m }) => providerDetail(getProvider(m[1]))],
    ['PATCH', /^\/service-providers\/([\w-]+)$/, ({ m, body }) => {
      const p = getProvider(m[1]);
      const next = { ...p, ...body, id: p.id, kind: p.kind };
      providerFields(next, p.kind);
      Object.assign(p, next);
      return providerDetail(p);
    }],

    ['GET', /^\/preventive-maintenances$/, () => [...db().preventives]
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'pt-BR')).map(preventiveOut)],
    ['POST', /^\/preventive-maintenances$/, ({ body }) => {
      checkCatalog(body.location_id, body.maintenance_type_id);
      const r = {
        id: uuid(), description: null, frequency: null, first_run_date: null, run_time: null, trigger_event: null,
        execution_window: null, default_provider_id: null, reminder_days_before: 2, is_active: true, created_at: nowIso(), ...body,
      };
      preventiveCheck(r);
      db().preventives.push(r);
      return preventiveOut(r);
    }],
    ['GET', /^\/preventive-maintenances\/([\w-]+)$/, ({ m }) => preventiveOut(getRule(m[1]))],
    ['PATCH', /^\/preventive-maintenances\/([\w-]+)$/, ({ m, body }) => {
      const r = getRule(m[1]);
      const next = { ...r, ...body };
      preventiveCheck(next);
      Object.assign(r, next);
      return preventiveOut(r);
    }],
    ['GET', /^\/maintenance-calendar$/, ({ query }) => calendar(query.month)],
    ['POST', /^\/jobs\/preventive-maintenance\/run$/, () => runJob()],
  ];
}
