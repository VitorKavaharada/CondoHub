// Morador — abrir solicitação (NovaSolicitacao.dc.html)
import { api } from '../../api.js';
import { html } from '../../html.js';
import { icon } from '../../icons.js';
import { createScreen, errorHandlers, errorView, loadingView, spin, toast, topbar, wait } from '../../ui.js';

export default function maintenanceNew(root) {
  const screen = createScreen(root);
  let me = null;
  let locations = [];
  let types = [];
  const form = { location_id: '', title: '', maintenance_type_id: '', description: '', photo: '', unit_id: '' };
  let showPhoto = false;
  let showHint = false;
  let sending = false;
  let error = null;
  let created = null;

  async function load() {
    screen.paint(loadingView());
    try {
      [me, locations, types] = await Promise.all([api.me(), api.maintenanceLocations(), api.maintenanceTypes()]);
      form.unit_id = me.units[0]?.id || '';
      paint();
    } catch (err) {
      screen.paint(errorView(err, { back: '#/manutencao' }));
    }
  }

  const valid = () => form.location_id && form.title.trim() && form.maintenance_type_id;

  function formView() {
    const noUnit = !me.units.length;
    return html`
      ${topbar({ back: '#/manutencao', title: 'Nova solicitação' })}
      <p class="lede" style="margin:0">Conte o que aconteceu. O síndico recebe na hora.</p>
      <main class="content" style="gap:14px">
        ${noUnit ? html`<div class="notice notice--warn">${icon('alert', 18)}<div>Seu usuário não está vinculado a uma unidade, por isso não pode abrir solicitações. Troque de usuário em Perfil.</div></div>` : ''}
        <div class="card panel">
          <div class="field">
            <label for="m-local">Local</label>
            <select id="m-local" class="input" name="location_id">
              <option value="">Selecione o local</option>
              ${locations.map((l) => html`<option value="${l.id}" ${l.id === form.location_id ? 'selected' : ''}>${l.name}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="m-title">Título</label>
            <input id="m-title" class="input" name="title" value="${form.title}" placeholder="Ex.: Vazamento no teto" maxlength="120" autocomplete="off">
          </div>
          <div class="field">
            <span class="field__label" id="m-type-label">Tipo de manutenção</span>
            <div class="chips" role="group" aria-labelledby="m-type-label">
              ${types.map((t) => html`
                <button type="button" class="chip" data-action="type" data-id="${t.id}" data-focus-key="type-${t.id}" aria-pressed="${t.id === form.maintenance_type_id ? 'true' : 'false'}">${t.name}</button>`)}
            </div>
          </div>
          <div class="field">
            <label for="m-desc">Descrição</label>
            <textarea id="m-desc" class="textarea" name="description" rows="4" placeholder="Descreva o problema, desde quando acontece e se há risco.">${form.description}</textarea>
          </div>
          ${showPhoto
            ? html`
              <div class="field">
                <label for="m-photo">Endereço da foto</label>
                <input id="m-photo" class="input" name="photo" value="${form.photo}" inputmode="url" placeholder="https://…" autocomplete="off">
                <span class="hint">O envio de arquivos fica fora da POC: informe o endereço de uma foto já armazenada.</span>
              </div>`
            : html`<button type="button" class="btn btn--ghost" data-action="photo" style="border-style:dashed">${icon('plus', 18, 2.2)} Adicionar foto (opcional)</button>`}
        </div>
        ${showHint && !valid() ? html`<div class="form-error" role="alert">Preencha local, título e tipo para enviar.</div>` : ''}
        ${error ? html`<div class="notice notice--danger" role="alert">${icon('alert', 18)}<div>${error}</div></div>` : ''}
      </main>
      <footer class="footer">
        <button type="button" class="btn btn--primary" data-action="submit" ${sending || noUnit ? 'disabled' : ''}>${sending ? html`${spin()} Enviando…` : 'Enviar solicitação'}</button>
      </footer>`;
  }

  function sentView() {
    return html`
      <div class="result">
        <div class="result__badge">${icon('check', 36, 2.4)}</div>
        <h1 class="result__title" style="margin:0">Solicitação enviada</h1>
        <div class="result__text">Protocolo <strong>${created.code}</strong>. Você será avisado quando o síndico analisar o pedido.</div>
        <div class="card kv">
          <div><span>Tipo e local</span><span>${created.maintenance_type.name} · ${created.location.name}</span></div>
          <div><span>Título</span><span>${created.title}</span></div>
          <div><span>Status</span><span>Enviado</span></div>
        </div>
      </div>
      <footer class="footer footer--plain">
        <a class="btn btn--primary" href="#/manutencao/${created.id}">Acompanhar status</a>
        <a class="btn btn--text" href="#/manutencao?nova=${created.id}">Ver minhas manutenções</a>
      </footer>`;
  }

  function paint() {
    screen.paint(created ? sentView() : formView());
  }

  screen.on({
    ...errorHandlers(load),
    type: (d) => {
      form.maintenance_type_id = d.id;
      paint();
    },
    photo: () => {
      showPhoto = true;
      paint();
      screen.el.querySelector('#m-photo')?.focus();
    },
    submit: async () => {
      if (!valid()) {
        showHint = true;
        return paint();
      }
      sending = true;
      error = null;
      paint();
      try {
        const [res] = await Promise.all([
          api.createIncident({
            title: form.title.trim(),
            description: form.description.trim() || null,
            location_id: form.location_id,
            maintenance_type_id: form.maintenance_type_id,
            unit_id: form.unit_id,
            photo_urls: form.photo.trim() ? [form.photo.trim()] : [],
          }),
          wait(500),
        ]);
        created = res;
        toast.success(`Solicitação ${res.code} registrada`);
      } catch (err) {
        error = err.code === 'network_error' || err.code === 'timeout'
          ? `${err.message} Seus dados continuam preenchidos.`
          : err.message;
        toast.error('Não foi possível enviar a solicitação');
      }
      sending = false;
      if (screen.alive()) paint();
    },
  });

  const sync = (e) => {
    if (e.target.name in form) form[e.target.name] = e.target.value;
  };
  screen.el.addEventListener('input', sync);
  screen.el.addEventListener('change', sync);
  load();
}
