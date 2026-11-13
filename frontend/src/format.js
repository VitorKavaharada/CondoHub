// Datas e textos em pt-BR, sempre no fuso do condomínio (não no do navegador).

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

let tz = 'America/Sao_Paulo';
export function setTimezone(value) {
  if (value) tz = value;
}

const pad = (n) => String(n).padStart(2, '0');

/** Data (YYYY-MM-DD) de um instante no fuso do condomínio. */
export function isoDateOf(instant) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(instant));
}
export const todayIso = () => isoDateOf(Date.now());
export const monthOf = (iso) => iso.slice(0, 7);

export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}

/** Dia da semana (0 = domingo) de uma data YYYY-MM-DD. */
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dateLabel(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]}`;
}

export function dateLongLabel(iso) {
  return `${WEEKDAYS[weekdayOf(iso)]}, ${dateLabel(iso)}`;
}

/** "14:00" a partir de um instante ISO. */
export function timeOf(instant) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(instant));
}

/** "07:00:00" → "07:00" */
export const hhmm = (t) => (t ? t.slice(0, 5) : '');
/** "07:00:00" → "07h", "07:30:00" → "07h30" */
export function hourLabel(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  return m === '00' ? `${h}h` : `${h}h${m}`;
}

export function durationLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

export function fileSizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function dateTimeLabel(instant) {
  return `${dateLabel(isoDateOf(instant))}, ${timeOf(instant)}`;
}

/** Data e horário de uma reserva como a tela mostra. */
export function reservationWhen(r) {
  const date = dateLabel(isoDateOf(r.start_datetime));
  const time = r.booking_mode === 'full_day' ? 'Dia todo' : `${timeOf(r.start_datetime)} – ${timeOf(r.end_datetime)}`;
  return { date, time, short: r.booking_mode === 'full_day' ? `${date} · Dia todo` : `${date} · ${timeOf(r.start_datetime)}` };
}

export function spaceScheduleLabel(space) {
  if (space.booking_mode === 'full_day') return 'Dia todo';
  return `${hourLabel(space.opens_at)} às ${hourLabel(space.closes_at)}`;
}

export const STATUS = {
  pending: { label: 'Pendente', tone: 'warn' },
  confirmed: { label: 'Confirmada', tone: 'accent' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
  rejected: { label: 'Recusada', tone: 'danger' },
};

export const ROLE_LABEL = {
  resident: 'Morador(a)',
  manager: 'Síndico(a)',
  admin: 'Administração',
  doorman: 'Portaria',
  technician: 'Técnico(a)',
};

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export const firstName = (name) => (name || '').split(/\s+/)[0];

// ---------------------------------------------------------------- manutenção

export const INCIDENT_STATUS = {
  submitted: { label: 'Enviado', tone: 'warn', staff: 'Nova' },
  under_review: { label: 'Em análise', tone: 'warn', staff: 'Em análise' },
  approved: { label: 'Aprovado', tone: 'accent', staff: 'Aprovada' },
  in_progress: { label: 'Em execução', tone: 'info', staff: 'Em execução' },
  done: { label: 'Concluído', tone: 'neutral', staff: 'Concluída' },
  rejected: { label: 'Recusado', tone: 'danger', staff: 'Recusada' },
};
export const INCIDENT_STEPS = ['submitted', 'under_review', 'approved', 'in_progress', 'done'];
export const OPEN_INCIDENT = ['submitted', 'under_review', 'approved', 'in_progress'];

export const PRIORITY = {
  high: { label: 'Alta', sla: 'até 48 h', tone: 'danger' },
  medium: { label: 'Média', sla: 'até 5 dias', tone: 'warn' },
  low: { label: 'Baixa', sla: 'até 15 dias', tone: 'accent' },
};

export const REJECTION = {
  already_scheduled: 'Já existe manutenção agendada para este local',
  already_done: 'O serviço já foi realizado',
  provider_already_requested: 'O prestador já foi acionado',
  unit_responsibility: 'É responsabilidade da unidade',
  other: 'Outro motivo',
};

export const ORIGIN = { resident: 'Morador', manual: 'Síndico', preventive: 'Preventiva' };
export const PROVIDER_KIND = { external: 'Prestador externo', employee: 'Funcionário' };
export const CONTRACT = { on_demand: 'Sob demanda', monthly: 'Mensal', semiannual_annual: 'Semestral/anual' };
export const SHIFT = { morning: 'Manhã', afternoon: 'Tarde', business_hours: 'Horário comercial' };
export const FREQUENCY = { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual' };
export const PREVENTIVE_EVENT = { reservation_ended: 'Fim de reserva', reservation_canceled: 'Reserva cancelada', move_completed: 'Mudança concluída' };
export const WINDOW = { within_2h: 'em até 2 horas', within_4h: 'em até 4 horas', next_day_10am: 'no dia seguinte, 10h' };

/** "09/10 · 08:41" */
export function shortDateTime(instant) {
  const iso = isoDateOf(instant);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} · ${timeOf(instant)}`;
}
/** "09/10/2026" */
export function shortDate(isoOrInstant) {
  const iso = isoOrInstant.length === 10 ? isoOrInstant : isoDateOf(isoOrInstant);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Horário de uma visita: "13/10, 9h–12h" */
export function visitLabel(start, end) {
  if (!start) return null;
  const date = isoDateOf(start);
  const h = (i) => hourLabel(`${timeOf(i)}:00`);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}, ${h(start)}${end ? `–${h(end)}` : ''}`;
}

/** Data/hora local (YYYY-MM-DD + HH:MM) → ISO com o fuso do condomínio. */
export function localToIso(date, time) {
  if (!date) return null;
  const probe = new Date(`${date}T12:00:00Z`);
  const local = new Date(probe.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMin = Math.round((local - utc) / 60000);
  const sign = offsetMin <= 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${date}T${time || '08:00'}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
