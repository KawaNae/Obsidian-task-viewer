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

### 共通フラグ

| フラグ | 説明 | デフォルト |
|-------|------|-----------|
| `vault` | 対象Vault名（必須） | — |
| `format` | 出力形式: `json`, `tsv`, `jsonl` | `json` |
| `outputFields` | 出力フィールド（カンマ区切り） | `id` |

### コマンド一覧

#### list — タスク一覧

フィルタ・ソート・ページネーション付きでタスクを取得します。

```bash
obsidian obsidian-task-viewer:list vault=MyVault tag=work format=json outputFields=content,status,startDate
```

**フィルタフラグ:**

| フラグ | 説明 | 例 |
|-------|------|-----|
| `file` | ファイルパスで絞り込み（`.md` は自動補完） | `file=DailyNotes/2026-03-15` |
| `status` | ステータス文字（カンマ区切り） | `status=x,-` |
| `tag` | タグ名（カンマ区切り、`#` は自動除去） | `tag=work,reading` |
| `content` | コンテンツの部分一致 | `content=会議` |
| `date` | 指定日にアクティブなタスク | `date=today` |
| `from` | 開始日 >= 指定値 | `from=2026-03-01` |
| `to` | 終了日 <= 指定値 | `to=2026-03-31` |
| `due` | 締切日 = 指定値 | `due=today` |
| `leaf` | 子タスクを持たないタスクのみ | `leaf=true` |
| `property` | カスタムプロパティ（`key:value` 形式） | `property=priority:high` |
| `filter` | FilterState JSON（上記フラグより優先） | `filter={"root":...}` |

> `date` と `from`/`to` を同時指定した場合、`date` が優先されます。

**ソート・ページネーション:**

| フラグ | 説明 | 例 |
|-------|------|-----|
| `sort` | ソートルール（`property[:direction]` カンマ区切り） | `sort=startDate:asc,due:desc` |
| `limit` | 最大件数 | `limit=50`（デフォルト: 100） |
| `offset` | スキップ件数 | `offset=10` |

**ソート可能プロパティ:** `content`, `due`, `startDate`, `endDate`, `file`, `status`, `tag`

#### today — 本日のタスク

`list date=today` のショートカットです。

```bash
obsidian obsidian-task-viewer:today vault=MyVault outputFields=content,effectiveStartTime,effectiveEndTime
```

| フラグ | 説明 |
|-------|------|
| `leaf` | 子タスクを持たないタスクのみ |
| `sort` | ソートルール |
| `limit` / `offset` | ページネーション |

#### get — 単一タスク取得

```bash
obsidian obsidian-task-viewer:get vault=MyVault id=abc123 outputFields=content,status,startDate,due
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |

#### query — テンプレートクエリ

設定済みのビューテンプレートでタスクを取得します。

```bash
obsidian obsidian-task-viewer:query vault=MyVault template=weekly-review
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `template` | ○ | テンプレートのベースネーム |
| `date` | | 相対フィルタの基準日（YYYY-MM-DD） |

**戻り値:** テンプレートに定義された各リストごとにタスクが返されます。

```json
{
  "template": "weekly-review",
  "viewType": "schedule",
  "lists": [
    { "name": "Today", "count": 3, "tasks": [...] },
    { "name": "Overdue", "count": 1, "tasks": [...] }
  ]
}
```

#### create — タスク作成

```bash
obsidian obsidian-task-viewer:create vault=MyVault file=DailyNotes/2026-03-15.md content="Meeting" start="2026-03-15T14:00" end="15:00"
```

| フラグ | 必須 | 説明 | 例 |
|-------|------|------|-----|
| `file` | ○ | 対象ファイル（`.md` 自動補完） | `file=daily.md` |
| `content` | ○ | タスクの内容 | `content="Weekly review"` |
| `start` | | 開始日時 | `start=2026-03-15T14:00` |
| `end` | | 終了日時 | `end=15:00` |
| `due` | | 締切日 | `due=2026-03-20` |
| `status` | | ステータス文字（デフォルト: ` `） | `status=!` |
| `heading` | | 挿入先の見出し | `heading=Tasks` |

