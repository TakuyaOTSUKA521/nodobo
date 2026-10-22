import { esc } from '../lib/format.js';

// 2〜4択の排他切替(表示形式・収支/資産・累積/1日あたり・期間)。選択中はインク地+白字。
// `options` is [[value, label], ...]; a label is escaped unless `html` is set
// (icon segments pass SVG markup). The page re-renders on change, so the
// selected state only needs to be right at render time. `small` is the
// compact size for sitting in a form field's label row; `disabled` greys the
// whole group out (buttons can't be pressed) when the choice doesn't apply yet.
export function segmented(id, options, selected, { html = false, icon = false, small = false, disabled = false, ariaLabel = '' } = {}) {
  const buttons = options.map(([value, label, title]) => {
    const on = value === selected;
    return `<button type="button" class="seg-btn${on ? ' selected' : ''}" data-seg-value="${esc(value)}" aria-pressed="${on}"${disabled ? ' disabled' : ''}${title ? ` aria-label="${esc(title)}" title="${esc(title)}"` : ''}>${html ? label : esc(label)}</button>`;
  }).join('');
  return `<div class="segmented${icon ? ' segmented--icon' : ''}${small ? ' segmented--sm' : ''}" id="${id}" role="group"${disabled ? ' aria-disabled="true"' : ''}${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''}>${buttons}</div>`;
}

export function wireSegmented(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('selected')) return;
      onChange(btn.dataset.segValue);
    });
  });
}
