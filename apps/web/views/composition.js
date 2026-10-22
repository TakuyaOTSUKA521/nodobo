import { getRollupBalances, getCumulativeForNodes } from '../packages/core/reports.js';
import { supabase } from '../lib/supabase.js';
import { esc, yen } from '../lib/format.js';
import { loadAllNodesWithPaths } from '../lib/nodes.js';
import { state, pref, render } from '../state.js';
import { periodRange } from '../components/periodSelector.js';
import { periodSegment, wirePeriodSegment } from '../components/periodSegment.js';
import { segmented, wireSegmented } from '../components/segmented.js';
import { isNodeHidden, maskNodeYen, nodeHideToggleButton, displayEditButton } from '../components/maskToggle.js';
import { renderNodeTree, treeToggleCell } from '../components/collapsibleTree.js';

const CHART_COLORS = ['#2f7fa8', '#a95742', '#6d7fa3', '#c9974a', '#4d8f8a', '#7d6fa3', '#3c5163', '#5f8f6e'];
const MASKED = '••••••';

// One ring sector from angle `start` to `end` (radians), outerR down to innerR.
function ringPath(cx, cy, outerR, innerR, start, end) {
  const point = (radius, angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = point(outerR, start);
  const [x2, y2] = point(outerR, end);
  const [ix2, iy2] = point(innerR, end);
  const [ix1, iy1] = point(innerR, start);
  return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`;
}

// No chart library - one <path> arc per entry, share of `total` in radians,
// drawn as a ring (outer radius r, punched out down to holeR). A lone
// 100%-share entry is clamped just under a full turn so the arc command
// still gets two distinct endpoints to draw between. Each slice carries a
// native <title> (same pattern as the bar charts) so hovering it shows the
// node's masked amount and its share of `total`.
function renderDonutChart(entries, total, size = 132) {
  if (!total) return '';
  const r = size / 2;
  const holeR = r * 0.6;
  const cx = r, cy = r;

  let angle = -Math.PI / 2;
  const paths = entries.map((e, i) => {
    const sweep = Math.min((e.amount / total) * Math.PI * 2, Math.PI * 2 - 0.001);
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const d = ringPath(cx, cy, r, holeR, start, end);
    const pct = (e.amount / total) * 100;
    const tooltip = `${esc(e.node.name)}: ${maskNodeYen(e.node.id, e.amount)} (${pct.toFixed(1)}%)`;
    return `<path class="donut-slice" d="${d}" fill="${CHART_COLORS[(e.colorIndex ?? i) % CHART_COLORS.length]}"><title>${tooltip}</title></path>`;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex:0 0 auto;">${paths}</svg>`;
}

// 多層表示: each entry carries `children` (built by withBreakdown), each child
// its own rollup amount from the view. Only positive amounts are drawn.
const drawnChildren = (item) => item.children.filter((c) => c.amount > 0);

function breakdownDepth(item) {
  const kids = drawnChildren(item);
  return kids.length ? 1 + Math.max(...kids.map(breakdownDepth)) : 1;
}

// Descendants keep their depth-1 ancestor's color and only get lighter, one
// step per level (fill-opacity over the white card, like the donut's hover).
function levelOpacity(depth) {
  return Math.max(1 - (depth - 1) * 0.2, 0.3);
}

function chartColor(colorIndex) {
  return CHART_COLORS[colorIndex % CHART_COLORS.length];
}

// Hidden nodes, everything under them, and every ancestor - an ancestor's
// amount minus its visible children would give the hidden one away.
function maskedNodeIds(entries) {
  const masked = new Set();
  const addSubtree = (item) => {
    masked.add(item.node.id);
    item.children.forEach(addSubtree);
  };
  const walk = (item, ancestorIds) => {
    if (isNodeHidden(item.node.id)) {
      addSubtree(item);
      ancestorIds.forEach((id) => masked.add(id));
    }
    item.children.forEach((c) => walk(c, [...ancestorIds, item.node.id]));
  };
  entries.forEach((e) => walk(e, []));
  return masked;
}

// Sunburst: depth 1 (the card's root nodes) innermost, each level's arcs
// inside their parent's angle range, rings splitting holeR..r evenly by the
// deepest level. Same outer radius as the donut but a smaller hole, so each
// ring stays thick enough to read with several levels. A node without drawn children stretches out to the outer
// edge. Children short of their parent leave a 「(内訳なし)」 arc in the
// parent's color; children over it share the parent's arc by their ratio.
// No text on the chart itself - only native <title> tooltips, like the donut.
function renderSunburstChart(entries, total, masked, size = 132) {
  if (!total) return '';
  const r = size / 2;
  const holeR = r * 0.3;
  const cx = r, cy = r;
  const ringWidth = (r - holeR) / Math.max(...entries.map(breakdownDepth));

  const tooltip = (path, amount, parentAmount, isMasked) => {
    const shares = [`全体の${((amount / total) * 100).toFixed(1)}%`];
    if (parentAmount != null) shares.push(`親の${((amount / parentAmount) * 100).toFixed(1)}%`);
    return `${esc(path.join(' › '))}: ${isMasked ? MASKED : yen(amount)} (${shares.join(' / ')})`;
  };

  const paths = [];
  // `shadeDepth` picks the lightness step; it only differs from `depth` for a
  // 「(内訳なし)」 arc, which keeps its parent's shade.
  const arc = ({ depth, shadeDepth = depth, start, sweep, toOuterEdge, color, title }) => {
    const innerR = holeR + (depth - 1) * ringWidth;
    const outerR = toOuterEdge ? r : innerR + ringWidth;
    const end = start + Math.min(sweep, Math.PI * 2 - 0.001);
    paths.push(`<path class="donut-slice sunburst-seg" d="${ringPath(cx, cy, outerR, innerR, start, end)}" fill="${color}" fill-opacity="${levelOpacity(shadeDepth)}"><title>${title}</title></path>`);
  };

  const place = (item, depth, start, sweep, color, path, parentAmount) => {
    const kids = drawnChildren(item);
    arc({ depth, start, sweep, toOuterEdge: !kids.length, color, title: tooltip(path, item.amount, parentAmount, masked.has(item.node.id)) });
    if (!kids.length) return;
    const kidsTotal = kids.reduce((sum, k) => sum + k.amount, 0);
    const scale = sweep / Math.max(kidsTotal, item.amount);
    let angle = start;
    kids.forEach((k) => {
      place(k, depth + 1, angle, k.amount * scale, color, [...path, k.node.name], item.amount);
      angle += k.amount * scale;
    });
    if (kidsTotal < item.amount) {
      const rest = item.amount - kidsTotal;
      arc({ depth: depth + 1, shadeDepth: depth, start: angle, sweep: rest * scale, toOuterEdge: true, color, title: tooltip([...path, '(内訳なし)'], rest, item.amount, masked.has(item.node.id)) });
    }
  };

  let angle = -Math.PI / 2;
  entries.forEach((e) => {
    const sweep = (e.amount / total) * Math.PI * 2;
    place(e, 1, angle, sweep, chartColor(e.colorIndex), [e.node.name], null);
    angle += sweep;
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex:0 0 auto;">${paths.join('')}</svg>`;
}

// 多層表示の凡例: 子を持つ行に ▸/▾ を出し、押したノードの子だけを開く(最初は
// 最上位だけ)。開閉は分析画面専用の state.analysisExpandedIds(ページ遷移で全部
// 閉じる。ノード一覧とは連動しない)。割合は1層の凡例と同じくカード合計に対するもの。
function multiLegendRows(entries, total, masked) {
  const expandedIds = state.analysisExpandedIds ?? new Set();
  // nodeId -> { item, color }: color is null for anything not drawn (a <= 0
  // amount, or under one), matching the 1層 legend's transparent swatch.
  const byId = new Map();
  const collect = (item, color) => {
    const drawn = color && item.amount > 0 ? color : null;
    byId.set(item.node.id, { item, color: drawn });
    item.children.forEach((c) => collect(c, drawn));
  };
  entries.forEach((e) => collect(e, chartColor(e.colorIndex)));

  const row = (n, depth, hasChildren) => {
    const { item, color } = byId.get(n.id);
    const pct = total ? (item.amount / total) * 100 : 0;
    return `
      <div class="row" style="padding-left:${depth * 16}px;">
        ${treeToggleCell(n.id, hasChildren, { expanded: expandedIds.has(n.id), attr: 'data-analysis-tree-toggle-id' })}
        <span class="chart-swatch" style="background:${color ?? 'transparent'};${color ? `opacity:${levelOpacity(depth + 1)};` : ''}"></span>
        <span class="${depth ? 'indent-name' : ''}" style="flex:1;min-width:0;">${esc(n.name)}</span>
        <span class="mono" style="min-width:74px;text-align:right;">${masked.has(n.id) ? MASKED : yen(item.amount)}</span>
        <span style="min-width:46px;text-align:right;font-size:11.5px;color:var(--muted);">${pct.toFixed(1)}%</span>
        ${nodeHideToggleButton(n.id)}
      </div>
    `;
  };

  return renderNodeTree([...byId.values()].map((v) => v.item.node), row, {
    compare: (a, b) => byId.get(b.id).item.amount - byId.get(a.id).item.amount,
    isExpanded: (id) => expandedIds.has(id),
  });
}

// Attaches each entry's whole subtree (no depth limit) for the 多層 chart,
// leaving out exclude_from_flow_totals nodes and everything under them.
// `amountOf` reads a node's own rollup figure from the view rows - nothing
// is summed here.
function breakdownChildrenMap(nodes) {
  const map = new Map();
  nodes.filter((n) => n.parent_id && !n.exclude_from_flow_totals).forEach((n) => {
    if (!map.has(n.parent_id)) map.set(n.parent_id, []);
    map.get(n.parent_id).push(n);
  });
  return map;
}

function subtreeNodeIds(roots, childrenByParent) {
  const ids = [];
  const walk = (n) => {
    ids.push(n.id);
    (childrenByParent.get(n.id) ?? []).forEach(walk);
  };
  roots.forEach(walk);
  return ids;
}

function withBreakdown(entries, childrenByParent, amountOf) {
  const build = (node) => ({
    node,
    amount: amountOf(node),
    children: (childrenByParent.get(node.id) ?? []).map(build).sort((a, b) => b.amount - a.amount),
  });
  return entries.map((e) => ({ ...e, children: build(e.node).children }));
}

// One 支出/収入/資産/負債 breakdown card: entries usually carry a positive
// `amount`, but an asset/liability entry may be <= 0 (e.g. a node that went
// negative) - see renderAnalysisPage. `total` sums every entry as-is so it
// always matches v_net_worth; only the donut excludes non-positive entries
// (a negative slice can't be drawn), keeping them in the legend instead.
// No aggregation here - `amount` was summed from view rows by the caller.
function compositionSection(title, entries) {
  const total = entries.reduce((sum, e) => sum + e.amount, 0);
  if (!entries.length) {
    return `
      <section class="card">
        <h2 style="margin-bottom:4px;">${title}</h2>
        <p style="font-size:13px;color:var(--faint);margin-top:8px;">記録がありません</p>
      </section>
    `;
  }

  // A hidden node's amount would otherwise leak through total − visible
  // entries, so the total masks along with it (same rule the legend rows
  // already follow via maskNodeYen/nodeHideToggleButton). 多層 also shows
  // descendants, so any hidden node anywhere in the card masks it there.
  const multi = pref.analysisChartDepth === 'multi';
  const masked = multi ? maskedNodeIds(entries) : null;
  const anyHidden = multi ? masked.size > 0 : entries.some((e) => isNodeHidden(e.node.id));
  const totalLabel = anyHidden ? '••••••' : yen(total);

  const indexedEntries = entries.map((e, i) => ({ ...e, colorIndex: i }));
  const chartEntries = indexedEntries.filter((e) => e.amount > 0);
  const chartTotal = chartEntries.reduce((sum, e) => sum + e.amount, 0);

  if (multi) {
    return `
      <section class="card">
        <div class="card-head">
          <h2>${title}</h2>
          <span class="mono" style="font-size:20px;font-weight:700;">${totalLabel}</span>
        </div>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:10px;">
          ${renderSunburstChart(chartEntries, chartTotal, masked)}
          <div style="flex:1;min-width:200px;">${multiLegendRows(indexedEntries, total, masked)}</div>
        </div>
      </section>
    `;
  }

  const legendRows = indexedEntries.map((e) => {
    const pct = total ? (e.amount / total) * 100 : 0;
    return `
      <div class="row">
        <span class="chart-swatch" style="background:${e.amount > 0 ? CHART_COLORS[e.colorIndex % CHART_COLORS.length] : 'transparent'};"></span>
        <span style="flex:1;min-width:0;">${esc(e.node.name)}</span>
        <span class="mono" style="min-width:74px;text-align:right;">${maskNodeYen(e.node.id, e.amount)}</span>
        <span style="min-width:46px;text-align:right;font-size:11.5px;color:var(--muted);">${pct.toFixed(1)}%</span>
        ${nodeHideToggleButton(e.node.id)}
      </div>
    `;
  }).join('');

  return `
    <section class="card">
      <div class="card-head">
        <h2>${title}</h2>
        <span class="mono" style="font-size:20px;font-weight:700;">${totalLabel}</span>
      </div>
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:10px;">
        ${renderDonutChart(chartEntries, chartTotal)}
        <div style="flex:1;min-width:200px;">${legendRows}</div>
      </div>
    </section>
  `;
}

// 構成比は「収支」(期間で絞り込む支出/収入)と「資産」(常に現在残高の資産/負債)
// の2ビューに分ける。期間セレクタは収支ビューにだけ出す - 資産側の数値は期間に
// よって変わらないので、同じ画面に並べるとセレクタが効いているように誤読される。
// state.analysisView は go() でリセットされ、「分析」タブからは常に収支で開く。
export async function renderAnalysisPage() {
  const view = state.analysisView ?? 'flow';
  const multi = pref.analysisChartDepth === 'multi';
  const nodes = await loadAllNodesWithPaths();
  const childrenByParent = multi ? breakdownChildrenMap(nodes) : null;

  let controls = '';
  let sections = '';

  if (view === 'flow') {
    const rootFlowNodes = nodes.filter((n) => n.node_type === 'flow' && !n.parent_id && !n.exclude_from_flow_totals);
    const period = state.analysisPeriod ?? 'month';
    const { from, to } = periodRange(period);

    // 多層 needs every descendant's own rollup too; 1層 only the roots.
    const flowNodeIds = multi ? subtreeNodeIds(rootFlowNodes, childrenByParent) : rootFlowNodes.map((n) => n.id);
    const flowRows = await getCumulativeForNodes(supabase, flowNodeIds, { from, to });
    const deltaByNodeId = new Map();
    // flow_daily_delta, not daily_delta: lines flagged 集計から除外 stay out of 収支.
    flowRows.forEach((r) => deltaByNodeId.set(r.node_id, (deltaByNodeId.get(r.node_id) ?? 0) + Number(r.flow_daily_delta)));

    const spendOf = (n) => deltaByNodeId.get(n.id) ?? 0;
    const incomeOf = (n) => -(deltaByNodeId.get(n.id) ?? 0);
    let spendEntries = rootFlowNodes
      .map((n) => ({ node: n, amount: spendOf(n) }))
      .filter((e) => e.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    let incomeEntries = rootFlowNodes
      .map((n) => ({ node: n, amount: incomeOf(n) }))
      .filter((e) => e.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    if (multi) {
      spendEntries = withBreakdown(spendEntries, childrenByParent, spendOf);
      incomeEntries = withBreakdown(incomeEntries, childrenByParent, incomeOf);
    }

    controls = periodSegment('analysis-period', period);
    sections = `
      ${compositionSection('支出構成比', spendEntries)}
      ${compositionSection('収入構成比', incomeEntries)}
    `;
  } else {
    const rootAssetNodes = nodes.filter((n) => n.node_type === 'asset' && !n.parent_id);
    const rootLiabilityNodes = nodes.filter((n) => n.node_type === 'liability' && !n.parent_id);

    const balances = await getRollupBalances(supabase);
    const balanceByNodeId = new Map(balances.map((b) => [b.node_id, Number(b.balance)]));

    // Kept even when amount <= 0 (e.g. an asset node that has gone negative,
    // or a liability node that has gone positive) so this section's total
    // still matches v_net_worth exactly - compositionSection excludes these
    // from the donut but keeps them in the legend and the total.
    const assetOf = (n) => balanceByNodeId.get(n.id) ?? 0;
    const liabilityOf = (n) => -(balanceByNodeId.get(n.id) ?? 0);
    let assetEntries = rootAssetNodes
      .map((n) => ({ node: n, amount: assetOf(n) }))
      .sort((a, b) => b.amount - a.amount);
    let liabilityEntries = rootLiabilityNodes
      .map((n) => ({ node: n, amount: liabilityOf(n) }))
      .sort((a, b) => b.amount - a.amount);
    if (multi) {
      assetEntries = withBreakdown(assetEntries, childrenByParent, assetOf);
      liabilityEntries = withBreakdown(liabilityEntries, childrenByParent, liabilityOf);
    }

    sections = `
      ${compositionSection('純資産構成比（資産）', assetEntries)}
      ${liabilityEntries.length ? compositionSection('純資産構成比（負債）', liabilityEntries) : ''}
    `;
  }

  return `
    <div class="stack" style="gap:14px;">
      <div class="page-head">
        <h1>分析</h1>
        <div class="page-actions">${displayEditButton()}</div>
      </div>
      <div class="toolbar">
        ${segmented('analysis-view', [['flow', '収支'], ['balance', '資産']], view)}
        ${segmented('analysis-depth', [['single', '1層'], ['multi', '多層']], pref.analysisChartDepth)}
        <div class="toolbar-end">${controls}</div>
      </div>
      <div class="grid-fit-320">
        ${sections}
      </div>
    </div>
  `;
}

export function wireAnalysisPage() {
  wireSegmented('analysis-view', (value) => {
    state.analysisView = value;
    render();
  });
  wirePeriodSegment('analysis-period', (value) => {
    state.analysisPeriod = value;
    render();
  });
  wireSegmented('analysis-depth', (value) => {
    pref.analysisChartDepth = value;
    localStorage.setItem('kakeibo:analysisChartDepth', pref.analysisChartDepth);
    render();
  });
  document.querySelectorAll('[data-analysis-tree-toggle-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expandedIds = state.analysisExpandedIds ?? new Set();
      const id = btn.dataset.analysisTreeToggleId;
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      state.analysisExpandedIds = expandedIds;
      render();
    });
  });
}
