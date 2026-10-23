# nodobo — 開発ガイド

個人用の資産管理・家計簿アプリ。Supabase + Node.js CLI + 静的Webページ。

**作業を始める前に必ず `DESIGN.md` を読むこと。**
スキーマ定義・ビュー定義・仕訳パターン・UX方針はすべてそちらにある。
このファイルは要約と禁止事項のみ。

**整理・リファクタリングの指示を受けたら `MAINTENANCE.md` に従うこと。**
変数の分類、重複UIパターンの抽出手順、ファイル分割方針が書かれている。
機能追加の指示と整理の指示を同じセッションで混ぜない。

## 設計原則

この4つは絶対に守ること。逸脱する提案をしない。

1. **一次情報は `lines`(取引)のみ。** 残高・集計・分析はすべてそこから導出する。
2. **すべてをノードとして扱う。** 財布・銀行・クレカ・マクドナルド・バイト先・食費は、
   すべて同じ `nodes` テーブルの行。`node_type` で3値分類し、`parent_id` で階層を作る。
3. **1取引 = 2ノード。** `from_node` / `to_node` / `amount` の1行で表す。
   3ノード以上が必要な場面は、複数の取引に分けて記録する。
4. **集計ロジックはビューにのみ書く。** アプリケーションコードに集計を書かない。
5. **記録先は葉ノードのみ。** 中間ノード(食費、外食)には直接記録しない。
   分類しきれない分は各階層の `その他(...)` 葉ノードに入れる。
6. **整合性は DB で守る。** 階層の制約はトリガーとして実装し、
   アプリケーション側で検証しない。

## 禁止事項

- `nodes` に `balance` カラムを追加しない。残高は `lines` の累積和で計算する
- `apps/*` から Supabase クライアントを直接呼ばない。必ず `packages/core` 経由
- 集計クエリを JS 側に書かない。ビューを追加して `reports.js` から呼ぶ
- スキーマをダッシュボードから直接変更しない。`supabase/migrations` に書く
- `.env` をコミットしない
- 取引行を物理削除・上書きしない。バージョニングで扱う
- `WITH RECURSIVE` を `packages/core` や `apps/*` に書かない。`v_node_tree` を使う
- 子ノードに親と異なる `node_type` を設定しない
- ラベル名(消費/浪費など)をコードやスキーマにハードコードしない。
  `labels` はユーザーが自由に変更できるデータとして扱う
- ビューを作るとき `security_invoker = true` を省略しない。RLS が効かなくなる
- 再帰ビューから `user_id` を落とさない。他人のノードが混ざる
- 記録のある葉ノードに直接子を追加しない。`promoteToParent` の手順を踏む

## ディレクトリ構成

```
nodobo/
├── CLAUDE.md
├── DESIGN.md                  設計の詳細(スキーマ定義を含む)
├── supabase/
│   └── migrations/            スキーマの唯一の正
├── packages/core/
│   ├── client.js              Supabase接続とAuth
│   ├── nodes.js               ノードのCRUD・階層操作・検索・サジェスト
│   ├── lines.js               取引の登録・修正・削除
│   ├── reports.js             ビューを叩く集計関数
│   └── types.ts               supabase gen types で自動生成
└── apps/
    ├── cli/                   core を呼ぶだけ
    └── web/                   core を呼ぶだけ(ビルド不要のESモジュール)
        ├── index.html         骨組みとルーティングのみ
        ├── state.js           画面をまたぐ状態変数と go()
        ├── views/             1画面1ファイル
        ├── components/        複数画面で使うUI部品
        └── lib/               整形関数・Supabaseクライアント
```

## 参照のルール

```
apps/cli  ─┐
           ├→ packages/core → views → tables
apps/web  ─┘
```

- `apps/*` が import してよいのは `packages/core` だけ
- テーブル名・カラム名が登場するのは `packages/core` の中だけ
- `reports.js` はビューを select するだけ。JOIN や GROUP BY を書かない
- `apps/web` 内は `index.html → views/ → components/ → lib/・state.js` の一方向。
  views/ から index.html や他の views/ を import しない(MAINTENANCE.md §3)

## 作業の進め方

- 機能単位で区切る。一度に複数の機能をまたぐ変更をしない
- スキーマを変更する時は、必ず新しいマイグレーションファイルを作る
- 既存のマイグレーションファイルを編集しない
- 型を変更したら `supabase gen types typescript --linked > packages/core/types.ts` を実行する

## このファイルと DESIGN.md の変更について

- 設計原則・禁止事項を、実装の都合で緩めない。
  制約が邪魔になった場合は、勝手に書き換えず、理由を説明して判断を仰ぐ
- 設計変更が必要になったら、`DESIGN.md` を先に更新してから実装する
- どちらのファイルを変更する場合も、変更理由を明記する
