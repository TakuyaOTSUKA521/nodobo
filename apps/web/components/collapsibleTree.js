import { render } from '../state.js';

// Which parent nodes are expanded in a collapsible hierarchy view (node
// list's 資産/負債/支出・収入 sections, node management's tree). Starts empty
// so every tree opens collapsed to just its top level (DESIGN.md UX方針).
let expandedNodeIds = new Set();

// Groups `list` by parent_id (root nodes under the 'root' key) - the shared
// basis for every collapsible-tree render below.
function buildChildrenMap(list) {
  const map = new Map();
  list.forEach((n) => {
    const key = n.parent_id ?? 'root';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  });
  return map;
}

function isNodeExpanded(nodeId) {
  return expandedNodeIds.has(nodeId);
}

export function toggleNodeExpanded(nodeId) {
  if (expandedNodeIds.has(nodeId)) expandedNodeIds.delete(nodeId);
  else expandedNodeIds.add(nodeId);
  render();
}

// Caret shown in place of nodeHideToggleButton/nodeArchiveButton's spot when
// a row has children to fold away; a fixed-width spacer otherwise, so leaf
// rows in the same tree still line up with their siblings that have one.
// A tree that keeps its own expanded set (the analysis legend, held in
// `state` so it doesn't follow the node list's) passes `expanded` and its own
// `attr`; that attribute isn't wired by index.html, so the view wires it.
export function treeToggleCell(nodeId, hasChildren, { expanded = isNodeExpanded(nodeId), attr = 'data-tree-toggle-id' } = {}) {
  if (!hasChildren) return '<span class="tree-toggle-spacer"></span>';
  return `<button type="button" class="tree-toggle-btn" ${attr}="${nodeId}" title="${expanded ? '折りたたむ' : '展開する'}">${expanded ? '▾' : '▸'}</button>`;
}

const byName = (a, b) => a.name.localeCompare(b.name);

// Renders `list` (a single node_type's nodes) as a collapsible tree: each
// root and each expanded node's children, recursively. Nodes collapse to
// just their top level by default (DESIGN.md UX方針) - this is what keeps a
// node's own row from also being duplicated by every descendant appearing
// in the same flat section. `compare` / `isExpanded` default to name order
// and the shared expanded set.
export function renderNodeTree(list, rowRenderer, { compare = byName, isExpanded = isNodeExpanded } = {}) {
  const childrenByParent = buildChildrenMap(list);
  const renderNode = (n, depth) => {
    const children = (childrenByParent.get(n.id) ?? []).sort(compare);
    const expanded = children.length > 0 && isExpanded(n.id);
    const row = rowRenderer(n, depth, children.length > 0);
    const childrenHtml = expanded ? children.map((c) => renderNode(c, depth + 1)).join('') : '';
    return row + childrenHtml;
  };
  const roots = (childrenByParent.get('root') ?? []).sort(compare);
  return roots.map((n) => renderNode(n, 0)).join('');
}
