// Admin — editar área e regras (AdminEditarArea.dc.html). Também cadastra área nova (#/admin/areas/nova).
import { api, fileHref } from '../api.js';
import { html } from '../html.js';
import { SPACE_ICONS, icon } from '../icons.js';
import { dateTimeLabel, durationLabel, fileSizeLabel, hhmm } from '../format.js';
import { createScreen, errorHandlers, errorView, loadingView, switchButton, toast, topbar, spin } from '../ui.js';
import { staffOnly } from './admin-areas.js';

const DURATIONS = [60, 120, 180, 240];

function toForm(space) {
  return {
    name: space?.name || '',
    description: space?.description || '',
    capacity: space?.capacity ?? '',
    icon: space?.icon || 'sparkle',
    is_active: space?.is_active ?? true,
    booking_mode: space?.booking_mode || 'hourly',
    opens_at: hhmm(space?.opens_at) || '08:00',
    closes_at: hhmm(space?.closes_at) || '22:00',
    slot_minutes: space?.slot_minutes || 120,
    max_per_unit: space?.max_per_unit ?? 3,
    booking_horizon_days: space?.booking_horizon_days ?? 90,
    requires_terms: space?.requires_terms ?? true,
  };
}

function toPayload(f) {
  const hourly = f.booking_mode === 'hourly';
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    capacity: f.capacity === '' ? null : Number(f.capacity),
    icon: f.icon,
    is_active: f.is_active,
    booking_mode: f.booking_mode,
    opens_at: hourly ? f.opens_at : null,
    closes_at: hourly ? f.closes_at : null,
    slot_minutes: hourly ? Number(f.slot_minutes) : null,
    max_per_unit: Number(f.max_per_unit),
    booking_horizon_days: Number(f.booking_horizon_days),
    requires_terms: f.requires_terms,
  };
}

function validate(f) {
  if (!f.name.trim()) return 'Informe o nome da área';
  if (f.booking_mode === 'hourly') {
    if (!f.opens_at || !f.closes_at) return 'Informe a abertura e o fechamento';
    if (f.closes_at <= f.opens_at) return 'O fechamento deve ser depois da abertura';
  }
  if (f.capacity !== '' && Number(f.capacity) <= 0) return 'A capacidade deve ser maior que zero';
  if (!(Number(f.booking_horizon_days) > 0)) return 'A antecedência máxima deve ser maior que zero';
  return null;
}

