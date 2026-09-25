# CLI (Experimental)

> [!WARNING]
> CLI サポートは試験的機能です。Obsidian v1.12.2+ の CLI API を使用しています。コマンド名やパラメータは今後変更される可能性があります。

Obsidian CLI から本プラグインのタスクデータにアクセスできます。Obsidian が起動中である必要があります。

## CLI の使い方

- ヘルプの表示: `obsidian help obsidian-task-viewer:list`
- `vault` は Obsidian フレームワークが管理するフラグです（本プラグインでは管理しません）
- ブーリアンフラグ（`leaf`, `root`）: フラグ名のみで有効化（例: `leaf` または `leaf=true`）
- 未知のフラグはエラーになります（近いフラグ名の候補を提示します）。ブーリアンフラグに値を付けた場合（`leaf=1` 等）もエラーです
- 語彙の規則: `from`/`to` はクエリ窓（inclusive、窓と重なるタスクが対象）、`date` は単日窓の糖衣（`from=X to=X` と同じ）、`start`/`end`/`due` はタスク自身のフィールドです

## 共通フラグ

| フラグ | 説明 | デフォルト |
|-------|------|-----------|
| `format` | 出力形式: `json`, `tsv`, `jsonl` | `json` |
| `output-fields` | 出力フィールド（カンマ区切り） | `id` |

## タスク ID

