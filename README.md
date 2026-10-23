<p align="center">
  <img src="image/nodobo-ios-512.png" width="96" alt="nodobo icon" />
</p>

<h1 align="center">nodobo</h1>

<p align="center">
  「財布もマクドナルドも食費も、全部同じ『ノード』」という発想で作っている個人用の資産管理・家計簿アプリです。<br>
  Supabase（Postgres + Auth）と、それを薄く叩くだけの Node.js CLI / 静的 Web ページで構成しています。
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

> [!NOTE]
> これは筆者が自分の家計を管理しながら「アプリを1本ちゃんと設計してみる」ために作っている個人開発・学習用のプロジェクトです。
> 商用サービスではなく、フルタイムでメンテナンスされている保証もありません。仕組みに興味がある方向けに公開しています。

## これは何

一般的な家計簿アプリは「財布」「銀行口座」「食費カテゴリ」などを別々の概念として扱いますが、このアプリでは全部を同じ `nodes` テーブルの行として扱います。取引は必ず「ノードからノードへの移動」として1本の `lines` レコードに記録され、残高や収支はすべてそこから導出（ビューで集計）します。

設計の詳細（スキーマ・仕訳パターン・UX方針）は [`DESIGN.md`](./DESIGN.md) に、開発時の設計原則・禁止事項は [`CLAUDE.md`](./CLAUDE.md) にまとめてあります。

### 特徴

- **一次情報は取引 (`lines`) のみ**。残高・構成比・純資産の推移などはすべて Postgres のビューから導出し、アプリ側では集計しない
- **すべてがノード**。財布・銀行・クレカ・支出先・収入源を `asset` / `liability` / `flow` の3種類 + 親子階層だけで表現
- **1取引 = 2ノード**の複式的な記録で、金額の整合性はスキーマレベルで担保
- 階層やノード種別の整合性は **DB のトリガーで保証**（アプリ側では検証しない）
- スマホのホーム画面に追加できる簡易 PWA 対応の Web UI

### 技術スタック

