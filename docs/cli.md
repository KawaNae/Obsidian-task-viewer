# CLI (Experimental)

> [!WARNING]
> CLI サポートは試験的機能です。Obsidian v1.12.2+ の CLI API を使用しています。コマンド名やパラメータは今後変更される可能性があります。

Obsidian CLI から本プラグインのタスクデータにアクセスできます。Obsidian が起動中である必要があります。

## CLI の使い方

- ヘルプの表示: `obsidian help obsidian-task-viewer:list`
- `vault` は Obsidian フレームワークが管理するフラグです（本プラグインでは管理しません）
- ブーリアンフラグ（`leaf`, `root`）: フラグ名のみで有効化（例: `leaf` または `leaf=true`）
- 未知のフラグは無視されます（エラーにはなりません）

## 共通フラグ

| フラグ | 説明 | デフォルト |
|-------|------|-----------|
| `format` | 出力形式: `json`, `tsv`, `jsonl` | `json` |
| `outputFields` | 出力フィールド（カンマ区切り） | `id` |

## コマンド一覧

### list — タスク一覧

フィルタ・ソート・ページネーション付きでタスクを取得します。

```bash
obsidian obsidian-task-viewer:list tag=work format=json outputFields=content,status,startDate
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
| `leaf` | 子タスクを持たないタスクのみ | `leaf` |
| `property` | カスタムプロパティ（`key:value` 形式） | `property=priority:high` |
| `color` | カード色で絞り込み（カンマ区切り） | `color=red,blue` |
| `type` | タスク notation で絞り込み | `type=taskviewer` |
| `root` | 親タスクを持たないタスクのみ | `root` |
| `filter-file` | FilterState JSON (.json) またはビューテンプレート (.md) | `filter-file=filters/tag.json` |
| `list` | ピン留めリスト名（`.md` テンプレート用） | `list=urgent` |

> `date` と `from`/`to` を同時指定するとエラーになります。`date` で特定日、`from`/`to` で範囲指定のいずれかを使用してください。
>
> `filter-file` や FilterState JSON の詳細は `obsidian obsidian-task-viewer:help` で確認できます。

**ソート・ページネーション:**

| フラグ | 説明 | 例 |
|-------|------|-----|
| `sort` | ソートルール（`property[:direction]` カンマ区切り） | `sort=startDate:asc,due:desc` |
| `limit` | 最大件数 | `limit=50`（デフォルト: 100） |
| `offset` | スキップ件数 | `offset=10` |

**ソート可能プロパティ:** `content`, `due`, `startDate`, `endDate`, `file`, `status`, `tag`

### today — 本日のタスク

visual-date を考慮し、本日アクティブなタスク（日をまたぐタスクを含む）を取得します。

```bash
obsidian obsidian-task-viewer:today outputFields=content,effectiveStartTime,effectiveEndTime
```

| フラグ | 説明 |
|-------|------|
| `leaf` | 子タスクを持たないタスクのみ |
| `sort` | ソートルール |
| `limit` / `offset` | ページネーション |

### get — 単一タスク取得

```bash
obsidian obsidian-task-viewer:get id=abc123 outputFields=content,status,startDate,due
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |

### create — タスク作成

```bash
obsidian obsidian-task-viewer:create file=DailyNotes/2026-03-15.md content="Meeting" start="2026-03-15T14:00" end="15:00"
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

### update — タスク更新

```bash
obsidian obsidian-task-viewer:update id=abc123 status=x
obsidian obsidian-task-viewer:update id=abc123 start=none  # フィールドをクリア
```

**日時の形式:** `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `YYYY-MM-DD HH:mm`, `HH:mm`

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |
| `content` | | 新しい内容 |
| `start` | | 新しい開始日時（`none` でクリア） |
| `end` | | 新しい終了日時（`none` でクリア） |
| `due` | | 新しい締切日（`none` でクリア） |
| `status` | | 新しいステータス（`none` で未完了に戻す） |

### delete — タスク削除

