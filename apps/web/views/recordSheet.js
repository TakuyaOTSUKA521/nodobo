import { getLeafNodes, getNodeSuggestions, searchNodes, listNodes } from '../packages/core/nodes.js';
import { recordLine, reviseLine, deleteLine } from '../packages/core/lines.js';
import { getBalanceAsOf } from '../packages/core/reports.js';
import { supabase, memoKey } from '../lib/supabase.js';
import { esc } from '../lib/format.js';
import { NODE_TYPE_META } from '../lib/nodes.js';
import { ui, selectedToNode, setSelectedToNode, invalidateTxCache, render } from '../state.js';
import { renderNodePicker, wireNodePicker, renderLineFields, wireLineFields, readLineFields, captureLineDraft } from '../components/recordForm.js';
import { confirmDialog, lineSummary } from '../components/confirmDialog.js';
import { wireSegmented } from '../components/segmented.js';
import { isNodeHidden } from '../components/maskToggle.js';

// 記録シート / 取引の編集シート(DESIGN.md §5「入力」)。どの画面の上にも重ねて
// 開き、閉じると元の画面・スクロール位置に戻る。開いている間の状態は ui.sheet
// ({ mode: 'record' } | { mode: 'edit', line })。go() で差し替わる state には
// 置かない(下の画面の状態を壊さないため)。
//
// シート内の操作(スロット・チップの選択)は #sheet-host だけを描き直し、下の
// 画面は再描画しない。そのため描画に要るデータは開いたときに sheetData に
// 読んでおき、描き直しは同期で行う(タップ直後の focus() が iOS で効くように)。
let sheetData = null;

const NOT_EDITABLE_NOTE = '出どころ・行き先は変更できません。変えるときは削除して新規作成してください。';

export function isSheetOpen() {
  return Boolean(ui.sheet);
}

export async function openRecordSheet() {
  ui.sheet = { mode: 'record' };
  // 行き先と入力欄は毎回まっさらに。出どころは前回のまま(同じ財布から続けて
  // 記録することが多いため - DESIGN.md UX方針)。
  setSelectedToNode(null);
  ui.recordSlot = 'to';
  ui.recordDraft = null;
  ui.amountMode = 'spend';
  ui.amountPrefill = null;
  await prepareSheet();
  refreshSheet({ keepDraft: false });
}

export async function openEditSheet(line) {
  if (!line) return;
  ui.sheet = { mode: 'edit', line };
  ui.recordDraft = null;
  await prepareSheet();
  refreshSheet({ keepDraft: false });
}

export function closeSheet() {
  ui.sheet = null;
  ui.recordDraft = null;
  sheetData = null;
  const host = document.getElementById('sheet-host');
  if (host) host.innerHTML = '';
  document.documentElement.classList.remove('sheet-open');
}

// Loads whatever the open sheet needs. Called on open and on every full
// render() while a sheet is open (ノード管理 over the sheet may have just
// added a node, so the candidates are refetched rather than cached).
export async function prepareSheet() {
  if (!ui.sheet) {
    sheetData = null;
    return;
  }
  if (ui.sheet.mode === 'edit') {
    const nodes = await listNodes(supabase, { includeArchived: true });
    sheetData = { nodeTypeById: new Map(nodes.map((n) => [n.id, n.node_type])) };
    return;
  }
  const [leafNodes, suggestions] = await Promise.all([
    getLeafNodes(supabase),
    getNodeSuggestions(supabase, 8)
  ]);
  // Quick 出どころ chips default to asset/liability leaves (DESIGN.md UX方針:
  // "fromは財布か銀行かの2択がほとんど") - a fixed always-visible set, not a
  // frequency-ranked top-N, since a rarely-used account still deserves one tap.
  // The search box (either slot) can still find a leaf of ANY node_type, so a
  // flow node (初期値, ポイント還元, ...) can be picked as 出どころ when needed.
  const fromCandidates = leafNodes
    .filter((n) => n.node_type === 'asset' || n.node_type === 'liability')
    .sort((a, b) => a.name.localeCompare(b.name));
  sheetData = {
    leafNodes,
    suggestions,
    fromCandidates,
    leafIds: new Set(leafNodes.map((n) => n.id)),
    nodeTypeById: new Map(leafNodes.map((n) => [n.id, n.node_type])),
  };

  if (!ui.selectedFromNode) {
    // First open this session: fall back to 設定's 既定の出どころ, else just
    // the first candidate. Once picked, it persists across opens/submits.
    const storedDefaultId = localStorage.getItem('nodobo:defaultFromNodeId');
    const fallback = fromCandidates.find((n) => n.id === storedDefaultId) ?? fromCandidates[0];
    ui.selectedFromNode = fallback ? { id: fallback.id, name: fallback.name } : null;
  }
}