**日時の形式:** `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `HH:mm`

#### update — タスク更新

```bash
obsidian obsidian-task-viewer:update vault=MyVault id=abc123 status=x
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |
| `content` | | 新しい内容 |
| `start` | | 新しい開始日時 |
| `end` | | 新しい終了日時 |
| `due` | | 新しい締切日 |
| `status` | | 新しいステータス |

#### delete — タスク削除

```bash
obsidian obsidian-task-viewer:delete vault=MyVault id=abc123
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |

**戻り値:** `{ "deleted": "abc123" }`

### 日付プリセット

`date`, `from`, `to`, `due` フラグで使用可能な日付プリセット（大文字小文字不問）:

| プリセット | 説明 |
|-----------|------|
| `today` | 本日 |
| `thisWeek` | 今週 |
| `pastWeek` | 先週 |
| `nextWeek` | 来週 |
| `thisMonth` | 今月 |
| `thisYear` | 今年 |
| `next7days` | 今後7日間 |
| `next30days` | 今後30日間 |
| `YYYY-MM-DD` | 絶対日付 |

### 出力フィールド

`outputFields` で指定可能なフィールド:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | `string` | タスクID（常に含まれる） |
| `file` | `string` | ファイルパス |
| `line` | `number` | 行番号 |
| `content` | `string` | タスクの内容 |
| `status` | `string` | ステータス文字（` `, `x`, `-` 等） |
| `startDate` | `string \| null` | 生の開始日（YYYY-MM-DD） |
| `startTime` | `string \| null` | 生の開始時刻（HH:mm） |
| `endDate` | `string \| null` | 生の終了日 |
| `endTime` | `string \| null` | 生の終了時刻 |
| `due` | `string \| null` | 生の締切日 |
| `tags` | `string[]` | タグ一覧 |
| `parserId` | `string` | パーサー種別（`at-notation` / `frontmatter`） |
| `parentId` | `string \| null` | 親タスクID |
| `childIds` | `string[]` | 子タスクID一覧 |
| `color` | `string \| null` | カードの色 |
| `linestyle` | `string \| null` | 線スタイル |
| `effectiveStartDate` | `string \| null` | 暗黙値解決済み開始日 |
| `effectiveStartTime` | `string \| null` | 暗黙値解決済み開始時刻 |
| `effectiveEndDate` | `string \| null` | 暗黙値解決済み終了日 |
| `effectiveEndTime` | `string \| null` | 暗黙値解決済み終了時刻 |
| `durationMinutes` | `number \| null` | 所要時間（分） |
| `properties` | `Record<string, string>` | カスタムプロパティ |

### 出力形式の例

**json**（デフォルト）:
```json
{ "count": 2, "tasks": [{ "id": "abc", "content": "Meeting", ... }] }
```

**tsv**:
```
id	content	status	startDate
abc	Meeting	 	2026-03-15
def	Review	x	2026-03-14
```

**jsonl**:
```
{"id":"abc","content":"Meeting","status":" ","startDate":"2026-03-15"}
{"id":"def","content":"Review","status":"x","startDate":"2026-03-14"}
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

### list / today

```javascript
// 全タスク（デフォルト100件）
const result = api.list();

// フィルタ付き
const result = api.list({
  tag: 'work',           // string または string[]
  status: ['x', '-'],    // string または string[]
  date: 'today',         // YYYY-MM-DD またはプリセット
  sort: [{ property: 'startDate', direction: 'asc' }],
  limit: 50,
});

// 本日のタスク
const result = api.today({
  leaf: true,
  sort: [{ property: 'startDate' }],
});
```

**ListParams:**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `file` | `string` | ファイルパスで絞り込み |
| `status` | `string \| string[]` | ステータス文字 |
| `tag` | `string \| string[]` | タグ名（カンマ区切り文字列も可） |
| `content` | `string` | コンテンツ部分一致 |
| `date` | `string` | 指定日にアクティブなタスク |
| `from` | `string` | 開始日 >= 指定値 |
| `to` | `string` | 終了日 <= 指定値 |
| `due` | `string` | 締切日 = 指定値 |
| `leaf` | `boolean` | 子なしタスクのみ |
| `property` | `string` | カスタムプロパティ（`key:value`） |
| `filter` | `FilterState` | 完全なフィルタ定義（上記フラグより優先） |
| `sort` | `ApiSortRule[]` | ソートルール |
| `limit` | `number` | 最大件数（デフォルト: 100） |
| `offset` | `number` | スキップ件数 |

