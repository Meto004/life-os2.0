# 統合ツール（進捗トラッカー／筋トレトラッカー／スケジューラー）

- 作成: 2026-07-02
- ステータス: **動くプロトタイプ**（タブ統合＋Supabase同期まで実装済み。公開はまだ）
- 設計書: [`docs/superpowers/specs/2026-07-02-v2-integrated-tools-design.md`](../../../docs/superpowers/specs/2026-07-02-v2-integrated-tools-design.md)
- 位置づけ: v2.0で個別プロトタイプとして作った [#1スケジューラー](../scheduler/) [#2進捗トラッカー](../progress-tracker/) [#3筋トレトラッカー](../workout-tracker/) を1つのシェルにまとめ、`materials/hsk/`（HSK5 Trainer）と同じ方式でPC↔スマホ同期を追加したもの。

## ⚠️ 起動方法（他の単体プロトタイプと違う点）

`tools/*.js` を `type="module"` で読み込んでいるため、**ブラウザで直接ダブルクリック（`file://`）では動きません**。ローカルサーバー経由で開いてください。

```
npx --yes serve -l 5178 v2/prototypes/integrated
```

（このプロジェクトでは `.claude/launch.json` に `integrated-tools` として登録済み。Claude Codeのプレビュー機能から起動可）

## 構成

```
v2/prototypes/integrated/
  index.html            シェル（ヘッダー・タブ切替・同期バッジ・パスワードゲート）
  shared/base.css        3ツール共通スタイル（色変数・ボタン・カード等）
  shared/sync.js          Supabase同期＋パスワードゲート（HSKの仕組みを汎用化）
  tools/progress.js/css   進捗トラッカー（v2/prototypes/progress-tracker/ から移植）
  tools/workout.js/css    筋トレトラッカー（v2/prototypes/workout-tracker/ から移植）
  tools/scheduler.js/css  スケジューラー（v2/prototypes/scheduler/ から移植）
```

- 各ツールは元のlocalStorageキーをそのまま使用: `lifeos_progress_tracker_v2` / `lifeos_workout_tracker_v1` / `scheduler_v3`。
- `tools/*.js` は `type="module"` でスコープ分離（3ツールとも `state`/`render`/`save`/`uid` 等の同名変数・関数を使っているため、モジュール化しないと衝突してページ全体がクラッシュする）。
- `shared/sync.js` はこの3キーの中身を丸ごと同期するだけで、各ツールの内部データ形は一切意識しない疎結合設計。

## 同期の使い方

1. ヘッダー右上の同期バッジ（🔌）をクリック。
2. 初回はSupabaseの Project URL・anon public keyを入力（HSKアプリと同じプロジェクトを使い回しOK。下記「Supabaseセットアップ」参照）。
3. 「🆕新しい同期コードを作成」→ アプリパスワードを決める → 表示された同期コードをメモ。
4. 他の端末（スマホ等）で同じURLを開き、「🔑既存の同期コードで開く」→ 同じ同期コード＋パスワードを入力。
5. 以降は自動: 保存の度に2.5秒デバウンスでクラウドへpush、起動時にpullして新しい方を採用（最後に保存した端末が勝つ＝last-write-wins）。

**📷 写真（筋トレトラッカーの月1写真）は同期されません。** 機微度（体の画像）とSupabase無料枠の容量を考慮し、端末のlocalStorageのみに残す設計（詳細は設計書§3）。端末をまたいで見たい場合は筋トレトラッカーの「⇩エクスポート」を使う。

### ⚠️ パスワードについて（正直な注意点）
このパスワードは**気休めレベルの鍵**です。同期コードとSupabaseの接続情報が漏れれば、RPC経由でデータ自体は取得され得ます。本気の認証ではなく「たまたまURLを踏んだ人に中身をそのまま見せない」程度の効果として使ってください。

## Supabaseセットアップ（本人が実施）

1. https://supabase.com で無料プロジェクトを作成（**HSKアプリで既に作成済みなら使い回してOK**。新テーブルを追加するだけ）。
2. 左メニュー **SQL Editor** に下記を貼って Run:

```sql
create table if not exists public.lifeos_sync (
  id text primary key,          -- 同期コード
  data jsonb not null,          -- {progress, workout, scheduler, passwordHash, savedAt}
  updated_at timestamptz not null default now()
);
alter table public.lifeos_sync enable row level security;

create or replace function public.lifeos_pull(p_id text)
returns jsonb language sql security definer set search_path = public as $$
  select data from public.lifeos_sync where id = p_id;
$$;
create or replace function public.lifeos_push(p_id text, p_data jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.lifeos_sync(id, data, updated_at) values (p_id, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
$$;
grant execute on function public.lifeos_pull(text) to anon;
grant execute on function public.lifeos_push(text, jsonb) to anon;
```

3. Settings → **API** から `Project URL` と `anon public` キーをコピーし、アプリの同期設定画面に貼り付ける。
4. テーブルは直接アクセス不可（RLS）。`lifeos_pull`/`lifeos_push` 関数経由のみ、**同期コードを知っている人だけ**自分の行を読み書きできる。

## 公開・デプロイ方針（未実施・要確認）

設計書§4の通り、**新規の公開GitHubリポジトリ（例: `life-os-tools`）を作成しGitHub Pagesで公開する**予定。これは「外部への公開」に当たるため、実施時に改めて本人確認を取ってから行う。それまではこのプライベートリポジトリ（`v2/prototypes/integrated/`）内で開発・動作確認を完結させる。

## 動作確認済み（2026-07-02）
- タブ切替（進捗/筋トレ/スケジューラー）で3ツールとも元の機能通り動作（フェーズ開閉、ワンタップ完了、自動編成など）。DOM ID衝突（`btnExport`）はリネームで解消。console errorなし。
- 同期ゲートUI（設定→作成/ログイン→エラー表示）を模擬Supabase設定で動作確認。実際のPush/Pull成功パスは実Supabaseプロジェクト作成後に本人環境で要確認。

## 次にやること
- [ ] 本人がSupabaseプロジェクトを用意し、実際のPush/Pull・複数端末での同期を確認
- [ ] 公開リポジトリ作成・GitHub Pages公開（要確認のうえ実施）
- [ ] 進捗トラッカーの「📋スケジューラー用にコピー」を、同一シェル内でのタブ間ライブ連携に発展させる（現状はクリップボード経由の手動コピー）