// Sheet markup for the full render() in index.html (empty when closed).
export function renderSheet() {
  if (!ui.sheet || !sheetData) return '';
  const draft = ui.recordDraft;
  ui.recordDraft = null;
  return ui.sheet.mode === 'edit' ? renderEditSheet(ui.sheet.line, draft) : renderRecordSheet(draft);
}

// 集計から除外 only means something when one endpoint is a flow node (the DB
// rejects it otherwise - see DESIGN.md 仕訳パターン「集計から除外する取引」),
// so the chip is disabled, not hidden, until such a node is picked.
function hasFlowEndpoint(ids) {
  return ids.some((id) => id && sheetData.nodeTypeById.get(id) === 'flow');
}

// 使用後残高 is only offered for an asset 出どころ (a payment out of a wallet
// or account) - see DESIGN.md §5「入力」.
function canEnterBalanceAfter() {
  return Boolean(ui.selectedFromNode) && sheetData.nodeTypeById.get(ui.selectedFromNode.id) === 'asset';
}

function isBalanceAfterMode() {
  return ui.sheet?.mode === 'record' && ui.amountMode === 'after' && canEnterBalanceAfter();
}

// Fills 金額 with the 出どころ's balance as of the chosen date, for the user
// to overwrite with what's left after paying. Unless `force` (the switch to
// 使用後残高 itself), a value the user has already edited is left alone. A
// masked node's balance isn't shown - the field is left empty instead, and
// handleSubmit still works out the amount the same way.
let prefillSeq = 0;
async function prefillBalanceAfter({ force = false } = {}) {
  const input = document.getElementById('amount');
  if (!input || !isBalanceAfterMode()) return;
  if (!force && input.value !== (ui.amountPrefill ?? '')) return;
  const seq = ++prefillSeq;
  const typedBefore = input.value;
  const nodeId = ui.selectedFromNode.id;
  let value = '';
  if (!isNodeHidden(nodeId)) {
    try {
      value = String(await getBalanceAsOf(supabase, nodeId, document.getElementById('occurred-on').value));
    } catch (error) {
      showError(error.message);
      return;
    }
  }
  const current = document.getElementById('amount');
  // A newer prefill started, or the user typed while this one was loading.
  if (seq !== prefillSeq || !current || current.value !== typedBefore) return;
  current.value = value;
  ui.amountPrefill = value;
}

// Back to 使用額. An untouched prefilled balance means nothing as a 使用額,
// so it's cleared (call before refreshSheet, which carries the field over).
function leaveBalanceAfter() {
  const input = document.getElementById('amount');
  if (input && input.value === (ui.amountPrefill ?? '')) input.value = '';
  ui.amountMode = 'spend';
  ui.amountPrefill = null;
}

function sheetShell({ title, body, foot }) {
  return `
    <div class="sheet-backdrop" data-sheet-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" id="record-sheet">
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="modal-close-btn" data-sheet-close aria-label="閉じる">×</button>
      </div>
      <div class="sheet-body">
        ${body}
        <p id="sheet-error" class="sheet-error"></p>
      </div>
      <div class="sheet-foot">${foot}</div>
    </div>
  `;
}

