import { state, pref, render } from '../state.js';
import { yen } from '../lib/format.js';
import { iconButton } from './iconButton.js';

// Per-node masking (so e.g. a salary or a specific liability can be hidden
// while everything else stays visible). Transaction amounts are left alone -
// hiding what things cost isn't the point, hiding how much money there is, is.
export function isNodeHidden(nodeId) {
  return pref.hiddenNodeIds.has(nodeId);
}

export function maskNodeYen(nodeId, n) {
  return isNodeHidden(nodeId) ? '••••••' : yen(n);
}

// 「表示を編集」: マスク 🐵/🙈・アーカイブ 📦 はこれを押している間だけ出す。
// state に置くので go() のページ遷移で解除される(MAINTENANCE.md §1 の state.*)。
// マスク中の金額は編集中でなくても maskNodeYen で「••••••」になる。
export function isDisplayEditing() {
  return Boolean(state.displayEditing);
}

export function displayEditButton() {
  return iconButton({ icon: 'eye', label: '表示を編集', pressed: isDisplayEditing(), attrs: 'data-display-edit' });
}

export function toggleDisplayEditing() {
  state.displayEditing = !isDisplayEditing();
  render();
}

// Small icon-only toggle meant to sit inside a clickable row/card; callers
// must stopPropagation so it doesn't also trigger the row's own click.
export function nodeHideToggleButton(nodeId) {
  if (!isDisplayEditing()) return '';
  return `<button type="button" class="node-hide-btn" data-node-hide-id="${nodeId}" title="${isNodeHidden(nodeId) ? 'このノードを表示' : 'このノードを非表示'}">${isNodeHidden(nodeId) ? '🙈' : '🐵'}</button>`;
}

export function toggleNodeHidden(nodeId) {
  setNodeHidden(nodeId, !pref.hiddenNodeIds.has(nodeId));
  render();
}

// ノード管理の編集フォームからも使う(ノード詳細のマスクは「編集」の中にある)。
export function setNodeHidden(nodeId, hidden) {
  if (hidden) pref.hiddenNodeIds.add(nodeId);
  else pref.hiddenNodeIds.delete(nodeId);
  localStorage.setItem('nodobo:hiddenNodeIds', JSON.stringify([...pref.hiddenNodeIds]));
}

export function netWorthToggleButton() {
  if (!isDisplayEditing()) return '';
  return `<button type="button" id="net-worth-hide-btn" class="node-hide-btn" title="${pref.netWorthHidden ? '純資産を表示' : '純資産を非表示'}">${pref.netWorthHidden ? '🙈' : '🐵'}</button>`;
}

export function toggleNetWorthHidden() {
  pref.netWorthHidden = !pref.netWorthHidden;
  localStorage.setItem('nodobo:netWorthHidden', pref.netWorthHidden ? '1' : '0');
  render();
}
