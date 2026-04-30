# Public API (Experimental)

> [!WARNING]
> Public API は試験的機能です。メソッドのシグネチャや返却型は今後変更される可能性があります。

他のプラグインや DataviewJS から本プラグインの機能にアクセスできます。

## アクセス方法

```javascript
const api = app.plugins.plugins['obsidian-task-viewer'].api;
```

## メソッド一覧

| メソッド | 説明 | 同期/非同期 |
|---------|------|-----------|
| `api.list(params?)` | タスク一覧 | async |
| `api.today(params?)` | 本日のタスク | sync |
| `api.get({ id })` | 単一タスク取得 | sync |
| `api.create({ file, content, ... })` | インラインタスク作成 | async |
| `api.update({ id, ... })` | タスク更新 | async |
| `api.delete({ id })` | タスク削除 | async |
| `api.duplicate({ id, ... })` | タスク複製 | async |
| `api.convertToFrontmatter({ id })` | インライン→Frontmatter変換 | async |
| `api.tasksForDateRange({ start, end, ... })` | 日付範囲のタスク取得 | async |
| `api.categorizedTasksForDateRange({ start, end, ... })` | 日付範囲のタスク（分類済み） | sync |
| `api.insertChildTask({ parentId, content })` | 子タスク挿入 | async |
| `api.createFrontmatterTask({ content, ... })` | Frontmatterタスクファイル作成 | async |
| `api.getStartHour()` | startHour設定値取得 | sync |
| `api.onChange(callback)` | タスク変更の購読 | sync |
| `api.help()` | API リファレンス表示 | sync |

## list / today

```javascript
// 全タスク（デフォルト100件）
const result = await api.list();

// フィルタ付き
const result = await api.list({
  tag: 'work',           // string または string[]
  status: ['x', '-'],    // string または string[]
  date: 'today',         // YYYY-MM-DD またはプリセット
  sort: [{ property: 'startDate', direction: 'asc' }],
  limit: 50,
});

// FilterState JSON ファイルでフィルタ
const result = await api.list({ filterFile: 'filters/exact-tag.json' });

// ビューテンプレート + ピン留めリスト指定
const result = await api.list({ filterFile: 'templates/work.md', list: 'urgent' });

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
| `color` | `string \| string[]` | カード色 |
| `type` | `string \| string[]` | タスク notation（`taskviewer`, `tasks`, `dayplanner`） |
| `root` | `boolean` | 親タスクを持たないタスクのみ |
| `filter` | `FilterState` | 完全なフィルタ定義（上記フラグより優先） |
| `filterFile` | `string` | vault 内フィルタファイルパス（`.json` / `.md` テンプレート） |
| `list` | `string` | ピン留めリスト名（`filterFile` が `.md` テンプレートの場合） |
| `sort` | `ApiSortRule[]` | ソートルール |
| `limit` | `number` | 最大件数（デフォルト: 100） |
| `offset` | `number` | スキップ件数 |

**TodayParams:** `leaf`, `sort`, `limit`, `offset` のみ。

**戻り値: `TaskListResult`**

```typescript
{ count: number; tasks: NormalizedTask[] }
```

## get

```javascript
const task = api.get({ id: 'abc123' });
// => NormalizedTask
```

ID が見つからない場合は `TaskApiError` をスローします。

## create

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

## update

```javascript
const result = await api.update({
  id: 'abc123',
  status: 'x',
  content: 'Updated content',
});
// => { task: NormalizedTask }
```

**UpdateParams:** `id`（必須）, `content`, `start`, `end`, `due`, `status`（すべてオプション。`'none'` を指定するとフィールドをクリア）

## delete

```javascript
const result = await api.delete({ id: 'abc123' });
// => { deleted: 'abc123' }
```

## duplicate

```javascript
// 1つコピー
const result = await api.duplicate({ id: 'abc123' });
// => { duplicated: 'abc123' }

// 日付を1日ずらして3つコピー
const result = await api.duplicate({ id: 'abc123', dayOffset: 1, count: 3 });
```

**DuplicateParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `id` | ○ | `string` | タスクID |
| `dayOffset` | | `number` | 日付シフト日数（デフォルト: 0） |
| `count` | | `number` | コピー数（デフォルト: 1） |

## convertToFrontmatter

```javascript
const result = await api.convertToFrontmatter({ id: 'abc123' });
// => { convertedFrom: 'abc123', newFile: 'path/to/new-file.md' }
```

インラインタスクをfrontmatterタスクファイルに変換します。

## tasksForDateRange

```javascript
const result = await api.tasksForDateRange({
  start: '2026-03-01',
  end: '2026-03-31',
  sort: [{ property: 'startDate', direction: 'asc' }],
});
// => { count: number, tasks: NormalizedTask[] }
```

**TasksForDateRangeParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `start` | ○ | `string` | 開始日（YYYY-MM-DD） |
| `end` | ○ | `string` | 終了日（YYYY-MM-DD） |
| `filter` | | `FilterState` | フィルタ定義 |
| `sort` | | `ApiSortRule[]` | ソートルール |
| `limit` | | `number` | 最大件数（デフォルト: 100） |
| `offset` | | `number` | スキップ件数 |

## categorizedTasksForDateRange

```javascript
const result = api.categorizedTasksForDateRange({
  start: '2026-03-01',
  end: '2026-03-31',
});
// => { "2026-03-01": { allDay: [...], timed: [...], dueOnly: [...] }, ... }
```

日付範囲のタスクを日付ごとに allDay（終日）/ timed（時刻あり）/ dueOnly（締切のみ）に分類して返します。

**CategorizedTasksForDateRangeParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `start` | ○ | `string` | 開始日（YYYY-MM-DD） |
| `end` | ○ | `string` | 終了日（YYYY-MM-DD） |
| `filter` | | `FilterState` | フィルタ定義 |

## insertChildTask

```javascript
const result = await api.insertChildTask({
  parentId: 'abc123',
  content: 'サブタスク',
});
// => { parentId: 'abc123' }
```

## createFrontmatterTask

```javascript
const result = await api.createFrontmatterTask({
  content: 'プロジェクト名',
  start: '2026-03-15',
  due: '2026-03-31',
});
// => { newFile: 'path/to/new-file.md' }
```

**CreateFrontmatterParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `content` | ○ | `string` | タスクの内容 |
| `start` | | `string` | 開始日時 |
| `end` | | `string` | 終了日時 |
| `due` | | `string` | 締切日 |
| `status` | | `string` | ステータス文字（デフォルト: ` `） |

## getStartHour

```javascript
const result = api.getStartHour();
// => { startHour: 5 }
```

## onChange

```javascript
const unsubscribe = api.onChange((taskId) => {
  console.log('Task changed:', taskId);
});
// 購読解除
unsubscribe();
```

タスク変更を購読します。戻り値は購読解除関数です。

## help

API の詳細リファレンスを表示します。

**エディタ（DataviewJS）で表示:**

```dataviewjs
const api = app.plugins.plugins['obsidian-task-viewer'].api;
dv.paragraph("```\n" + api.help() + "\n```");
```

**コンソール（DevTools: Ctrl+Shift+I）で表示:**

```javascript
console.log(app.plugins.plugins['obsidian-task-viewer'].api.help())
```

## NormalizedTask フィールド

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
| `properties` | `Record<string, unknown>` | カスタムプロパティ |

## DataviewJS 使用例

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
const result = await api.list({ tag: 'reading', status: ' ' });
dv.list(result.tasks.map(t => `${t.content} (${t.due ?? 'no due'})`));
```