function renderRecordSheet(draft) {
  const flow = hasFlowEndpoint([ui.selectedFromNode?.id, selectedToNode?.id]);
  return sheetShell({
    title: '記録',
    body: `
      ${renderNodePicker({
        slot: ui.recordSlot,
        fromNode: ui.selectedFromNode,
        toNode: selectedToNode,
        fromCandidates: sheetData.fromCandidates,
        suggestions: sheetData.suggestions,
      })}
      ${renderLineFields({
        amount: draft?.amount ?? '',
        occurredOn: draft?.occurredOn || undefined,
        memo: draft?.memo ?? '',
        excludeOn: flow && (draft?.excludeFromFlowTotals ?? false),
        excludeDisabled: !flow,
        amountMode: isBalanceAfterMode() ? 'after' : 'spend',
        amountModeDisabled: !canEnterBalanceAfter(),
      })}
    `,
    foot: '<button type="button" id="sheet-submit" class="btn-primary sheet-submit-full">登録</button>',
  });
}

function renderEditSheet(line, draft) {
  const flow = hasFlowEndpoint([line.from_node, line.to_node]);
  const recordedAt = line.recorded_at ? new Date(line.recorded_at) : null;
  const recordedLabel = recordedAt
    ? `${recordedAt.getFullYear()}-${String(recordedAt.getMonth() + 1).padStart(2, '0')}-${String(recordedAt.getDate()).padStart(2, '0')} ${String(recordedAt.getHours()).padStart(2, '0')}:${String(recordedAt.getMinutes()).padStart(2, '0')}`
    : '';
  return sheetShell({
    title: '取引を編集',
    body: `
      <div class="sheet-fixed-nodes" title="${esc(NOT_EDITABLE_NOTE)}">${esc(line.from_name)} → ${esc(line.to_name)}</div>
      ${renderLineFields({
        amount: draft?.amount ?? line.amount,
        occurredOn: draft?.occurredOn || line.occurred_on,
        memo: draft?.memo ?? line.memo ?? '',
        excludeOn: flow && (draft?.excludeFromFlowTotals ?? line.exclude_from_flow_totals ?? false),
        excludeDisabled: !flow,
      })}
      ${recordedLabel ? `<p class="sheet-recorded mono">記録日時 ${recordedLabel}</p>` : ''}
    `,
    foot: `
      <button type="button" id="sheet-delete" class="link-danger">この取引を削除</button>
      <div class="sheet-foot-actions">
        <button type="button" class="btn" data-sheet-close>キャンセル</button>
        <button type="button" id="sheet-submit" class="btn-primary">更新</button>
      </div>
    `,
  });
}

// Redraws only the sheet. keepDraft carries what was typed across the redraw.
function refreshSheet({ keepDraft = true } = {}) {
  const host = document.getElementById('sheet-host');
  if (!host || !ui.sheet) return;
  if (keepDraft) ui.recordDraft = captureLineDraft();
  host.innerHTML = renderSheet();
  document.documentElement.classList.add('sheet-open');
  wireSheet();
}

// Shared by chip clicks and search-result clicks: routes the pick to whichever
// slot is focused. Picking 出どころ auto-advances to 行き先 (the natural next
// step); picking 行き先 stays put since the amount is next.
function pickNode(node, { fromSearch }) {
  const pickedFrom = ui.recordSlot === 'from';
  if (pickedFrom) {
    ui.selectedFromNode = { id: node.id, name: node.name };
    ui.recordSlot = 'to';
    // 資産以外の出どころでは使用後残高を使えないので使用額に戻す。
    if (!canEnterBalanceAfter() && ui.amountMode === 'after') leaveBalanceAfter();
  } else {
    setSelectedToNode(node);
  }
  refreshSheet();
  if (pickedFrom) prefillBalanceAfter();
  // A search pick on a phone came from the collapsed search mode: back to the
  // normal layout with the amount ready to type.
  if (fromSearch && ui.recordSlot === 'to' && selectedToNode?.id === node.id) {
    document.getElementById('amount')?.focus();
  }
}