export default function adminEditArea(root, { params: [id] }) {
  const screen = createScreen(root);
  const isNew = id === 'nova';
  let space = null;
  let form = toForm(null);
  let doc = { open: false, file_url: '', file_size_bytes: '', summary: '' };
  let saving = false;
  let error = null;

  async function load() {
    screen.paint(loadingView());
    try {
      const me = await api.me();
      const denied = staffOnly(me);
      if (denied) return screen.paint(denied);
      if (!isNew) {
        space = await api.space(id);
        form = toForm(space);
        doc.summary = space.rules_document?.summary || '';
      }
      paint();
    } catch (err) {
      screen.paint(errorView(err, { back: '#/admin/areas' }));
    }
  }

  function switchRow(key, label, hint) {
    return html`
      <div class="switch-row">
        <div>
          <div class="switch-row__label">${label}</div>
          ${hint ? html`<div class="switch-row__hint">${hint}</div>` : ''}
        </div>
        ${switchButton({ action: `toggle-${key}`, checked: form[key], label })}
      </div>`;
  }

  function rulesPanel() {
    if (isNew) {
      return html`<div class="hint">Depois de cadastrar a área, publique aqui o regulamento em PDF.</div>`;
    }
    const current = space.rules_document;
    return html`
      ${current
        ? html`
          <a class="row-link" href="${fileHref(current.file_url)}" target="_blank" rel="noopener" style="padding:12px">
            <span class="tile-icon tile-icon--sm">${icon('file', 18)}</span>
            <span class="row-link__body">
              <span class="row-link__title" style="display:block">Regulamento em PDF · versão ${current.version}</span>
              <span class="row-link__sub" style="display:block">Publicado em ${dateTimeLabel(current.published_at)}${current.file_size_bytes ? ` · ${fileSizeLabel(current.file_size_bytes)}` : ''}</span>
            </span>
            <span class="chev">${icon('download', 18)}</span>
          </a>`
        : html`<div class="notice notice--warn">${icon('alert', 18)}<div>Nenhum regulamento publicado.${form.requires_terms ? ' Sem ele, ninguém consegue reservar esta área.' : ''}</div></div>`}
      ${doc.open
        ? html`
          <div class="field">
            <label for="doc-url">Endereço do PDF</label>
            <input id="doc-url" class="input" name="doc.file_url" value="${doc.file_url}" placeholder="https://… ou /files/regulamento.pdf" autocomplete="off">
            <span class="hint">O envio de arquivos fica fora da POC: informe o endereço do PDF já armazenado.</span>
          </div>
          <div class="field">
            <label for="doc-size">Tamanho em bytes (opcional)</label>
            <input id="doc-size" class="input" name="doc.file_size_bytes" value="${doc.file_size_bytes}" inputmode="numeric">
          </div>
          <div class="field">
            <label for="doc-summary">Resumo das regras (uma por linha)</label>
            <textarea id="doc-summary" class="textarea" name="doc.summary">${doc.summary}</textarea>
          </div>
          <button type="button" class="btn btn--primary" data-action="publish" ${saving ? 'disabled' : ''}>Publicar nova versão</button>
          <button type="button" class="btn btn--text" data-action="toggle-doc">Cancelar</button>`
        : html`<button type="button" class="btn btn--ghost" data-action="toggle-doc">${icon('file', 18)} ${current ? 'Substituir regulamento' : 'Publicar regulamento'}</button>`}`;
  }

  function paint() {
    const hourly = form.booking_mode === 'hourly';
    screen.paint(html`
      ${topbar({
        back: '#/admin/areas',
        title: isNew ? 'Nova área' : space.name,
        subtitle: 'Horários e regras',
        right: html`<span class="tag tag--accent">Admin</span>`,
      })}
      <main class="content" style="padding-top:14px;gap:14px">
        <section class="card panel">
          <h2 class="panel__title" style="margin:0">Identificação</h2>
          <div class="field">
            <label for="f-name">Nome</label>
            <input id="f-name" class="input" name="name" value="${form.name}" autocomplete="off" required>
          </div>
          <div class="field">
            <label for="f-desc">Descrição curta</label>
            <input id="f-desc" class="input" name="description" value="${form.description}" placeholder="Ex.: Até 30 pessoas · dia todo" autocomplete="off">
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="f-cap">Capacidade (pessoas)</label>
              <input id="f-cap" class="input" name="capacity" type="number" min="1" value="${form.capacity}">
            </div>
            <div class="field">
              <label for="f-horizon">Antecedência máx. (dias)</label>
              <input id="f-horizon" class="input" name="booking_horizon_days" type="number" min="1" value="${form.booking_horizon_days}">
            </div>
          </div>
          <div class="field">
            <span class="field__label">Ícone</span>
            <div class="chips" role="group" aria-label="Ícone da área">
              ${SPACE_ICONS.map((name) => html`
                <button type="button" class="chip" data-action="icon" data-icon="${name}" data-focus-key="icon-${name}" aria-pressed="${form.icon === name ? 'true' : 'false'}" aria-label="Ícone ${name}">${icon(name, 18)}</button>`)}
            </div>
          </div>
        </section>

        <section class="card panel">
          <h2 class="panel__title" style="margin:0">Disponibilidade</h2>
          ${switchRow('is_active', 'Área ativa para reserva', 'Desligada, a área some da lista dos moradores.')}
          <div class="segmented" role="group" aria-label="Modo de reserva">
            <button type="button" data-action="mode" data-mode="full_day" data-focus-key="mode-full" aria-pressed="${!hourly ? 'true' : 'false'}">Dia todo</button>
            <button type="button" data-action="mode" data-mode="hourly" data-focus-key="mode-hourly" aria-pressed="${hourly ? 'true' : 'false'}">Por horário</button>
          </div>
          ${hourly
            ? html`
              <div class="grid-2">
                <div class="field">
                  <label for="f-open">Abre às</label>
                  <input id="f-open" class="input" name="opens_at" type="time" value="${form.opens_at}">
                </div>
                <div class="field">
                  <label for="f-close">Fecha às</label>
                  <input id="f-close" class="input" name="closes_at" type="time" value="${form.closes_at}">
                </div>
              </div>
              <div class="field">
                <span class="field__label">Duração de cada reserva</span>
                <div class="chips" role="group" aria-label="Duração de cada reserva">
                  ${DURATIONS.map((m) => html`
                    <button type="button" class="chip" data-action="duration" data-minutes="${m}" data-focus-key="dur-${m}" aria-pressed="${Number(form.slot_minutes) === m ? 'true' : 'false'}">${durationLabel(m)}</button>`)}
                </div>
              </div>`
            : ''}
        </section>

        <section class="card panel">
          <h2 class="panel__title" style="margin:0">Regras de reserva</h2>
          <div class="switch-row">
            <div>
              <div class="switch-row__label">Limite por unidade</div>
              <div class="switch-row__hint">Reservas futuras ativas nesta área</div>
            </div>
            <div class="stepper">
              <button type="button" data-action="limit" data-delta="-1" data-focus-key="lim-dec" aria-label="Diminuir limite" ${form.max_per_unit <= 1 ? 'disabled' : ''}>−</button>
              <output aria-live="polite">${form.max_per_unit}</output>
              <button type="button" data-action="limit" data-delta="1" data-focus-key="lim-inc" aria-label="Aumentar limite" ${form.max_per_unit >= 10 ? 'disabled' : ''}>+</button>
            </div>
          </div>
          ${switchRow('requires_terms', 'Exigir aceite das regras', 'O morador lê e aceita o regulamento antes de reservar.')}
          <div class="notice" style="margin:0">${icon('info', 18)}<div>Unidades inadimplentes não reservam nenhuma área. A regra vale para todo o condomínio e não depende desta configuração.</div></div>
        </section>

        <section class="card panel">
          <h2 class="panel__title" style="margin:0">Regulamento</h2>
          ${rulesPanel()}
        </section>

        ${error ? html`<div class="notice notice--danger" role="alert">${icon('alert', 18)}<div>${error}</div></div>` : ''}
      </main>
      <footer class="footer">
        <button type="button" class="btn btn--primary" data-action="save" ${saving ? 'disabled' : ''}>${saving ? html`${spin()} Salvando…` : isNew ? 'Cadastrar área' : 'Salvar alterações'}</button>
        <a class="btn btn--text" href="#/admin/areas">Descartar</a>
      </footer>`);
  }

  const toggle = (key) => () => {
    form[key] = !form[key];
    paint();
  };

  screen.on({
    ...errorHandlers(load),
    'toggle-is_active': toggle('is_active'),
    'toggle-requires_terms': toggle('requires_terms'),
    'toggle-doc': () => {
      doc.open = !doc.open;
      paint();
    },
    icon: (d) => {
      form.icon = d.icon;
      paint();
    },
    mode: (d) => {
      form.booking_mode = d.mode;
      paint();
    },
    duration: (d) => {
      form.slot_minutes = Number(d.minutes);
      paint();
    },
    limit: (d) => {
      form.max_per_unit = Math.min(10, Math.max(1, form.max_per_unit + Number(d.delta)));
      paint();
    },
    save: async () => {
      error = validate(form);
      if (error) return paint();
      saving = true;
      paint();
      try {
        if (isNew) {
          const created = await api.createSpace(toPayload(form));
          toast.success('Área cadastrada');
          location.replace(`#/admin/areas/${created.id}`);
          return;
        }
        space = await api.updateSpace(space.id, toPayload(form));
        form = toForm(space);
        toast.success('Alterações salvas');
        location.hash = '#/admin/areas';
      } catch (err) {
        error = err.message;
      } finally {
        saving = false;
      }
      if (screen.alive()) paint();
    },
    publish: async () => {
      if (!doc.file_url.trim()) {
        error = 'Informe o endereço do PDF';
        return paint();
      }
      saving = true;
      error = null;
      paint();
      try {
        await api.publishRules(space.id, {
          file_url: doc.file_url.trim(),
          file_size_bytes: doc.file_size_bytes ? Number(doc.file_size_bytes) : null,
          summary: doc.summary.trim() || null,
        });
        space = await api.space(space.id);
        doc = { open: false, file_url: '', file_size_bytes: '', summary: space.rules_document?.summary || '' };
        toast.success(`Regulamento versão ${space.rules_document.version} publicado`);
      } catch (err) {
        error = err.message;
      }
      saving = false;
      if (screen.alive()) paint();
    },
  });

  screen.el.addEventListener('input', (e) => {
    const name = e.target.name;
    if (!name) return;
    if (name.startsWith('doc.')) doc[name.slice(4)] = e.target.value;
    else form[name] = e.target.value;
  });
  load();
}
