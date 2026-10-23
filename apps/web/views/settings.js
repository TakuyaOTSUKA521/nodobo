import { getLeafNodes, listNodesWithPaths } from '../packages/core/nodes.js';
import { listLines } from '../packages/core/reports.js';
import { supabase, memoKey } from '../lib/supabase.js';
import { esc, todayISODate } from '../lib/format.js';
import { NODE_TYPE_META } from '../lib/nodes.js';
import {
  session, pref, ui, cache, setSession, setNodesById, setLinesById, setChartData, setTxListOffset, setTxListDone, go, render
} from '../state.js';
import { segmented, wireSegmented } from '../components/segmented.js';
import { confirmDialog } from '../components/confirmDialog.js';
import { CHART_MODES } from '../components/barChart.js';

export function renderSettingsPage() {
  return `
    <div class="stack" style="gap:14px;">
      <h1>設定</h1>
      <div class="grid-fit-300">
        <section class="card">
          <h2 style="margin-bottom:14px;">表示</h2>
          <div class="stack" style="gap:14px;">
            <label class="field">既定の出どころ<select id="default-from-select"></select></label>
            <div class="field">グラフの既定表示
              <div>${segmented('default-chart-mode', CHART_MODES, pref.chartMode)}</div>
            </div>
          </div>
        </section>

        <section class="card">
          <h2 style="margin-bottom:14px;">データ</h2>
          <div class="stack" style="gap:8px;align-items:flex-start;">
            <button id="csv-export-btn" class="btn">取引をCSVで書き出す</button>
            <button id="node-csv-export-btn" class="btn">ノード構成をCSVで書き出す</button>
          </div>
        </section>

        <section class="card">
          <h2 style="margin-bottom:14px;">アカウント</h2>
          <div class="stack" style="gap:12px;align-items:flex-start;">
            <span style="font-size:14px;color:var(--muted);overflow-wrap:anywhere;">${esc(session?.user?.email ?? '')}</span>
            <button id="settings-logout-btn" class="btn btn-danger-text">ログアウト</button>
          </div>
        </section>
      </div>
    </div>
  `;
}

export async function wireSettingsPage() {
  const leaves = await getLeafNodes(supabase);
  const currentDefault = localStorage.getItem('nodobo:defaultFromNodeId') ?? '';
  const fromSelect = document.getElementById('default-from-select');
  fromSelect.innerHTML = leaves.map((n) => `<option value="${n.id}" ${n.id === currentDefault ? 'selected' : ''}>${esc(n.name)}</option>`).join('');
  fromSelect.addEventListener('change', (e) => localStorage.setItem('nodobo:defaultFromNodeId', e.target.value));

  wireSegmented('default-chart-mode', (value) => {
    pref.chartMode = value;
    localStorage.setItem('nodobo:chartMode', pref.chartMode);
    render();
  });

  document.getElementById('csv-export-btn').addEventListener('click', handleExportCsv);
  document.getElementById('node-csv-export-btn').addEventListener('click', handleExportNodesCsv);

  document.getElementById('settings-logout-btn').addEventListener('click', handleLogout);
}

// Shared CSV download plumbing for the 設定 page's export buttons below.
// Encoding only - no aggregation - so it stays in apps/web rather than
// packages/core.
function csvEscape(value) {
  let s = String(value ?? '');
  // Neutralize spreadsheet formula injection: Excel/Sheets treat a field
  // starting with = + - @ (or a leading tab/CR) as a formula to evaluate
  // when the CSV is opened. memo and node names are free text the account
  // owner can type anything into, so this can't be assumed safe.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map((cols) => cols.map(csvEscape).join(','))
    .join('\r\n');

  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Exports every active line (v_lines, all pages) as a CSV file.
async function handleExportCsv() {
  const btn = document.getElementById('csv-export-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '書き出し中…';
  try {
    const rows = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const page = await listLines(supabase, { ascending: true, limit: pageSize, offset }, memoKey);
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    const header = ['日付', '出どころ', '行き先', '金額', 'メモ'];
    downloadCsv(
      `nodobo_${todayISODate()}.csv`,
      header,
      rows.map((l) => [l.occurred_on, l.from_name, l.to_name, l.amount, l.memo])
    );
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// Exports every node (including archived) with its hierarchy path and
// node_type classification - a snapshot of the node tree, not a balance
// report (see summary.js / reports.js for balances). Rows are grouped by
// 分類 then sorted by path so parent/child rows land next to each other.
async function handleExportNodesCsv() {
  const btn = document.getElementById('node-csv-export-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '書き出し中…';
  try {
    const nodes = await listNodesWithPaths(supabase, { includeArchived: true });
    const nameById = new Map(nodes.map((n) => [n.id, n.name]));
    const typeOrder = { asset: 0, liability: 1, flow: 2 };
    const sorted = [...nodes].sort((a, b) =>
      typeOrder[a.node_type] - typeOrder[b.node_type] || a.path.localeCompare(b.path)
    );

    const header = ['分類', '階層パス', 'ノード名', '親ノード', '収支から除外', 'アーカイブ済み'];
    downloadCsv(
      `nodobo_nodes_${todayISODate()}.csv`,
      header,
      sorted.map((n) => [
        NODE_TYPE_META[n.node_type].label,
        n.path,
        n.name,
        n.parent_id ? nameById.get(n.parent_id) ?? '' : '',
        n.exclude_from_flow_totals ? '○' : '',
        n.is_archived ? '○' : ''
      ])
    );
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// On a shared device, a second person could reopen this same browser tab
// after a logout without a full page reload - these module-level caches
// (decrypted memo, amounts, balance history included) would otherwise still
// sit in memory even though the UI has moved back to the login page.
async function handleLogout() {
  const ok = await confirmDialog({ title: 'ログアウトしますか', summaryHtml: esc(session?.user?.email ?? ''), confirmLabel: 'ログアウト' });
  if (!ok) return;
  await supabase.auth.signOut();
  setSession(null);
  ui.sheet = null;
  setNodesById(new Map());
  setLinesById(new Map());
  setChartData([]);
  cache.txListRows = [];
  setTxListOffset(0);
  setTxListDone(false);
  cache.txPeriod = 'all';
  go('login');
}