**TodayParams:** `leaf`, `sort`, `limit`, `offset` のみ。

**戻り値: `TaskListResult`**

```typescript
{ count: number; tasks: NormalizedTask[] }
```

### get

```javascript
const task = api.get({ id: 'abc123' });
// => NormalizedTask
```

ID が見つからない場合は `TaskApiError` をスローします。

### query

```javascript
const result = await api.query({ template: 'weekly-review', date: '2026-03-15' });
// => { template: string; viewType: string; lists: QueryListEntry[] }
// QueryListEntry: { name: string; count: number; tasks: NormalizedTask[] }
```

`viewTemplateFolder` が設定で未指定の場合は `TaskApiError` をスローします。

### create

```javascript
const result = await api.create({
  file: 'DailyNotes/2026-03-15.md',
  content: 'Weekly review',
  start: '2026-03-15T14:00',
  end: '15:00',
  due: '2026-03-20',
  heading: 'Tasks',
});
// => { task: NormalizedTask }
```

**CreateParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `file` | ○ | `string` | 対象ファイル |
| `content` | ○ | `string` | タスクの内容 |
| `start` | | `string` | 開始日時（`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `HH:mm`） |
| `end` | | `string` | 終了日時 |
| `due` | | `string` | 締切日（`YYYY-MM-DD`） |
| `status` | | `string` | ステータス文字（デフォルト: ` `） |
| `heading` | | `string` | 挿入先見出し |

### update

```javascript
const result = await api.update({
  id: 'abc123',
  status: 'x',
  content: 'Updated content',
});
// => { task: NormalizedTask }
```

**UpdateParams:** `id`（必須）, `content`, `start`, `end`, `due`, `status`（すべてオプション）

### delete

```javascript
const result = await api.delete({ id: 'abc123' });
// => { deleted: 'abc123' }
```

### NormalizedTask フィールド

API が返すタスクオブジェクトのフィールド一覧です。CLI の `outputFields` でも同じ名前を使用します。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | `string` | タスクID |
| `file` | `string` | ファイルパス |
| `line` | `number` | 行番号 |
| `content` | `string` | タスクの内容 |
| `status` | `string` | ステータス文字 |
| `startDate` | `string \| null` | 生の開始日（YYYY-MM-DD） |
| `startTime` | `string \| null` | 生の開始時刻（HH:mm） |
| `endDate` | `string \| null` | 生の終了日 |
| `endTime` | `string \| null` | 生の終了時刻 |
| `due` | `string \| null` | 生の締切日 |
| `tags` | `string[]` | タグ一覧（`#` なし） |
| `parserId` | `string` | パーサー種別 |
| `parentId` | `string \| null` | 親タスクID |
| `childIds` | `string[]` | 子タスクID一覧 |
| `color` | `string \| null` | カードの色 |
| `linestyle` | `string \| null` | 線スタイル |
| `effectiveStartDate` | `string \| null` | 暗黙値解決済み開始日 |
| `effectiveStartTime` | `string \| null` | 暗黙値解決済み開始時刻 |
| `effectiveEndDate` | `string \| null` | 暗黙値解決済み終了日 |
| `effectiveEndTime` | `string \| null` | 暗黙値解決済み終了時刻 |
| `durationMinutes` | `number \| null` | 所要時間（分） |
| `properties` | `Record<string, string>` | カスタムプロパティ |

### DataviewJS 使用例

```dataviewjs
const api = app.plugins.plugins['obsidian-task-viewer'].api;

// 本日のタスクをテーブル表示
const result = api.today({ sort: [{ property: 'startDate' }] });
dv.table(
  ['Status', 'Time', 'Content'],
  result.tasks.map(t => [
    t.status === ' ' ? '⬜' : '✅',
    [t.effectiveStartTime, t.effectiveEndTime].filter(Boolean).join('–') || '—',
    t.content,
  ])
);
```

```dataviewjs
const api = app.plugins.plugins['obsidian-task-viewer'].api;

// 特定タグのタスクを一覧
const result = api.list({ tag: 'reading', status: ' ' });
dv.list(result.tasks.map(t => `${t.content} (${t.due ?? 'no due'})`));
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