`id` と `parent-id` に渡す ID、出力の `id`、`parentId`、`childIds` は、Public API と同じ形です（[api.md の「タスク ID」](api.md#タスク-id)）。

- 行末の `^id` がそのファイルでその行だけにある行は `パス#^id`（例: `DailyNotes/2026-03-15.md#^review`）で、外での編集や再起動をまたいで使えます
- それ以外の行は読みの名前で、ファイルがプラグインの外で変わるまでしか使えません。保存して後で使わず、使う前に `list` などで取り直してください
- ID を長く保ちたいタスクには、行末に `^id` を付けてください
- `update` は書いたあとのタスクを返します。読みの名前の行では、返った `id` が次に使う ID です
- ID の形は v0.57.0 で変わりました。以前の版の ID は使えません

## コマンド一覧

### list — タスク一覧

フィルタ・ソート・ページネーション付きでタスクを取得します。

```bash
obsidian obsidian-task-viewer:list tag=work format=json output-fields=content,status,startDate
```

**フィルタフラグ:**

| フラグ | 説明 | 例 |
|-------|------|-----|
| `file` | ファイルパスで絞り込み（`.md` は自動補完） | `file=DailyNotes/2026-03-15` |
| `status` | ステータス文字（カンマ区切り） | `status=x,-` |
| `tag` | タグ名（カンマ区切り、`#` は自動除去） | `tag=work,reading` |
| `content` | コンテンツの部分一致 | `content=会議` |
| `date` | 単日のクエリ窓（`from=X to=X` と同じ） | `date=today` |
| `from` | クエリ窓の開始（この日以降に終わるタスク） | `from=2026-03-01` |
| `to` | クエリ窓の終了（この日以前に始まるタスク） | `to=2026-03-31` |
| `due` | 締切日 = 指定値 | `due=today` |
| `leaf` | 子タスクを持たないタスクのみ | `leaf` |
| `property` | カスタムプロパティ（`key:value` 形式） | `property=priority:high` |
| `color` | カード色で絞り込み（カンマ区切り） | `color=red,blue` |
| `type` | タスク notation で絞り込み | `type=taskviewer` |
| `root` | 親タスクを持たないタスクのみ | `root` |
| `filter-file` | FilterState JSON (.json) またはビューテンプレート (.md) | `filter-file=filters/tag.json` |
| `list` | ピン留めリスト名（`.md` テンプレート用） | `list=urgent` |

> `from`/`to` は inclusive なクエリ窓です。窓と期間が重なるタスクが対象になります（例: 6/28〜7/2 のタスクは `from=2026-07-01` に含まれます）。`date` と `from`/`to` の同時指定はエラーです。
>
> list の窓は effective な日付（カレンダー基準、締切のみのタスクは対象外）で判定します。tasks-for-date-range 系の窓は visual な日付（タイムライン表示と同じ基準、締切のみのタスクを含む）で判定します。
>
> `filter-file` や FilterState JSON の詳細は `obsidian obsidian-task-viewer:help` で確認できます。

**ソート・ページネーション:**

| フラグ | 説明 | 例 |
|-------|------|-----|
| `sort` | ソートルール（`property[:direction]` カンマ区切り） | `sort=startDate:asc,due:desc` |
| `limit` | 最大件数（デフォルト: 100, 0=件数のみ, all=無制限） | `limit=50` / `limit=all` |

**ソート可能プロパティ:** `content`, `due`, `startDate`, `endDate`, `file`, `status`, `tag`

### today — 本日のタスク

visual-date を考慮し、本日アクティブなタスク（日をまたぐタスクを含む）を取得します。

```bash
obsidian obsidian-task-viewer:today output-fields=content,effectiveStartTime,effectiveEndTime
```

| フラグ | 説明 |
|-------|------|
| `leaf` | 子タスクを持たないタスクのみ |
| `sort` | ソートルール |
| `limit` | 最大件数（デフォルト: 100, 0=件数のみ, all=無制限） |

### get — 単一タスク取得

```bash
obsidian obsidian-task-viewer:get id=abc123 output-fields=content,status,startDate,due
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
| `file` | ○ | 対象ファイルパス | `file=DailyNotes/daily.md` |
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

`day-offset` が複写を並べる軸を決め、`count` が本数を決めます。

```bash
# 元の続きに1つ。元が 10:00>11:30 なら複写は 11:30>13:00
obsidian obsidian-task-viewer:duplicate id=abc123

# 元の続きに3つ、時刻を連ねる
obsidian obsidian-task-viewer:duplicate id=abc123 count=3

# 日付を1日ずらして3つ（元の直前、新しい日付が上）
obsidian obsidian-task-viewer:duplicate id=abc123 day-offset=1 count=3
```

`day-offset` を指定しない複写は、元タスクの続きに置かれます。**実効 end から始まり、長さを保ちます**。end を書いていないタスクの実効 end は開始の1時間後です。複写は元タスクとその子行の後ろに入り、`count` が2以上ならその長さぶんずつ連なります。

時刻を持たないタスク（終日、日数の範囲、日付なし）はずらす先が無いので、複写は同じ行がそのまま増えます。位置は同じく元タスクの続きです。

子の行は日付や時刻を含めてそのまま写されます。due はどちらの軸でもずらしません。締め切りは予定の時刻とは別の属性だからです。

| フラグ | 必須 | 説明 |
|-------|------|------|
| `id` | ○ | タスクID |
| `day-offset` | | 日付をシフトする日数（デフォルト: 0。0 なら時刻の軸で連ねる） |
| `count` | | コピー数（デフォルト: 1） |

**戻り値:** `{ "duplicated": "abc123" }`

### tasks-for-date-range — 日付範囲のタスク取得

期間の判定は from/to そのもの（visual な日付、下の list との違いを参照）で行われます。単純フィルタフラグは、その結果にさらに絞り込みをかけるだけで、期間の判定には関与しません。

```bash
obsidian obsidian-task-viewer:tasks-for-date-range from=2026-03-01 to=2026-03-31 output-fields=content,startDate

# 単純フィルタを重ねる（期間は from/to のまま、status で絞り込むだけ）
obsidian obsidian-task-viewer:tasks-for-date-range from=2026-03-01 to=2026-03-31 status=x tag=work
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `from` | ○ | クエリ窓の開始（YYYY-MM-DD またはプリセット、inclusive） |
| `to` | ○ | クエリ窓の終了（YYYY-MM-DD またはプリセット、inclusive） |
| `file` | | ファイルパスで絞り込み（`.md` は自動補完） |
| `status` | | ステータス文字（カンマ区切り） |
| `tag` | | タグ名（カンマ区切り、`#` は自動除去） |
| `content` | | コンテンツの部分一致 |
| `due` | | 締切日 = 指定値 |
| `leaf` | | 子タスクを持たないタスクのみ |
| `property` | | カスタムプロパティ（`key:value` 形式） |
| `color` | | カード色で絞り込み（カンマ区切り） |
| `type` | | タスク notation で絞り込み |
| `root` | | 親タスクを持たないタスクのみ |
| `filter-file` | | FilterState JSON (.json) またはビューテンプレート (.md)。単純フィルタフラグより優先（list と同じ挙動） |
| `list` | | ピン留めリスト名（`.md` テンプレート用） |
| `sort` | | ソートルール |
| `limit` | | 最大件数（デフォルト: 100, 0=件数のみ, all=無制限） |

### categorized-tasks-for-date-range — 日付範囲のタスク（分類済み）

日付範囲のタスクを日付ごとに allDay / timed / dueOnly に分類して返します。日付への所属は、allDay と timed が startHour を考慮した visual な日付（タイムラインの表示と同じ基準）、dueOnly が締切のカレンダー日付で判定されます。単純フィルタフラグはこの分類の後に絞り込みをかけるだけで、期間・分類の判定には関与しません。

```bash
obsidian obsidian-task-viewer:categorized-tasks-for-date-range from=2026-03-01 to=2026-03-31 status=x
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `from` | ○ | クエリ窓の開始（YYYY-MM-DD またはプリセット、inclusive） |
| `to` | ○ | クエリ窓の終了（YYYY-MM-DD またはプリセット、inclusive） |
| `file` | | ファイルパスで絞り込み（`.md` は自動補完） |
| `status` | | ステータス文字（カンマ区切り） |
| `tag` | | タグ名（カンマ区切り、`#` は自動除去） |
| `content` | | コンテンツの部分一致 |
| `due` | | 締切日 = 指定値 |
| `leaf` | | 子タスクを持たないタスクのみ |
| `property` | | カスタムプロパティ（`key:value` 形式） |
| `color` | | カード色で絞り込み（カンマ区切り） |
| `type` | | タスク notation で絞り込み |
| `root` | | 親タスクを持たないタスクのみ |
| `filter-file` | | FilterState JSON (.json) またはビューテンプレート (.md)。単純フィルタフラグより優先（list と同じ挙動） |
| `list` | | ピン留めリスト名（`.md` テンプレート用） |

**戻り値:** `{ "2026-03-01": { "allDay": [...], "timed": [...], "dueOnly": [...] }, ... }`

### export-image — ビューを画像として保存

Timeline / Calendar / Schedule / Kanban ビューを PNG として書き出します。`view=` は既に開いているビューをそのまま書き出し、`template=` またはビュー設定フラグ（`days-to-show` など）を1つでも渡すと一時的なビューを作って書き出します。

```bash
# 既に開いている timeline ビューをそのまま書き出す
obsidian obsidian-task-viewer:export-image view=timeline

# 一時ビューを作って書き出す（daysToShow=5、開始日=2026-03-01）
obsidian obsidian-task-viewer:export-image view=timeline days-to-show=5 anchor-date=2026-03-01

# 保存済みテンプレートから書き出す
obsidian obsidian-task-viewer:export-image template="My Timeline"
```

| フラグ | 必須 | 説明 |
|-------|------|------|
| `view` | ※ | `timeline` \| `calendar` \| `schedule` \| `kanban`（`template=` 未指定なら必須） |
| `template` | ※ | 保存済みビューテンプレート名（ビュー種別を推論。`view=` 未指定なら必須） |
| `name` | | 書き出したビューの表示名 |
| `anchor-date` | | 日付アンカー（`YYYY-MM-DD`）。「今日」ボタンと同じ役割を任意の日に対して行う。ビューごとのスキーマの日付フィールドに解決される |
| `width` | | 描画幅（px、デフォルト: 1200） |
| `output-folder` | | 出力先フォルダ（vault相対 or 絶対パス。デフォルト: `task-viewer-export`） |
| `filename` | | 出力ファイル名（デフォルト: `{ビュー種別}_{日付}.png`） |
| `wait` | | 描画後の待機時間（ms、デフォルト: 500） |
| `keep-open` | | 書き出し後も一時ウィンドウを開いたままにする |

対象ビュー自身の設定フラグもそのまま渡せます（例: timeline の `days-to-show`、1以上30以下の整数）。これを1つでも渡すと一時ビューでの書き出しになります。

**戻り値:** `{ "path": "...", "width": 1200, "height": 2096, "captureDurationMs": 771, "totalDurationMs": 1527, "resolvedAnchor": "2026-03-01", "renderedRange": { "from": "2026-03-01", "to": "2026-03-05" } }`

`resolvedAnchor`/`renderedRange` は、書き出したビューが自分で報告できる場合だけ含まれます（Timeline/Calendar/Schedule。Kanban には日付レンジの概念が無いため含まれません）。値は実際に描画された範囲そのものです。Calendar の `renderedRange` は暦月ではなく、実際のグリッドが描く週開始揃えの42日ぶんです。`anchor-date` 等を渡さず既に開いているビューをそのまま書き出す場合も、開いているビューが実際に表示している範囲がそのまま返ります。

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

`date`, `from`, `to`, `due` フラグ（tasks-for-date-range 系の `from`/`to` を含む）で使用可能な日付プリセット（大文字小文字不問）:

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

`output-fields` で指定可能なフィールド:

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
| `parserId` | `string` | パーサー種別（`tv-inline`、`tasks-plugin`、`day-planner` のいずれか） |
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
