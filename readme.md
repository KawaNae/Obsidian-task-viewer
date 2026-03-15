# Obsidian Task Viewer Plugin

事前コミットメントを主体としたタスク管理プラグインです。タスクの開始、終了、締め切りを事前に指定し、タイムラインビューで視覚的に管理できます。

## クイックスタート

1. **タスクを作成**
   ```markdown
   - [ ] 会議 @2026-02-05T14:00>15:00
   ```

2. **タイムラインビューを開く**
   - コマンドパレット → "Task Viewer: Open Timeline View"

3. **タスクを操作**
   - タスクカードをドラッグ&ドロップで移動・調整

## インストール

### 手動インストール

1. このリポジトリをクローン
2. `npm install` で依存関係をインストール
3. `npm run build` でビルド
4. `main.js`、`manifest.json`、`styles.css` をVaultの`.obsidian/plugins/obsidian-task-viewer/`にコピー

---

## タスクの記述方法

本プラグインでは、2つの方法でタスクを定義できます。

### 1. インライン記法（推奨）

マークダウンファイルの任意の場所にタスクを記述する方法です。

#### 基本構文

基本構成として`@start>end>due`という構成をとります。

```markdown
- [ ] @2001-11-11>2001-11-12>2001-11-13  <!-- 完全な記法(SED型) -->

- [ ] @2001-11-11>2001-11-12  <!-- 締め切りの省略(SE型) -->
- [ ] @2001-11-11>>2001-11-13  <!-- 終了の省略(SD型) -->
- [ ] @>2001-11-12>2001-11-13  <!-- 開始の省略(ED型) -->

- [ ] @2001-11-11  <!-- 開始のみの指定(S-All型) -->
- [ ] @>2001-11-12  <!-- 終了のみの指定(E型) -->
- [ ] @>>2001-11-13  <!-- 締め切りのみの指定(D型) -->
```

#### 時刻の指定

時刻を指定する場合は`YYYY-MM-DDTHH:mm`または`HH:mm`の形式で指定します。

```markdown
- [ ] @2001-11-11T12:00  <!-- 開始のみの指定(S-Timed型) -->
- [ ] @2001-11-11T12:00>13:00  <!-- 同日の場合、日付省略可 -->
- [ ] @2001-11-11T12:00>2001-11-12T12:00
- [ ] @2001-11-11T12:00>2001-11-12T12:00>2001-11-13T12:00
```

#### 子タスクの扱い

@記法を持つタスクは独立したタスクカードを生成します。インデントされた行は親タスクのカード内に表示されます。

```markdown
- [ ] 会議 @2026-01-28T15:45>16:30>2026-01-31
    - [ ] 準備 @14:15>15:45      # 親の日付を継承
    - [ ] 片付け @16:30>17:00    # 親の日付を継承
    - [ ] 報告 @>>2026-01-30     # 明示的な締切
```

**日付継承**: 子タスクで時刻のみ（`HH:mm`）を指定すると、親タスクの日付を自動継承します。

### 2. Frontmatter記法

ファイル全体を1つのタスクとして扱う方法です。プロジェクト管理や日次ノートに便利です。

#### 基本構文

```yaml
---
tv-start: 2026-02-05
tv-end: 2026-02-07
tv-due: 2026-02-10
tv-status: ' '
tv-content: プロジェクト名
---

本文やサブタスクをここに記述
- [ ] サブタスク1
- [ ] サブタスク2
```

#### フィールド

| フィールド | 必須 | 説明 | 例 |
|-----------|------|------|-----|
| `tv-start` | ○* | 開始日時 | `2026-02-05` または `2026-02-05T14:00` |
| `tv-end` | | 終了日時 | `2026-02-07` または `2026-02-07T18:00` |
| `tv-due` | | 締切日時 | `2026-02-10` または `2026-02-10T23:59` |
| `tv-status` | | タスクステータス（省略時は` `） | `x`, `-`, `!` など |
| `tv-content` | | タスク名（省略時は空。表示時はファイル名がフォールバック） | `プロジェクト名` |
| `tv-color` | | タスクカードの色 | `red`, `#ff0000` |
| `tv-linestyle` | | タスクカードの線スタイル | `solid`, `dashed`, `dotted`, `double`, `dashdotted` |
| `tags` | | タグ（Obsidian標準の`tags`キーと共有、キー名はカスタマイズ可） | `#meeting`, `#work` |
| `tv-timer-target-id` | | タイマー連携用ID（自動設定） | |
| `tv-ignore` | | `true` でスキャン対象から除外 | `true` |

> [!NOTE]
> `tv-start`, `tv-end`, `tv-due`のいずれか1つは必須です。

> [!WARNING]
> 時刻のみを記述する場合は、YAMLのsexagesimal記法を回避するため`"14:00"`のようにクォートで囲んでください。

> [!NOTE]
> `tv-content` を省略した場合、UI表示ではファイル名がフォールバックとして使われます。

#### 使用例

