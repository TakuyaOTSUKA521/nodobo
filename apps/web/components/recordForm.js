import { esc, todayISODate } from '../lib/format.js';
import { toggleChip, wireToggleChip, isToggleChipOn } from './toggleChip.js';
import { segmented } from './segmented.js';

// 記録フォームの部品。記録シート(新規)と取引の編集シートで共用する
// (views/recordSheet.js)。新規は renderNodePicker + renderLineFields、
// 編集は出どころ・行き先を文字で出して renderLineFields だけを使う。

// ------------------------------------------------------------
// 出どころ → 行き先 のスロットと、検索欄+候補チップ(新規のみ)
// ------------------------------------------------------------

export function renderNodePicker({ slot, fromNode, toNode, fromCandidates, suggestions }) {
  const isFromSlot = slot === 'from';
  const fromLabel = fromNode ? esc(fromNode.name) : '未選択';
  const toLabel = toNode ? esc((toNode.path ?? toNode.name ?? toNode.id).split(' > ').pop()) : '未選択';

  const chips = isFromSlot
    ? fromCandidates.map((n) => {
      const selected = fromNode?.id === n.id;
      return `<button type="button" class="chip${selected ? ' selected' : ''}" data-id="${n.id}" data-name="${esc(n.name)}" data-path="${esc(n.path ?? n.name)}">${esc(n.name)}</button>`;
    })
    : suggestions.map((s) => {
      const selected = toNode?.id === s.node_id;
      const name = (s.path ?? s.node_id).split(' > ').pop();
      return `<button type="button" class="chip${selected ? ' selected' : ''}" data-id="${s.node_id}" data-name="${esc(name)}" data-path="${esc(s.path ?? '')}">${esc(name)}</button>`;
    });

  return `
    <div class="slot-row rf-collapsible">
      <button type="button" class="slot-btn${isFromSlot ? ' active' : ''}" id="from-slot-btn">
        <span class="slot-label">出どころ</span>
        <span class="slot-value">${fromLabel}</span>
      </button>
      <div class="slot-arrow">→</div>
      <button type="button" class="slot-btn${isFromSlot ? '' : ' active'}" id="to-slot-btn">
        <span class="slot-label">行き先</span>
        <span class="slot-value">${toLabel}</span>
      </button>
    </div>

    <div class="candidate-box">
      <div class="rf-search-row">
        <input id="node-search" type="text" placeholder="${isFromSlot ? '出どころを検索' : '行き先を検索'}" autocomplete="off" enterkeyhint="search">
        <button type="button" id="node-search-cancel" class="rf-search-cancel">キャンセル</button>
      </div>
      <div class="search-results" id="search-results"></div>
      <div class="chip-row rf-collapsible" id="candidate-chips">${chips.join('')}</div>
    </div>
  `;
}

// `onSlot(slot)` / `onPick(node, { fromSearch })` / `onCreate(query)` are the
// sheet's handlers; `search(query)` returns the leaf nodes to list.
// `searchMode` is a CSS hook for phones: while the search box has focus the
// sheet collapses everything else and shows a few results above the keyboard.
export function wireNodePicker({ onSlot, onPick, onCreate, search, searchModeEl }) {
  document.getElementById('from-slot-btn').addEventListener('click', () => onSlot('from'));
  document.getElementById('to-slot-btn').addEventListener('click', () => onSlot('to'));

  document.querySelectorAll('#candidate-chips .chip').forEach((btn) => {
    btn.addEventListener('click', () => onPick({ id: btn.dataset.id, name: btn.dataset.name, path: btn.dataset.path }, { fromSearch: false }));
  });

  const input = document.getElementById('node-search');
  const resultsEl = document.getElementById('search-results');
  const phone = window.matchMedia('(max-width: 767px)');

  input.addEventListener('focus', () => {
    if (phone.matches) searchModeEl.classList.add('searching');
  });
  document.getElementById('node-search-cancel').addEventListener('click', () => {
    input.value = '';
    resultsEl.innerHTML = '';
    searchModeEl.classList.remove('searching');
    input.blur();
  });

  // Results can come back out of order while typing fast; only the latest
  // query's results are drawn.
  let latestQuery = '';
  input.addEventListener('input', async () => {
    const query = input.value.trim();
    latestQuery = query;
    if (!query) {
      resultsEl.innerHTML = '';
      return;
    }
    const results = await search(query);
    if (query !== latestQuery) return;
    resultsEl.innerHTML = `
      <div class="sr-items">${results.map((n) => `
        <div class="sr-item" data-id="${n.id}" data-path="${esc(n.path)}" data-name="${esc(n.name)}">
          <span class="sr-type" style="color:${n.typeColor};">${esc(n.typeLabel)}</span>${esc(n.path)}
        </div>`).join('')}
      </div>
      <div class="sr-create" id="sr-create">+「${esc(query)}」を新しいノードとして作成</div>
    `;
    resultsEl.querySelectorAll('.sr-item').forEach((el) => {
      el.addEventListener('click', () => onPick({ id: el.dataset.id, name: el.dataset.name, path: el.dataset.path }, { fromSearch: true }));
    });
    document.getElementById('sr-create').addEventListener('click', () => onCreate(query));
  });
}

