/**
 * The overlay's "Not filled" section: fields the extension couldn't fill that
 * the user can teach. The user answers the field on the page, then clicks
 * "Teach this" (one row) or "Teach all" (every ticked row on show), and the
 * answer is remembered (see learned-store.ts).
 *
 * Only real clicks count (`isTrusted`): a page can't trigger teaching by
 * dispatching synthetic events.
 */

export interface TeachRow {
  fieldId: string;
  label: string;
  /** What to do, e.g. "Answer it on the page, then teach it." */
  hint: string;
}

export type TeachOutcome = { ok: boolean; message: string };

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

const VISIBLE_ROWS = 10;

interface RowView {
  row: TeachRow;
  li: HTMLLIElement;
  include: HTMLInputElement;
  button: HTMLButtonElement;
  status: HTMLSpanElement;
  taught: boolean;
  shown: boolean;
}

export function renderTeachSection(rows: readonly TeachRow[], onTeach: (fieldId: string) => Promise<TeachOutcome>, el: El): HTMLElement {
  const section = el('div', 'teach');
  const heading = el('div', 'teach-head');
  heading.append(el('h3', '', `Not filled: teach it once (${rows.length})`));
  const teachAll = el('button', 'action teach-all', 'Teach all');
  teachAll.type = 'button';
  heading.append(teachAll);
  const tally = el('p', 'teach-tally');
  tally.setAttribute('role', 'status');
  const list = el('ul');

  const views: RowView[] = rows.map((row) => renderRow(row, el));

  /** Teaches one row; shared by its own button and by "Teach all". */
  const teachOne = async (v: RowView): Promise<boolean> => {
    v.button.disabled = true;
    const { ok, message } = await onTeach(v.row.fieldId);
    v.status.textContent = message;
    v.li.classList.toggle('taught', ok);
    v.li.classList.toggle('teach-error', !ok);
    v.taught = ok;
    if (ok) {
      v.button.textContent = 'Learned ✓';
      v.include.checked = false;
      v.include.disabled = true;
    } else {
      v.button.disabled = false;
    }
    refresh();
    return ok;
  };

  // "Teach all" covers ticked rows the user can see; rows behind "Show more" join once shown.
  const selected = () => views.filter((v) => v.shown && !v.taught && v.include.checked);
  const refresh = () => {
    const n = selected().length;
    teachAll.textContent = n === views.filter((v) => v.shown && !v.taught).length ? 'Teach all' : `Teach ${n} selected`;
    teachAll.disabled = n === 0;
  };

  for (const v of views) {
    v.button.addEventListener('click', (e) => {
      if (e.isTrusted) void teachOne(v);
    });
    v.include.addEventListener('change', refresh);
  }

  teachAll.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    teachAll.disabled = true;
    void (async () => {
      let learned = 0;
      let waiting = 0;
      // One at a time: each answer is read from the page and saved in order.
      for (const v of selected()) {
        if (await teachOne(v)) learned++;
        else waiting++;
      }
      tally.textContent =
        `Learned ${learned}` + (waiting ? ` · ${waiting} need${waiting === 1 ? 's' : ''} an answer on the page first` : '') + '.';
      refresh();
    })();
  });

  const show = (vs: RowView[]) => {
    for (const v of vs) v.shown = true;
    list.append(...vs.map((v) => v.li));
    refresh();
  };
  show(views.slice(0, VISIBLE_ROWS));
  section.append(heading, tally, list);
  if (views.length > VISIBLE_ROWS) {
    const more = el('button', 'action more', `Show ${views.length - VISIBLE_ROWS} more`);
    more.type = 'button';
    more.addEventListener('click', () => {
      show(views.slice(VISIBLE_ROWS));
      more.remove();
    });
    section.append(more);
  }
  return section;
}

function renderRow(row: TeachRow, el: El): RowView {
  const li = el('li', 'teach-row');
  const include = el('input', 'teach-include');
  include.type = 'checkbox';
  include.checked = true;
  include.title = 'Include in Teach all';
  include.setAttribute('aria-label', `Include "${row.label}" in Teach all`);
  const status = el('span', 'teach-status', row.hint);
  status.setAttribute('role', 'status');
  const button = el('button', 'action teach-button', 'Teach this');
  button.type = 'button';
  li.append(include, el('span', 'label', row.label), button, status);
  return { row, li, include, button, status, taught: false, shown: false };
}
