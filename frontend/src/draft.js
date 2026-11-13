// Rascunho da reserva em andamento (área → data/horário → regras → confirmação).
// Fica no sessionStorage para sobreviver a um recarregamento da página.

const KEY = 'condohub.draft';

export function getDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function setDraft(patch) {
  const next = { ...(getDraft() || {}), ...patch };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sem armazenamento: o fluxo segue enquanto a página não recarregar */
  }
  memory = next;
  return next;
}

export function clearDraft() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignorado */
  }
}

let memory = null;
export const currentDraft = () => getDraft() || memory;

/** Começa um rascunho novo para a área escolhida. */
export function startDraft(space) {
  clearDraft();
  return setDraft({ spaceId: space.id, spaceName: space.name, spaceIcon: space.icon, mode: space.booking_mode });
}