**プロジェクト管理**
```yaml
---
tv-start: 2026-02-01
tv-end: 2026-02-15
tv-due: 2026-02-20
tv-content: ウェブサイトリニューアル
---

## サブタスク
- [ ] デザイン案作成 @2026-02-01>2026-02-05
- [ ] 実装 @2026-02-06>2026-02-12
- [ ] テスト @2026-02-13>2026-02-15
```

**日次ノート**
```yaml
---
tv-start: 2026-02-05
tv-content: 2026-02-05の計画
---

## タスク
- [ ] 朝のミーティング @09:00>10:00
- [ ] ドキュメント作成 @14:00>16:00
```

#### Frontmatterタスクの子要素表示ルール（v0.13.1）

frontmatterタスクでは、子要素の表示範囲を次のように定義します。

1. 対象は設定された見出し（`Frontmatter Task Header` / `Frontmatter Task Header Level`）配下のみ
2. その見出し配下で、**最初の連続リストブロック**のみ表示対象
3. リスト項目はチェックボックス付き（`- [ ]`）だけでなく、通常の箇条書き（`-`）と番号付き（`1.`）も対象
4. ネストされた子孫行も表示対象
5. 空行、またはルートレベルの非リスト行で連続ブロックは終了
6. 見出し外のリストや後続ブロックは表示対象外

> [!NOTE]
> frontmatterカードの子トグルは1セットのみ描画されます（重複表示しません）。

---

## コマンド（繰り返しタスク）

タスク完了時に自動実行されるコマンドを`==>`の後に記述します。

### 基本構文

```markdown
- [ ] タスク名 @日付 ==> コマンド名(引数)
```

### 利用可能なコマンド

#### next(期間)
タスク完了時に、コマンドを削除した新しいタスクを生成します。

```markdown
- [ ] 週次レビュー @2026-01-01 ==> next(1week)
# 完了後:
- [x] 週次レビュー @2026-01-01 ==> next(1week)
- [ ] 週次レビュー @2026-01-08
```

#### repeat(期間)
タスク完了時に、コマンドを維持した新しいタスクを生成します。

```markdown
- [ ] 毎日の振り返り @2026-01-01 ==> repeat(1day)
# 完了後:
- [x] 毎日の振り返り @2026-01-01 ==> repeat(1day)
- [ ] 毎日の振り返り @2026-01-02 ==> repeat(1day)
```

#### move(ファイルパス)
タスク完了時に、タスク行を指定したファイルに移動します。

```markdown
- [ ] 完了したらログへ @2026-01-01 ==> move([[log.md]])
```

### 期間の指定

| 記法 | 意味 |
|-----|------|
| `1day` / `1days` | 1日 |
| `1week` / `1weeks` | 1週間（7日） |
| `1month` / `1months` | 1ヶ月 |
| `1year` / `1years` | 1年 |

---

## タイムラインビューの操作

### 基本操作

**すべてのビューで共通**
- **タスク完了**: チェックボックスをクリック
- **削除**: 右クリック → Delete
- **複製**: 右クリック → Duplicate
- **ファイルを開く**: 右クリック → Open

### タスクカードの移動と編集

#### タイムライン欄
時刻を持つ24時間未満のタスクを表示します。

- **移動ハンドル**: タスクカードをドラッグして時刻を変更
- **伸縮ハンドル**: 上下の端をドラッグして開始・終了時刻を調整

#### 終日タスク欄/All Day
24時間以上のタスクや、時刻のないタスクを表示します。

- **移動ハンドル**: タスクカードをドラッグして日付を変更
- **伸縮ハンドル**: 左右の端をドラッグして開始・終了日を調整

### 日付の扱い

「設定された開始時刻」を日付の境界とします。デフォルトでは5:00です。

- `@2026-02-05T05:00` → 2026-02-05のタスク
- `@2026-02-05T04:00` → 2026-02-04のタスク（前日扱い）

---

## ビュー

本プラグインは6つのビューを提供します。いずれもコマンドパレットから開けます。

| ビュー | コマンド | 説明 |
|--------|---------|------|
| Timeline View | `Task Viewer: Open Timeline View` | 24時間タイムライン＋終日タスク欄 |
| Schedule View | `Task Viewer: Open Schedule View` | リスト形式のスケジュール表示 |
| Calendar View | `Task Viewer: Open Calendar View` | 月間カレンダー表示 |
| Mini Calendar | `Task Viewer: Open Mini Calendar View` | コンパクトなカレンダー（サイドバー向け） |
| Timer View | `Task Viewer: Open Timer View` | ポモドーロ / カウントダウン / カウントアップ / インターバルタイマー |
| Kanban View | `Task Viewer: Open Kanban View` | カンバンボード表示 |

---

## 設定

設定は6つのタブに分かれています: General / Views / Notes / Timer / Frontmatter / Habits

### 主要設定

