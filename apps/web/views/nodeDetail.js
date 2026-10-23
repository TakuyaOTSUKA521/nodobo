import { getDescendantIds } from '../packages/core/nodes.js';
import { getCumulative, getLinesForNodes } from '../packages/core/reports.js';
import { supabase, memoKey } from '../lib/supabase.js';
import { esc } from '../lib/format.js';
import { state, pref, nodesById, chartData, setChartData, render } from '../state.js';
import { isNodeHidden, maskNodeYen } from '../components/maskToggle.js';
import { renderTxRow } from '../components/txRow.js';
import { segmented, wireSegmented } from '../components/segmented.js';
import { CHART_MODES, renderBarChartAxis, mountBarChart } from '../components/barChart.js';

// 内訳は新しい順に先頭だけ見せ、残りは「すべて表示」で開く
const DETAIL_LINES_LIMIT = 10;

export async function renderDetailPage() {
  const nodeId = state.detailNodeId;
  const label = nodesById.get(nodeId)?.path ?? state.detailName ?? nodeId;

  const descendantIds = await getDescendantIds(supabase, nodeId);
  const [cumulative, lines] = await Promise.all([
    getCumulative(supabase, nodeId),
    getLinesForNodes(supabase, descendantIds, memoKey)
  ]);
  setChartData(cumulative);

  const latestBalance = cumulative.length ? cumulative[cumulative.length - 1].cumulative_balance : 0;
  const valueKey = pref.chartMode === 'cumulative' ? 'cumulative_balance' : 'daily_delta';

  const detailRows = lines.slice(0, DETAIL_LINES_LIMIT).map((l) => renderTxRow(l)).join('') || '<p style="font-size:13px;color:var(--faint);">記録がありません</p>';
  const restCount = lines.length - DETAIL_LINES_LIMIT;
  const restRows = restCount > 0 ? `
    <div id="detail-lines-rest" hidden>${lines.slice(DETAIL_LINES_LIMIT).map((l) => renderTxRow(l)).join('')}</div>
    <button type="button" id="detail-lines-more" class="btn" style="width:100%;margin-top:10px;">すべて表示(残り${restCount}件)</button>
  ` : '';

  return `
    <div class="breadcrumb"><a href="#" data-nav="nodes">ノード一覧</a><span>/</span><span>${esc(label)}</span></div>
    <div class="grid-fit-320">
      <section class="card">
        <div class="card-head">
          <h1>${esc(label)}</h1>
          <button type="button" class="btn" style="width:auto;" data-open-manager="${esc(nodeId)}">編集</button>
        </div>
        <div class="stat-value mono">${maskNodeYen(nodeId, latestBalance)}</div>
        <p class="page-meta" style="margin:0 0 18px;">全期間</p>

        <div class="card-head" style="align-items:center;margin-bottom:10px;">
          <span style="font-size:13.5px;font-weight:500;">残高推移</span>
          ${segmented('chart-mode', CHART_MODES, pref.chartMode)}
        </div>
        ${renderBarChartAxis(chartData, valueKey, isNodeHidden(nodeId))}
        ${pref.chartMode === 'daily' ? `
          <div class="legend">
            <span><span class="swatch" style="background:var(--accent);"></span>増加</span>
            <span><span class="swatch" style="background:var(--negative);"></span>減少</span>
          </div>
        ` : ''}
      </section>

      <section class="card">
        <h2 style="margin-bottom:6px;">内訳</h2>
        <div id="detail-lines">${detailRows}${restRows}</div>
      </section>
    </div>
  `;
}

export function wireDetailPage() {
  const valueKey = pref.chartMode === 'cumulative' ? 'cumulative_balance' : 'daily_delta';
  mountBarChart(chartData, valueKey, isNodeHidden(state.detailNodeId));

  document.getElementById('detail-lines-more')?.addEventListener('click', (e) => {
    document.getElementById('detail-lines-rest').hidden = false;
    e.currentTarget.remove();
  });

  wireSegmented('chart-mode', (value) => {
    pref.chartMode = value;
    localStorage.setItem('nodobo:chartMode', pref.chartMode);
    render();
  });
}