```bash
obsidian obsidian-task-viewer:delete id=abc123
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |

**戻り値:** `{ "deleted": "abc123" }`

### duplicate — タスク複製

```bash
obsidian obsidian-task-viewer:duplicate id=abc123
obsidian obsidian-task-viewer:duplicate id=abc123 day-offset=1 count=3
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |
| `day-offset` | | 日付をシフトする日数（デフォルト: 0） |
| `count` | | コピー数（デフォルト: 1） |

**戻り値:** `{ "duplicated": "abc123" }`

### convert — インライン→Frontmatter変換

インラインタスクをfrontmatterタスクファイルに変換します。

```bash
obsidian obsidian-task-viewer:convert id=abc123
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |

**戻り値:** `{ "convertedFrom": "abc123", "newFile": "path/to/new-file.md" }`

### tasks-for-date-range — 日付範囲のタスク取得

```bash
obsidian obsidian-task-viewer:tasks-for-date-range start=2026-03-01 end=2026-03-31 outputFields=content,startDate
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `start` | ○ | 開始日（YYYY-MM-DD、inclusive） |
| `end` | ○ | 終了日（YYYY-MM-DD、inclusive） |
| `sort` | | ソートルール |
| `limit` / `offset` | | ページネーション |

### categorized-tasks-for-date-range — 日付範囲のタスク（分類済み）

日付範囲のタスクを日付ごとに allDay / timed / dueOnly に分類して返します。

```bash
obsidian obsidian-task-viewer:categorized-tasks-for-date-range start=2026-03-01 end=2026-03-31
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `start` | ○ | 開始日（YYYY-MM-DD、inclusive） |
| `end` | ○ | 終了日（YYYY-MM-DD、inclusive） |

**戻り値:** `{ "2026-03-01": { "allDay": [...], "timed": [...], "dueOnly": [...] }, ... }`

### insert-child-task — 子タスク挿入

親タスクの下に子タスクを挿入します。

```bash
obsidian obsidian-task-viewer:insert-child-task parent-id=abc123 content="サブタスク"
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `parent-id` | ○ | 親タスクID |
| `content` | ○ | 子タスクの内容 |

**戻り値:** `{ "parentId": "abc123" }`

### create-tv-file — tv-file（frontmatter）タスク作成

新しい tv-file タスクを作成します。

```bash
obsidian obsidian-task-viewer:create-tv-file content="プロジェクト名" start=2026-03-15 due=2026-03-31
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `content` | ○ | タスクの内容 |
| `start` | | 開始日時 |
| `end` | | 終了日時 |
| `due` | | 締切日 |
| `status` | | ステータス文字（デフォルト: ` `） |

**戻り値:** `{ "newFile": "path/to/new-file.md" }`

### get-start-hour — startHour設定値取得

```bash
obsidian obsidian-task-viewer:get-start-hour
```

**戻り値:** `{ "startHour": 5 }`

### help — CLI リファレンス

```bash
obsidian obsidian-task-viewer:help
```

全コマンドの詳細リファレンス（フラグ一覧・日付形式・ソート・FilterState JSON 構造・使用例）を表示します。

## 日付プリセット

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

## 出力フィールド

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
| `parserId` | `string` | パーサー種別（`tv-inline` / `tv-file` / `tasks-plugin` / `day-planner`） |
| `parentId` | `string \| null` | 親タスクID |
| `childIds` | `string[]` | 子タスクID一覧 |
| `color` | `string \| null` | カードの色 |
| `linestyle` | `string \| null` | 線スタイル |
| `effectiveStartDate` | `string \| null` | 暗黙値解決済み開始日 |
| `effectiveStartTime` | `string \| null` | 暗黙値解決済み開始時刻 |
| `effectiveEndDate` | `string \| null` | 暗黙値解決済み終了日 |
| `effectiveEndTime` | `string \| null` | 暗黙値解決済み終了時刻 |
| `durationMinutes` | `number \| null` | 所要時間（分） |
| `properties` | `Record<string, unknown>` | カスタムプロパティ |

## 出力形式の例

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
