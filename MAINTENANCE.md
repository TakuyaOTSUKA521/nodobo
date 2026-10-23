# nodobo — 保守戦略

Vibe Coding(Claude Codeによる継続的な機能追加)で起きがちな劣化に対処するための方針。
「機能を追加するセッション」と「整理するセッション」を意図的に分ける。

## 1. 変数の4分類

すべての状態変数は、この4つのいずれかに分類し、prefixで明示する。
分類できない変数を新しく作らない。

| prefix | 寿命 | 用途 | 例 |
|---|---|---|---|
| `state.*` | 1ページ滞在中のみ | `go(page)` で丸ごと差し替わる | `state.page` |
| `pref.*` | localStorageに永続 | 端末ごとの表示設定 | `pref.chartMode` |
| `cache.*` | 明示的に無効化するまで | サーバーから取得したデータの保持 | `cache.txListRows` |
| `ui.*` | 数クリック程度 | 今この瞬間の操作中の状態 | `ui.recordSlot` |

既存の変数(`chartMode` / `nodeViewMode` / `hiddenNodeIds` / `netWorthHidden` /
`recordSlot` / `selectedFromNode` / `txPeriod` / `txListRows`)は、この分類に沿って
リネームする。リネームのみのタスクとして単独で実施し、機能変更と混ぜない。

上記8変数は2026-09-19の整理セッションで `pref.*` / `ui.*` / `cache.*` への
リネームを完了済み。ただしこのリスト自体はその時点のもので、その後の機能追加
(アーカイブ・ノード管理モーダル・CSV書き出し等)で増えた以下の変数は未分類の
ままになっている。次回の整理セッションで分類・リネームする:

- 明らかに `cache.*`(サーバー由来データの保持): `nodesById` / `linesById` /
  `chartData` / `txListOffset` / `txListDone` / `sheetData`
  (`txListOffset`/`txListDone` は `cache.txListRows` と同じ無効化サイクルに
  乗っているので、本来は同じ `cache` オブジェクトにまとめるべき)
- 分類に判断が必要: `nodeCardFilter`(pref.*寄りだがlocalStorage永続の確認要)、
  `expandedNodeIds`(4分類のどれにも寿命がきれいに一致しない。
  4分類を拡張するか、変数の寿命設計自体を見直すか要判断)、`showArchivedNodes` /
  `selectedToNode` / `managerOpen` / `managerOpenedForNode` / `managerPrefillName` /
  `managerEditNode` / `managerPendingPromote`(ui.*寄りだが数クリックより長寿命)
  (`managerFrom` は2026-10-17の整理で、表示先の説明文と一緒に削除した)

2026-10-17 の UI 整理で増えた状態は分類どおりに置いた: 「表示を編集」の
`state.displayEditing`(ページ遷移で解除したいので `state.*`)、記録シート・編集シートの
開閉 `ui.sheet`(どの画面の上にも重なり、`go()` で消えては困るので `ui.*`)。
同日の画面構成の変更(記録タブの廃止)で `editingLineId` / `recordLeafNodeIds` /
`ui.seededEditLine` / `ui.resetRecordForm` / `prevPage`(と `goBack()`)は不要になり削除した。

2026-09-28のファイル分割(§3)で、これらの未分類変数は名前を変えずに置き場所だけ
移した。リネーム時はこの対応を起点にする:

- `apps/web/state.js`(複数ファイルから参照・再代入されるもの): `session` /
  `state` / `selectedToNode` / `nodesById` / `linesById` / `chartData` /
  `txListOffset` / `txListDone`、および `pref` / `ui` / `cache`。ESモジュールの
  importは再代入できないため、再代入は `setSession()` などの `set*()` 経由
- 1ファイル内でしか使わないものはそのファイルのモジュール変数:
  `nodeCardFilter` / `showArchivedNodes`(views/nodes.js)、`expandedNodeIds`
  (components/collapsibleTree.js)、`sheetData`(views/recordSheet.js)、`managerOpen` /
  `managerOpenedForNode` / `managerEditNode` / `managerPendingPromote` /
  `managerPrefillName`(views/manager.js)
- `cache.*` にまとめる際は `set*()` も不要になる(オブジェクトのプロパティ代入は
  import先からでもできる)

## 2. UIパターンの重複排除

以下は、複数画面に実装が散っている疑いがある(UX.md §4 に使用箇所の一覧が
あるが、一覧は常にコード側を `grep` して都度確認する)。1つずつ、以下の手順で潰す。

- カード + `.card-head`
- マスクトグル(🐵/🙈)
- 折りたたみ式ツリー
- 期間セレクタ
- ページネーション

**手順(機能変更を混ぜない)**

1. 対象パターンについて `grep` で実装箇所を数え、報告のみ行う(コードは書かない)
2. 統一可能なら `components/` 配下に1関数として抽出する提案をする
3. 承認後、各画面の重複実装を削除して抽出した関数の呼び出しに置き換える

期間セレクタは3画面で非連動という既知の制限がある。統一するかどうかは
UXの判断が要るため、抽出だけ行い連動させるかは別途判断する。