| 領域 | 使っているもの |
|---|---|
| DB / Auth | [Supabase](https://supabase.com/)（Postgres, Row Level Security, Auth） |
| バックエンドロジック | `packages/core`（素の JS、フレームワーク非依存） |
| CLI | Node.js（`apps/cli`） |
| Web | ビルドツールなしの静的 HTML + ES Modules（`apps/web`） |
| ホスティング | [Vercel](https://vercel.com/) |

## ディレクトリ構成

```
nodobo/
├── CLAUDE.md               開発方針・禁止事項のサマリ
├── DESIGN.md                設計の詳細（スキーマ定義を含む）
├── supabase/
│   └── migrations/          スキーマの唯一の正
├── packages/core/            Supabase を叩く唯一の層
│   ├── client.js             接続・Auth
│   ├── nodes.js               ノードのCRUD・階層操作
│   ├── lines.js                取引の登録・修正・削除
│   ├── reports.js              ビューを叩く集計関数（JOIN/GROUP BYは書かない）
│   └── types.ts                 supabase gen types の自動生成物
└── apps/
    ├── cli/                    core を呼ぶだけの CLI
    └── web/                    core を呼ぶだけの静的 Web UI
        ├── index.html            骨組みとルーティング
        ├── views/                画面ごとのモジュール
        ├── components/           画面をまたぐ UI 部品
        └── lib/                  整形関数・Supabase クライアント
```

`apps/*` は `packages/core` しか import せず、テーブル名・カラム名が登場するのは `packages/core` の中だけ、という参照ルールを敷いています（詳細は `CLAUDE.md`）。

## セットアップ

### 1. Supabase プロジェクトを用意する

1. [Supabase](https://supabase.com/) で新規プロジェクトを作成
2. [Supabase CLI](https://supabase.com/docs/guides/cli) をインストールし、このプロジェクトにリンク
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
3. マイグレーションを適用
   ```bash
   supabase db push
   ```
4. Authentication でメール/パスワード認証を有効にし、自分用のアカウントを1つ作成
   （後述の「公開にあたって注意していること」も参照してください）

### 2. 環境変数を用意する

```bash
cp .env.example .env
```

`.env` に Supabase の URL / anon key と、CLI ログイン用のメールアドレス・パスワード、メモ暗号化用の鍵を設定します。値の説明は `.env.example` のコメントを参照してください。

### 3. 依存関係のインストール

```bash
npm install
```

### 4. CLI を使う

```bash
node apps/cli/signup.js you@example.com yourpassword   # 初回のみ
node apps/cli/nodes.js                                  # ノード一覧
node apps/cli/add.js                                    # 取引を記録
node apps/cli/summary.js                                # 集計を確認
```

### 5. Web UI を使う

Web UI は `apps/web/packages` に `packages/core` をコピーしてから配信します。

```bash
npm run build
npx serve apps/web   # 好きな静的サーバーで可
```

Supabase の URL / anon key は `apps/web/lib/supabase.js` に直接埋め込んであります（後述のとおり、公開しても問題ない前提の鍵です）。自分のプロジェクトで動かす場合はここを書き換えてください。

## 公開にあたって注意していること

このリポジトリは実際に自分の家計データを保存している本番の Supabase プロジェクトに接続する設定を含んだまま公開しています。オープンソースとして誰でも読める状態にすることで生まれるリスクと、その対策を整理しておきます。

| リスク | 対策 |
|---|---|
| `.env`（本物の認証情報・暗号鍵）をうっかりコミットしてしまう | `.gitignore` で常に除外。過去のコミット履歴にも含まれていないことを確認済み |
| Supabase の URL・anon/publishable key がコード中に見える（`apps/web/lib/supabase.js`, `vercel.json`） | これはクライアントサイドで動くアプリである以上不可避で、Supabase 側もこの鍵は「公開されて構わない」設計にしている。実データへのアクセス制御は鍵の秘匿ではなく **Row Level Security（RLS）** で行っている。全テーブルで RLS を有効化し、`user_id = auth.uid()` を要求するポリシーのみを許可 |
| RLS が効かないビューが混ざる | ビュー作成時に必ず `security_invoker = true` を付ける運用を徹底（`CLAUDE.md` の禁止事項）。新しいビューを追加する際もこの点をレビューする |
| GitHub 上で公開鍵を見つけた bot 等による signup 乱用（迷惑メール送信・無関係アカウントの大量作成） | Supabase 側で新規サインアップを無効化する、またはメール確認必須・reCAPTCHA を有効化することを推奨。現状は自分専用アプリとして運用し、他人が使うことを想定していない |
| メモ欄の暗号化鍵 (`MEMO_ENCRYPTION_KEY`) もコード中に見える | この鍵は「Supabase ダッシュボード（service_role 接続、RLS を素通りする）から平文メモを見えなくする」ためのものであり、**アプリの利用者本人（＝鍵を知っている自分）からメモを隠す用途ではない**。クライアントサイドで完結する以上、ソースを読める人からは原理的に秘匿できない設計であることを `packages/core/crypto.js` のコメントに明記している |
| 取引データを誤って上書き・物理削除してしまう | `lines` は物理削除せずバージョニングで扱う設計にしている（`CLAUDE.md` の禁止事項） |

**もしこのコードを自分用に動かす場合は**、必ず自分の Supabase プロジェクトを新規に作り、`apps/web/lib/supabase.js` 内の URL・anon key と `.env` の値をすべて自分のものに差し替えてください。他人の鍵を流用したり、このリポジトリの鍵をそのまま使ったりしないでください。

## 今後やりたいこと（TODO）

- 外貨・複数通貨対応の実装
- CSV インポート
- モバイルでの使い勝手のさらなる改善

## Contributing

個人の学習用プロジェクトのため積極的な機能追加の募集はしていませんが、バグ報告や設計への疑問点などは Issue で歓迎します。Pull Request を送る場合は `CLAUDE.md` / `DESIGN.md` の設計原則（特に「一次情報は `lines` のみ」「集計はビューにのみ書く」）から外れないようご協力ください。

## ライセンス

[MIT License](./LICENSE) の下で公開しています。コードの再利用・改変・商用利用も自由ですが、無保証です（詳細はライセンス本文を参照）。特に金融データを扱うアプリという性質上、実運用する場合は自己責任でお願いします。