// ------------------------------------------------------------
// 金額・日付・メモ・集計から除外(新規・編集の両方)
// ------------------------------------------------------------

function dateLabel(iso) {
  const today = todayISODate();
  if (iso === today) return '今日';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dt.toDateString() === yesterday.toDateString()) return '昨日';
  const wd = '日月火水木金土'[dt.getDay()];
  const yearPart = y === new Date().getFullYear() ? '' : `${y}年`;
  return `${yearPart}${m}月${d}日(${wd})`;
}

// `amountMode` ('spend' | 'after') adds the [使用額|使用後残高] segment to the
// 金額 label row (記録シート only - the edit sheet leaves it null). In 'after'
// the field holds the 出どころ's balance after this payment instead.
export function renderLineFields({ amount = '', occurredOn = todayISODate(), memo = '', excludeOn = false, excludeDisabled = false, amountMode = null, amountModeDisabled = false }) {
  const modeSegment = amountMode === null ? '' : segmented('amount-mode', [['spend', '使用額'], ['after', '使用後残高']], amountMode, { small: true, disabled: amountModeDisabled, ariaLabel: '金額の入力方法' });
  return `
    <div class="rf-amount-row rf-collapsible">
      <div class="field">
        <div class="rf-field-head"><label for="amount">金額</label>${modeSegment}</div>
        <input id="amount" class="mono rf-amount" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="${amountMode === 'after' ? '使用後の残高' : '0'}" value="${esc(String(amount))}" autocomplete="off">
      </div>
      <div class="field"><span class="rf-field-head">日付</span>
        <label class="rf-date-btn">
          <span id="occurred-on-label">${esc(dateLabel(occurredOn))}</span>
          <input id="occurred-on" type="date" value="${esc(occurredOn)}" aria-label="日付">
        </label>
      </div>
    </div>
    <label class="field rf-collapsible">メモ<input id="memo" type="text" placeholder="任意" value="${esc(memo ?? '')}"></label>
    <div class="rf-collapsible">${toggleChip('exclude-from-flow', '集計から除外', { on: excludeOn, disabled: excludeDisabled })}</div>
  `;
}

export function wireLineFields({ onDateChange } = {}) {
  const dateInput = document.getElementById('occurred-on');
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) dateInput.value = todayISODate();
    document.getElementById('occurred-on-label').textContent = dateLabel(dateInput.value);
    onDateChange?.();
  });
  // iOS opens the native picker when the (transparent) input itself is
  // tapped; desktop browsers need showPicker() for a click outside the icon.
  dateInput.addEventListener('click', () => {
    try { dateInput.showPicker?.(); } catch { /* already open, or unsupported */ }
  });
  wireToggleChip('exclude-from-flow');
}

// An empty 金額 reads as NaN (not 0), so a 使用後残高 of 0 can be told apart
// from nothing typed.
export function readLineFields() {
  const amountText = document.getElementById('amount').value.replace(/[,，\s]/g, '');
  return {
    amount: amountText === '' ? NaN : Number(amountText),
    occurredOn: document.getElementById('occurred-on').value,
    memo: document.getElementById('memo').value,
    excludeFromFlowTotals: isToggleChipOn('exclude-from-flow'),
  };
}

// The form's current values, so a re-render (slot/chip picks, opening ノード管理
// over the sheet) keeps what was typed. null when the form isn't on screen.
export function captureLineDraft() {
  const amountEl = document.getElementById('amount');
  if (!amountEl) return null;
  return {
    amount: amountEl.value,
    occurredOn: document.getElementById('occurred-on').value,
    memo: document.getElementById('memo').value,
    excludeFromFlowTotals: document.getElementById('exclude-from-flow').getAttribute('aria-pressed') === 'true',
  };
}