| 設定項目 | 説明 | デフォルト |
|---------|------|-----------|
| Start Hour | 1日の開始時刻（0-23） | 5 |
| Complete Status Chars | 完了を示すステータス文字 | `['x', 'X', '-', '!']` |
| Enable Status Menu | チェックボックス長押しでステータスメニュー表示 | `true` |
| Task Select Action | タスク選択操作（click / dblclick） | `click` |
| Long Press Threshold | 長押し判定時間（ms） | 400 |
| Frontmatter Task Header | 子タスク挿入先の見出しテキスト | `Tasks` |
| Frontmatter Task Header Level | 見出しレベル（2 = `##`） | 2 |
| Frontmatter Task Keys | Frontmatterキー名（個別にカスタマイズ可） | `tv-start` / `tv-end` / `tv-due` / `tv-status` / `tv-content` / `tv-timer-target-id` / `tv-color` / `tv-linestyle` / `tags` / `tv-ignore` |
| Default View Positions | ビューごとのデフォルト表示位置 | Timeline: tab, Schedule: right, Calendar: tab, Mini Calendar: left, Timer: right, Kanban: tab |
| Pomodoro Work/Break Minutes | ポモドーロの作業/休憩時間 | 25 / 5 |
| Countdown Minutes | カウントダウンのデフォルト時間 | 25 |
| Calendar Week Start Day | カレンダーの週開始曜日 | 0（日曜） |
| Calendar Show Week Numbers | ISO週番号を表示 | `false` |
| Reuse Existing Tab | 同じビュータイプのタブを再利用 | `true` |
| Editor Menu For Tasks | エディタメニューでタスク操作を表示 | `true` |
| Editor Menu For Checkboxes | エディタメニューでチェックボックス操作を表示 | `true` |
| Hide View Header | ビューヘッダーを非表示 | `true` |
| Mobile Top Offset | モバイルでの上部オフセット（px） | 32 |
| Pinned List Page Size | ピン留めリストのページサイズ | 10 |
| Suggest Color | プロパティパネルで色の候補を表示 | `true` |
| Suggest Linestyle | プロパティパネルで線スタイルの候補を表示 | `true` |
| Suggest Sharedtags | プロパティパネルでタグの候補を表示 | `true` |
| View Template Folder | ビューテンプレートの保存先 | *(空)* |
| Interval Template Folder | インターバルテンプレートの保存先 | *(空)* |

---

## CLI (Experimental)

> [!WARNING]
> CLI サポートは試験的機能です。Obsidian v1.12.2+ の CLI API を使用しています。コマンド名やパラメータは今後変更される可能性があります。

Obsidian CLI から本プラグインのタスクデータにアクセスできます。Obsidian が起動中である必要があります。

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `obsidian-task-viewer:list` | タスク一覧（フィルタ/ソート/ページネーション対応） |
| `obsidian-task-viewer:today` | 本日アクティブなタスク |
| `obsidian-task-viewer:get` | ID指定で単一タスク取得 |
| `obsidian-task-viewer:query` | ビューテンプレートによるクエリ |
| `obsidian-task-viewer:create` | 新規インラインタスク作成 |
| `obsidian-task-viewer:update` | タスク更新 |
| `obsidian-task-viewer:delete` | タスク削除 |

### 使用例

```bash
obsidian obsidian-task-viewer:list vault=MyVault tag=work format=json
obsidian obsidian-task-viewer:today vault=MyVault
obsidian obsidian-task-viewer:create vault=MyVault file=DailyNotes/2026-03-15.md content="Meeting" start="2026-03-15T14:00" end="15:00"
```

---

## Public API (Experimental)

> [!WARNING]
> Public API は試験的機能です。メソッドのシグネチャや返却型は今後変更される可能性があります。

他のプラグインや DataviewJS から本プラグインの機能にアクセスできます。

### アクセス方法

```javascript
const api = app.plugins.plugins['obsidian-task-viewer'].api;
```

### メソッド一覧

| メソッド | 説明 | 同期/非同期 |
|---------|------|-----------|
| `api.list(params?)` | タスク一覧 | sync |
| `api.today(params?)` | 本日のタスク | sync |
| `api.get({ id })` | 単一タスク取得 | sync |
| `api.query({ template })` | テンプレートクエリ | async |
| `api.create({ file, content, ... })` | タスク作成 | async |
| `api.update({ id, ... })` | タスク更新 | async |
| `api.delete({ id })` | タスク削除 | async |

### DataviewJS 使用例

```dataviewjs
const api = app.plugins.plugins['obsidian-task-viewer'].api;
const result = api.today({ sort: [{ property: 'startDate' }] });

dv.table(
  ['Status', 'Time', 'Content'],
  result.tasks.map(t => [
    t.statusChar === ' ' ? '⬜' : '✅',
    [t.effectiveStartTime, t.effectiveEndTime].filter(Boolean).join('–') || '—',
    t.content,
  ])
);
```

---

## トラブルシューティング

### 同期環境での使用

複数デバイス間でObsidianを同期している場合（obsidian-self-hosted-livesyncなど）、タスク完了時のコマンドはローカル操作を行ったデバイスでのみ実行されます。同期先のデバイスでは重複実行されません。

> [!NOTE]
> 複数デバイスで**同時に**同じファイルを操作した場合、誤検出の可能性があります。通常の使用（片方のデバイスで操作、他方は同期のみ）では問題ありません。

---

## 開発者向け情報

実装の詳細、タスク型の仕様、CSS命名規則などは[DEVELOPER.md](./DEVELOPER.md)をご覧ください。

---

## ライセンス

MIT License