**2026-10-17 の整理で済んだもの**(`design_handoff_ui_refresh/02_cleanup.md` を承認済みの
仕様として実施): 期間セレクタは `components/periodSegment.js` に抽出し4画面を置き換えた
(連動はさせない — 画面ごとに状態を持つ方針で確定)。マスクトグルは
`maskToggle.js` の「表示を編集」中だけ出す形に統一した。あわせてセグメント
(`segmented.js`)・トグルチップ(`toggleChip.js`)・アイコンボタン(`iconButton.js`)・
確認ダイアログ(`confirmDialog.js`、`window.confirm()` をすべて置き換え)を作った。
残りはカード + `.card-head` とページネーション。

## 3. ファイル分割

**2026-09-28に実施済み。** `apps/web/index.html`(約2600行)を、ビルド不要のまま
ネイティブESモジュールに分割した。関数本体は行単位で移しただけで、機能変更・
リネームは含まない。現在の構成:

```
apps/web/
├── index.html              骨組み(head・importmap)と render()/ルーティングのみ
├── style.css               全CSS
├── state.js                state/pref/ui/cache・共有変数と set*()、go()、
│                           invalidateTxCache()、render() の中継(setRenderer)
├── views/
│   ├── login.js / dashboard.js / transactions.js
│   ├── recordSheet.js      記録シート / 取引の編集シート(どの画面の上にも重なる)
│   ├── nodes.js / nodeDetail.js
│   ├── composition.js(分析タブ) / settings.js(CSV書き出し・ログアウト含む)
│   └── manager.js          ノード管理モーダル
├── components/
│   ├── maskToggle.js       マスク・「表示を編集」
│   ├── periodSelector.js / periodSegment.js   期間の範囲計算 / 期間セグメント
│   ├── segmented.js / toggleChip.js / iconButton.js / confirmDialog.js
│   ├── collapsibleTree.js
│   ├── txRow.js            取引行の描画(行タップは index.html が一括で受けて編集シートへ)
│   ├── recordForm.js       記録フォーム(記録シートと編集シートで共用)
│   ├── barChart.js         ノード詳細の棒グラフ
│   └── header.js           ヘッダ・ナビタブ・背景装飾
└── lib/
    ├── format.js           esc/yen/日付
    ├── nodes.js            NODE_TYPE_META、loadAllNodesWithPaths 等
    └── supabase.js         Supabaseクライアントとmemo鍵(ここだけtop-level await)
```

当初案との差分:

- `components/cardHead.js` は作っていない。`.card-head` は関数ではなくHTMLに
  直書きされたクラスなので、関数化は §2 の重複排除として別途行う
- 期間セレクタは当初 `periodSelector.js` に共有部分(`SPEND_PERIODS` /
  `periodRange`)だけを置いていた。2026-10-17 に `periodSegment.js` へ抽出済み(§2)
- ドーナツ図・多層ドーナツ(composition.js)・スパークライン(nodes.js)は1画面でしか使わない
  ためview側に残した

守るルール:

- 1画面・1コンポーネントにつき1ファイル。「取引一覧を直したい」という指示で
  触るファイルが `views/transactions.js` 1つに絞られる状態を保つ
- 参照の向きは `index.html → views/ → components/ → lib/・state.js` の一方向。
  views は `render()` を state.js 経由で呼び、index.html を import しない
  (循環importを作らない)
- 新しいファイルを足したら `sw.js` の `SHELL_ASSETS` にも追加する

## 4. 機械的なチェック

CLAUDE.mdの禁止事項を、実行して確認できるスクリプトにする。

```bash
#!/bin/bash
# scripts/check.sh
set -e
grep -rn "supabase\.from" apps/ && { echo "NG: apps/* から直接クエリしている"; exit 1; }
grep -rn "WITH RECURSIVE" packages/core apps/ && { echo "NG: 再帰がビュー外にある"; exit 1; }
echo "OK"
```

push前に実行する。CLAUDE.mdの禁止事項を追加・変更したら、このスクリプトにも
検出ルールを追加する。

## 5. データ整合性の自動検証

UIのテストは持たないが、以下は自動化する。財務データなので、
これだけは壊れたら即座に分かるようにしておく。

- 全ノードの残高合計が常に0であること(ゼロサム)
- 別ユーザーでログインすると他人のノードが0件であること(RLS)

`packages/core` に対する簡単なスクリプトとして実装し、スキーマ変更後に毎回実行する。

## 6. セッションの分離

奇数回・偶数回のように機械的に分けなくてよいが、**1セッションで
「機能追加」と「整理」を混ぜない**。整理セッションでは冒頭でこう指示する。

```
今回は新機能を追加しない。以下だけ行う:
- 変数の分類(1)とリネーム
- 重複パターンの抽出(2)
- 死んでいるコード(未実装ボタン、使われていない設定項目)の削除
- DESIGN.md を実装に合わせて更新
```

## 7. 死んでいる機能の扱い

「ボタンはあるが押すとアラートが出るだけ」「設定項目があるが変更できない」
という状態を放置しない(UX.md §9 に既知の一覧があるが、都度コードを読んで洗い出す)。
整理セッションのたびに、
実装するか削除するかをその場で決める。見せかけのUIはコードを読む際の
ノイズであり、機能追加時に誤って前提にされる原因にもなる。