export function wireSheet() {
  if (!ui.sheet) return;
  document.documentElement.classList.add('sheet-open');
  document.querySelectorAll('#sheet-host [data-sheet-close]').forEach((el) => el.addEventListener('click', closeSheet));
  wireLineFields({ onDateChange: () => prefillBalanceAfter() });

  if (ui.sheet.mode === 'record') {
    wireSegmented('amount-mode', (value) => {
      if (value === 'spend') leaveBalanceAfter();
      else ui.amountMode = 'after';
      refreshSheet();
      if (value === 'after') prefillBalanceAfter({ force: true });
    });
    wireNodePicker({
      searchModeEl: document.getElementById('record-sheet'),
      onSlot: (slot) => {
        ui.recordSlot = slot;
        refreshSheet();
      },
      onPick: pickNode,
      onCreate: (query) => {
        // ノード管理を名前入りで開く。シートは ui.sheet に残るので、閉じると戻る。
        ui.recordDraft = captureLineDraft();
        document.dispatchEvent(new CustomEvent('nodobo:open-manager', { detail: { name: query } }));
      },
      search: async (query) => {
        const results = await searchNodes(supabase, query);
        // Any node_type is a valid 出どころ/行き先 (DESIGN.md 4.仕訳パターン) -
        // only leaf-ness is restricted, since only leaves can be line endpoints.
        // The type label keeps e.g. a flow "食費" and an asset "食費" apart.
        return results
          .filter((n) => sheetData.leafIds.has(n.id))
          .map((n) => ({ ...n, typeLabel: NODE_TYPE_META[n.node_type].label, typeColor: NODE_TYPE_META[n.node_type].color }));
      },
    });
  } else {
    document.getElementById('sheet-delete').addEventListener('click', handleDelete);
  }

  document.getElementById('sheet-submit').addEventListener('click', handleSubmit);
}

function showError(message) {
  document.getElementById('sheet-error').textContent = message;
}

async function handleSubmit() {
  showError('');
  const fields = readLineFields();
  const { occurredOn, memo, excludeFromFlowTotals } = fields;
  let { amount } = fields;
  const byBalanceAfter = isBalanceAfterMode();
  if (!byBalanceAfter && !(amount > 0)) {
    showError('金額を入力してください');
    return;
  }

  try {
    if (ui.sheet.mode === 'edit') {
      // 出どころ・行き先は渡さない(reviseLine が元の行の値を引き継ぐ)。
      await reviseLine(supabase, ui.sheet.line.id, { occurredOn, amount, memo, excludeFromFlowTotals }, memoKey);
    } else {
      if (!ui.selectedFromNode) {
        showError('出どころを選択してください');
        return;
      }
      if (!selectedToNode) {
        showError('行き先を選択してください');
        return;
      }
      // 使用後残高: 金額 = その日付時点の残高 − 入力値。計算した金額は画面に
      // 出さない(取引一覧などで確認してもらう)。
      if (byBalanceAfter) {
        if (!Number.isFinite(amount)) {
          showError('使用後残高を入力してください');
          return;
        }
        amount = (await getBalanceAsOf(supabase, ui.selectedFromNode.id, occurredOn)) - amount;
        if (!(amount > 0)) {
          showError('使用後残高が、その日付時点の残高以上になっています');
          return;
        }
      }
      const { data: { user } } = await supabase.auth.getUser();
      await recordLine(supabase, { userId: user.id, occurredOn, fromNode: ui.selectedFromNode.id, toNode: selectedToNode.id, amount, memo, excludeFromFlowTotals }, memoKey);
    }
  } catch (error) {
    showError(error.message);
    return;
  }

  // ui.selectedFromNode intentionally survives - the next entry is very often
  // from the same source (DESIGN.md UX方針).
  setSelectedToNode(null);
  closeSheet();
  invalidateTxCache();
  render();
}

async function handleDelete() {
  const line = ui.sheet.line;
  const ok = await confirmDialog({ title: 'この取引を削除しますか', summaryHtml: lineSummary(line) });
  if (!ok) return;
  try {
    await deleteLine(supabase, line.id);
  } catch (error) {
    showError(error.message);
    return;
  }
  closeSheet();
  invalidateTxCache();
  render();
}

// Escape closes the sheet unless something is stacked on top of it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !ui.sheet) return;
  if (document.querySelector('.modal-panel, .confirm-dialog')) return;
  closeSheet();
});
