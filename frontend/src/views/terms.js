// Aceite das regras (Termos.dc.html)
import { api, fileHref } from '../api.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { currentDraft, setDraft } from '../draft.js';
import { dateLabel, fileSizeLabel } from '../format.js';
import { createScreen, errorHandlers, errorView, loadingView, topbar } from '../ui.js';
import { guardReservationFlow } from '../delinquency.js';

export default function terms(root, { params: [spaceId] }) {
  const screen = createScreen(root);
  const back = `#/reservar/${spaceId}`;
  let space = null;
  let me = null;
  let accepted = false;

  async function load() {
    const draft = currentDraft();
    if (!draft || draft.spaceId !== spaceId || !draft.date) {
      location.replace(`#/reservar/${spaceId}`);
      return;
    }
    screen.paint(loadingView());
    try {
      [space, me] = await Promise.all([api.space(spaceId), api.me()]);
      const doc = space.rules_document;
      accepted = Boolean(draft.accepted && doc && draft.rulesDocumentId === doc.id);
      paint();
      guardReservationFlow(me, draft.unitId || null);
    } catch (err) {
      screen.paint(errorView(err, { back }));
    }
  }

  function paint() {
    const doc = space.rules_document;
    const rules = (doc?.summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
    screen.paint(html`
      ${topbar({ back, title: 'Regras de uso', subtitle: space.name })}
      <p class="lede" style="margin:0">Aceite as regras do ${space.name} para seguir</p>
      <main class="content">
        ${doc
          ? html`
            <a class="card doc-link" href="${fileHref(doc.file_url)}" target="_blank" rel="noopener" aria-label="Baixar o regulamento completo em PDF">
              <span class="tile-icon">${icon('file', 20)}</span>
              <span style="flex:1">
                <span class="row-link__title" style="display:block">Regulamento completo</span>
                <span class="row-link__sub" style="display:block">PDF${doc.file_size_bytes ? ` · ${fileSizeLabel(doc.file_size_bytes)}` : ''} · versão ${doc.version}</span>
              </span>
              <span class="chev">${icon('download', 18)}</span>
            </a>
            ${rules.length
              ? html`
                <div class="card rules">
                  <h2 class="rules__title" style="margin-top:0">Resumo das regras</h2>
                  ${rules.map((r) => html`<div class="rules__item"><span aria-hidden="true">•</span><span>${r}</span></div>`)}
                </div>`
              : ''}
            <button type="button" class="check-row" role="checkbox" aria-checked="${accepted ? 'true' : 'false'}" data-action="toggle" data-focus-key="accept">
              <span class="checkbox">${accepted ? icon('check', 13, 3) : ''}</span>
              <span>Li e aceito o regulamento de uso das áreas comuns e assumo a responsabilidade por esta reserva.</span>
            </button>`
          : html`
            <div class="notice notice--warn">${icon('alert', 18)}<div>A administração ainda não publicou o regulamento desta área. A reserva só pode ser feita depois disso.</div></div>`}
      </main>
      <footer class="footer">
        <div class="footer-note">${dateLabel(currentDraft().date)} · <strong>${space.name}</strong></div>
        <button type="button" class="btn btn--primary" data-action="continue" ${accepted && doc ? '' : 'disabled'}>Continuar</button>
      </footer>`);
  }

  screen.on({
    ...errorHandlers(load),
    toggle: () => {
      accepted = !accepted;
      paint();
    },
    continue: () => {
      if (guardReservationFlow(me, currentDraft()?.unitId || null)) return;
      setDraft({ accepted: true, rulesDocumentId: space.rules_document.id });
      location.hash = '#/confirmar';
    },
  });
  load();
}
