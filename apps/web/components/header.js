import { root, state, go } from '../state.js';
import { ICONS } from './iconButton.js';

// Fixed decorative layer behind the app shell: soft white cloud/wave
// silhouettes over the summer-sky gradient, per .web-ui-ref/Budget Sandbox -
// Natsu.html. Static markup, cheap to re-render.
export function renderSummerDecor() {
  return `
    <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:0;">
      <path d="M -40 820 C 70 720 130 742 186 676 C 232 622 262 652 322 610 C 378 570 356 494 430 462 C 502 430 556 476 598 522 C 640 568 682 566 742 608 C 802 650 842 626 900 668 C 962 712 1042 700 1102 750 C 1146 786 1196 796 1240 820 Z" fill="#ffffff" opacity="0.62" />
      <path d="M -40 820 C 70 720 130 742 186 676 C 232 622 262 652 322 610 C 378 570 356 494 430 462 C 502 430 556 476 598 522 C 640 568 682 566 742 608 C 802 650 842 626 900 668 C 962 712 1042 700 1102 750 C 1146 786 1196 796 1240 820" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.85" />
      <path d="M 640 820 C 700 764 742 780 790 736 C 836 694 880 706 934 676 C 986 648 1044 664 1092 636 C 1140 608 1180 618 1240 596 L 1240 820 Z" fill="#ffffff" opacity="0.34" />
    </svg>
  `;
}

// Global nav tabs: same weight, always visible. 'nodes' stays highlighted on
// ノード詳細 too - that page is a child of ノード一覧, not a separate
// top-level destination. 記録 is not a tab: it's the sheet behind 「+ 記録」.
const NAV_TABS = [
  ['dashboard', 'ダッシュボード', ['dashboard']],
  ['tx', '取引一覧', ['tx']],
  ['nodes', 'ノード一覧', ['nodes', 'detail']],
  ['analysis', '分析', ['analysis']]
];

// 1段のヘッダー: ロゴ・タブ・右にアプリ全体の操作「+ 記録」「設定」(README B2)。
// 設定はタブではないが、開いている間はボタンを選択状態にして現在地を示す。
export function renderHeader() {
  const tabsHtml = NAV_TABS.map(([id, label, owns]) => {
    const active = owns.includes(state.page);
    return `<button type="button" class="nav-tab${active ? ' active' : ''}" data-nav="${id}"${active ? ' aria-current="page"' : ''}>${label}</button>`;
  }).join('');
  const settingsOpen = state.page === 'settings';

  return `
    <header>
      <div class="header-inner">
        <button class="logo-btn" data-nav="dashboard">
          <span class="logo-text">Nodobo</span>
        </button>
        <nav class="nav-tabs">${tabsHtml}</nav>
        <div class="header-actions">
          <button type="button" class="btn-record" data-open-record>+ 記録</button>
          <button type="button" class="btn-settings" data-nav="settings" aria-pressed="${settingsOpen}">${ICONS.gear}設定</button>
        </div>
      </div>
    </header>
  `;
}

export function wireHeader() {
  root.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => go(el.dataset.nav));
  });
}
