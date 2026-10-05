# Public API (Experimental)

> [!WARNING]
> Public API は試験的機能です。メソッドのシグネチャや返却型は今後変更される可能性があります。

他のプラグインや DataviewJS から本プラグインの機能にアクセスできます。

## アクセス方法

```javascript
const api = app.plugins.plugins['obsidian-task-viewer'].api;
```

## パラメータの規則

- `from`/`to` はクエリ窓（inclusive、窓と期間が重なるタスクが対象）、`date` は単日窓の糖衣、`start`/`end`/`due` はタスク自身のフィールドです
- 未知のパラメータキーはエラーになります（近いキー名の候補を提示します）。サイレントに無視されることはありません
- 必須のパラメータが無いか空文字列なら、`Missing required parameter: id` のエラーになります
- `filter` / `filterFile` で渡す FilterState も境界で検証されます（[FilterState](#filterstate) の「読めない条件」）

### 日付と時刻

`start`、`end`、`due` と、`date`、`from`、`to`、単純フィルタの `due`、FilterState の日付の値は、次のように読みます。

| 形 | 例 | 使える所 |
|----|----|----------|
| `YYYY-MM-DD` | `2026-03-15` | すべて |
| `YYYY-MM-DD HH:mm`、`YYYY-MM-DDTHH:mm` | `2026-03-15 14:00` | すべて。`date`、`from`、`to`、単純フィルタの `due`、FilterState では日の窓でなく、その瞬間を指します |
| `HH:mm` | `14:00` | `start`、`end`。`due` は日付が要ります |
| プリセット | `today`、`thisWeek`、`next7days` | `date`、`from`、`to`、単純フィルタの `due`、FilterState（`{ preset, n? }`） |

- 日付は実在する日でなければなりません。`2026-02-30` や `2026-13-01` はエラーです（`start must be a day that exists, got: "2026-02-30"`）
- 時刻は `9:40` を `09:40` と読みます。`25:00` はエラーです
- 全角の数字と記号は半角として読みます（`２０２６ー０３ー１５` は `2026-03-15`）。日付の中のハイフンに似た字（`ー`、`−`、`‐`、`–`、`—`）は `-` と読みます。値の前後の空白は落とします
- `create` も `update` も、時刻だけの `due`（`due: '17:00'`）は `due must include a date` で拒みます
- プリセットは大文字小文字を問いません: `today`、`thisWeek`、`nextWeek`、`pastWeek`、`thisMonth`、`thisYear`、`next<N>days`（例: `next7days`）

### 数

`limit`、`dayOffset`、`count` は整数でなければなりません。`1.5` や `NaN` はエラーです（`limit must be a whole number, got: "1.5"`）。範囲は `limit` が 0 以上、`count` が 1 以上です。`limit: Infinity` は無制限です。

### エラー

メソッドは `TaskApiError` を投げます。

- `message` は理由の文に `— See api.help() for reference` を付けたものです。`rawMessage` はその前の文だけです
- パラメータについてのエラーは、`param` にそのキーを持ちます（例: `{ param: 'dayOffset' }`）
- 文は英語で、値を引用します: `dayOffset must be a whole number, got: "1.5"`、`Invalid filter: filters[0]: Unknown filter property: priority. Available: ...`

## タスク ID

`id`、`parentId`、`childIds` と、`onChange` に渡る ID は、行ごとに次のどちらかの形をとります。

| 形 | 付く行 | 使える間 |
|----|--------|----------|
| `パス#^id`（例: `DailyNotes/2026-03-15.md#^review`） | 行末に `^id` があり、同じ `^id` の行がそのファイルに他に無い行 | その `^id` がファイルでその行だけにある間。外での編集や再起動をまたいで使えます |
| 読みの名前（例: `tv-inline:DailyNotes/2026-03-15.md:n:…:4`） | それ以外の行 | ファイルがプラグインの外で変わるか、プラグインが読み込み直されるまで |

- 読みの名前は、一覧を取ったときの一時的な受け取り証です。保存して後で使わないでください。使う前に `list` などで取り直してください
- 読みの名前は、ファイルの内容が元に戻っても使えるようになりません。外での編集で内容を戻したときも、プラグインを読み込み直したとき（Obsidian の再起動を含む）も、前の名前は見つからない ID になります
- ID を長く保ちたいタスクには、行末に `^id` を付けてください（例: `- [ ] Weekly review ^review`）
- `update` は書いたあとのタスクを返します。読みの名前の行では、返った `id` が次に使う ID です
- 書き込みは、プラグインが最後に読んだ内容とファイルが一致するときだけ行います。ファイルが外で変わり、プラグインがまだ読み直していない間は、`パス#^id` でも `could not be written` のエラーになります。少し待ってからやり直してください
- 見つからない ID は `TaskApiError` になります。`パス#^id` では `no line of <パス> carries ^<id> alone`、読みの名前では `an ID without a ^id lasts only until its file changes or the plugin reloads; list the tasks again` と理由を添えます
- ID の形は v0.57.0 で変わりました。以前の版の ID（`…:seq:5` など）は使えません

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
| `api.tasksForDateRange({ from, to, ... })` | 日付範囲のタスク取得 | async |
| `api.categorizedTasksForDateRange({ from, to, ... })` | 日付範囲のタスク（分類済み） | async |
| `api.insertChildTask({ parentId, content })` | 子タスク挿入 | async |
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

フィルタの元は、`filterFile`、`filter`、単純フィルタと窓（`date`、`from`、`to`）の順に1つだけ使います。上のものがあれば下は読みません（検査もしません）。`list` は `filterFile`（`.md` のテンプレート）と一緒でなければならず、`filterFile` なしで渡すと `'list' requires 'filterFile' (a .md view template)` のエラーです。テンプレートは、そのビューが読むのと同じ形で読みます。ピン留めリストは、`sort` が無ければリストに保存された並べ替えで並びます（ビューと同じ並び）。

`list` の窓も `tasksForDateRange` 系の窓も、タスクの期間が startHour を考慮した visual な日（ビューと同じ基準）と重なるかで判定します。時刻の無い終了日はその日を含みます（`@2026-10-01>2026-10-04` は 10/04 に当たる）。締切だけのタスクは締切を終了とみなした期間（締切の日、時刻付きの締切なら締切の前の1時間）で当たります。

`leaf` は子タスクを持たないタスクです。チェックボックスの無い子の行やリンクは子タスクに数えません。`today` の `leaf` も同じです。

`filterFile` を使う問い合わせは、ビューと同じく検証エラーのあるタスク（例: 終了が開始より前、実在しない日付）を外します。`filterFile` を使わない `list` と `tasksForDateRange` 系は、検証エラーのあるタスクも返します。

**ListParams:**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `file` | `string` | ファイルパスで絞り込み（`.md` は補われる） |
| `status` | `string \| string[]` | ステータス文字 |
| `tag` | `string \| string[]` | タグ名（カンマ区切り文字列も可。下位のタグも含む） |
| `content` | `string` | コンテンツ部分一致 |
| `date` | `string` | 単日のクエリ窓（`from=X to=X` と同じ） |
| `from` | `string` | クエリ窓の開始（この日以降に終わるタスク、inclusive overlap） |
| `to` | `string` | クエリ窓の終了（この日以前に始まるタスク、inclusive overlap） |
| `due` | `string` | 締切日 = 指定値 |
| `leaf` | `boolean` | 子なしタスクのみ |
| `property` | `string` | カスタムプロパティ（`key:value`） |
| `color` | `string \| string[]` | カード色 |
| `type` | `string \| string[]` | タスク notation（`taskviewer`, `tasks`, `dayplanner`） |
| `root` | `boolean` | 親タスクを持たないタスクのみ |
| `filter` | `FilterState` | 完全なフィルタ定義（上記フラグより優先） |
| `filterFile` | `string` | vault 内フィルタファイルパス（`.json` / `.md` テンプレート。`filter` より優先） |
| `list` | `string` | ピン留めリスト名（`filterFile` が `.md` テンプレートの場合）。テンプレートのビューのフィルタは、そのリストの「ビューフィルターを適用」がオンのときだけ重ねる（ビューの表示と同じ） |
| `sort` | `ApiSortRule[]` | ソートルール |
| `limit` | `number` | 最大件数（デフォルト: 100, 0=件数のみ, Infinity=無制限） |

**TodayParams:** `ListParams` から `date`、`from`、`to` を除いたものです。`today` は `list` に `date: 'today'` を渡すのと同じで、ほかの引数も `list` と同じに読みます。`date`、`from`、`to` を渡すと、窓が2つになるのでエラーです（`Cannot use 'date' with today, which is date=today; use list date=2026-10-10`）。

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `file` | `string` | ファイルパスで絞り込み（`.md` は補われる） |
| `status` | `string \| string[]` | ステータス文字 |
| `tag` | `string \| string[]` | タグ名（カンマ区切り文字列も可。下位のタグも含む） |
| `content` | `string` | コンテンツ部分一致 |
| `due` | `string` | 締切日 = 指定値 |
| `leaf` | `boolean` | 子なしタスクのみ |
| `property` | `string` | カスタムプロパティ（`key:value`） |
| `color` | `string \| string[]` | カード色 |
| `type` | `string \| string[]` | タスク notation（`taskviewer`, `tasks`, `dayplanner`） |
| `root` | `boolean` | 親タスクを持たないタスクのみ |
| `filter` | `FilterState` | 完全なフィルタ定義 |
| `filterFile` | `string` | vault 内フィルタファイルパス（`.json` / `.md` テンプレート） |
| `list` | `string` | ピン留めリスト名（`filterFile` が `.md` テンプレートの場合） |
| `sort` | `ApiSortRule[]` | ソートルール |
| `limit` | `number` | 最大件数（デフォルト: 100, 0=件数のみ, Infinity=無制限） |

`today` の「本日」は、startHour を考慮した今の visual な日付です。期間が本日の visual な日と重なるタスクを返します。締切だけのタスクは、締切を終了とみなした期間で当たります。

**ApiSortRule:** `{ property, direction? }`。`property` は次のいずれかで、`direction` は `'asc'`（既定）か `'desc'` です。値の無いタスクは `asc` で先に来ます。`sort` を渡さないときは `due`、`startDate`、`content` の順です。知らない `property` はエラーです（`Invalid sort: rules[0]: Unknown sort property: ...`）。

| property | 比べる値 |
|----------|----------|
| `content` | タスクの内容 |
| `due` | 実効の締切（見出しやノートから受け継いだものを含む）。時刻があれば時刻も |
| `startDate` | 期間の開始の瞬間。時刻まで比べ、日付だけの開始はその日の先頭 |
| `endDate` | 期間の終了の瞬間。時刻まで比べ、日付だけの終了はその日の最後 |
| `file` | ファイルパス |
| `status` | ステータス文字 |
| `tag` | タグ（受け継いだものを含む）の先頭 |

**戻り値: `TaskListResult`**

```typescript
{
  total: number;       // フィルタ後・limit適用前の総件数
  count: number;       // 返却件数 (= tasks.length)
  truncated: boolean;  // count < total
  limit: number | null; // 適用された limit (null = unlimited)
  tasks: NormalizedTask[];
}
```

## get

```javascript
const task = api.get({ id: 'abc123' });
// => NormalizedTask
```

**GetParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `id` | ○ | `string` | タスクID |

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
| `due` | | `string` | 締切（`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`）。時刻は日付の後にだけ付けられます。時刻だけはエラーです |
| `status` | | `string` | ステータス文字（デフォルト: ` `） |
| `heading` | | `string` | 挿入先見出し。レベルを問わず、Obsidian のリンク `[[#見出し]]` と同じ比べ方で探します。節の先頭か末尾かは設定「節に行を足す位置」に従います。見出しが無ければ、ノートの末尾に設定のレベルで作ります。同じ名前の見出しが 2 つ以上あれば書き込みません |

## update

```javascript
const result = await api.update({
  id: 'abc123',
  status: 'x',
  content: 'Updated content',
});
// => { task: NormalizedTask }
```

**UpdateParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `id` | ○ | `string` | タスクID |
| `content` | | `string` | 新しい内容。`'none'` も文字列としてそのまま書きます |
| `start` | | `string` | 新しい開始日時。`'none'` で消します |
| `end` | | `string` | 新しい終了日時。`'none'` で消します |
| `due` | | `string` | 新しい締切。時刻は日付の後にだけ付けられます。`'none'` で消します |
| `status` | | `string` | 新しいステータス文字。`'none'` で未完了（` `）に戻します |

値の形は create と同じです。

## delete

```javascript
const result = await api.delete({ id: 'abc123' });
// => { deleted: 'abc123' }
```

**DeleteParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `id` | ○ | `string` | タスクID |

## duplicate

`dayOffset` が複写を並べる軸を決め、`count` が本数を決めます。

```javascript
// 元の続きに1つ。元が 10:00>11:30 なら複写は 11:30>13:00
const result = await api.duplicate({ id: 'abc123' });
// => { duplicated: 'abc123' }

// 元の続きに3つ、時刻を連ねる（11:30>13:00、13:00>14:30、14:30>16:00）
const result = await api.duplicate({ id: 'abc123', count: 3 });

// 日付を1日ずらして3つコピー（元の直前、新しい日付が上）
const result = await api.duplicate({ id: 'abc123', dayOffset: 1, count: 3 });
```

`dayOffset` を指定しない複写は、元タスクの続きに置かれます。**実効 end から始まり、長さを保ちます**。end を書いていないタスクの実効 end は開始の1時間後です。複写は元タスクとその子行の後ろに入り、`count` が2以上ならその長さぶんずつ連なります。

時刻を持たないタスク（終日、日数の範囲、日付なし）はずらす先が無いので、複写は同じ行がそのまま増えます。位置は同じく元タスクの続きです。

子の行は日付や時刻を含めてそのまま写されます。日をずらす複写は、start と end と同じ日数だけ due もずらします。新しいタスクとして毎回の締め切りが要るからです。時刻の軸の複写は due をずらしません。

**DuplicateParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `id` | ○ | `string` | タスクID |
| `dayOffset` | | `number` | 日付シフト日数（整数。デフォルト: 0。0 なら時刻の軸で連ねる。それ以外は最初の複写をその日数ずらし、次からは1日ずつ後へ。負なら前の日へ） |
| `count` | | `number` | コピー数（1 以上の整数。デフォルト: 1） |

## tasksForDateRange

```javascript
const result = await api.tasksForDateRange({
  from: '2026-03-01',
  to: '2026-03-31',
  tag: 'work',
  sort: [{ property: 'startDate', direction: 'asc' }],
});
// => TaskListResult（list と同じ { total, count, truncated, limit, tasks }）
```

visual な期間が窓 [from, to] と重なるタスクを返します。締切だけのタスクは、締切を終了とみなした期間で当たります。プリセットは期間の全体をとります（`from: 'thisWeek', to: 'thisWeek'` はその週）。単純フィルタ、`filter`、`filterFile` と `list` は窓の中のタスクを絞るだけで、窓は動かしません。フィルタの元の選び方は list と同じです。

**TasksForDateRangeParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `from` | ○ | `string` | クエリ窓の開始（YYYY-MM-DD またはプリセット、inclusive） |
| `to` | ○ | `string` | クエリ窓の終了（YYYY-MM-DD またはプリセット、inclusive） |
| `file` | | `string` | ファイルパス（`.md` は補われる） |
| `status` | | `string \| string[]` | ステータス文字 |
| `tag` | | `string \| string[]` | タグ名（下位のタグも含む） |
| `content` | | `string` | コンテンツ部分一致 |
| `due` | | `string` | 締切日 = 指定値 |
| `leaf` | | `boolean` | 子タスクを持たないタスクのみ |
| `property` | | `string` | カスタムプロパティ（`key:value`） |
| `color` | | `string \| string[]` | カード色 |
| `type` | | `string \| string[]` | タスク notation |
| `root` | | `boolean` | 親タスクを持たないタスクのみ |
| `filter` | | `FilterState` | フィルタ定義（単純フィルタより優先） |
| `filterFile` | | `string` | フィルタファイル（`.json` / `.md` テンプレート。`filter` より優先） |
| `list` | | `string` | ピン留めリスト名（`filterFile` が `.md` テンプレートの場合） |
| `sort` | | `ApiSortRule[]` | ソートルール |
| `limit` | | `number` | 最大件数（デフォルト: 100, 0=件数のみ, Infinity=無制限） |

## categorizedTasksForDateRange

```javascript
const result = await api.categorizedTasksForDateRange({
  from: '2026-03-01',
  to: '2026-03-31',
});
// => { "2026-03-01": { allDay: [...], timed: [...] }, ... }
```

日付範囲のタスクを日付ごとに allDay（終日）/ timed（時刻あり）に分類して返します。

日付への所属は、startHour を考慮した visual な日付（タイムラインのカード表示と同じ基準）で判定されます。締切だけのタスクは締切を終了とみなした期間を持ち、日付の締切は allDay、時刻付きの締切は timed に入ります。絞り込みのパラメータは tasksForDateRange と同じで、窓の中のタスクを絞るだけです。

**CategorizedTasksForDateRangeParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `from` | ○ | `string` | クエリ窓の開始（YYYY-MM-DD またはプリセット、inclusive） |
| `to` | ○ | `string` | クエリ窓の終了（YYYY-MM-DD またはプリセット、inclusive） |
| `file` | | `string` | ファイルパス（`.md` は補われる） |
| `status` | | `string \| string[]` | ステータス文字 |
| `tag` | | `string \| string[]` | タグ名（下位のタグも含む） |
| `content` | | `string` | コンテンツ部分一致 |
| `due` | | `string` | 締切日 = 指定値 |
| `leaf` | | `boolean` | 子タスクを持たないタスクのみ |
| `property` | | `string` | カスタムプロパティ（`key:value`） |
| `color` | | `string \| string[]` | カード色 |
| `type` | | `string \| string[]` | タスク notation |
| `root` | | `boolean` | 親タスクを持たないタスクのみ |
| `filter` | | `FilterState` | フィルタ定義（単純フィルタより優先） |
| `filterFile` | | `string` | フィルタファイル（`.json` / `.md` テンプレート。`filter` より優先） |
| `list` | | `string` | ピン留めリスト名（`filterFile` が `.md` テンプレートの場合） |

## insertChildTask

```javascript
const result = await api.insertChildTask({
  parentId: 'abc123',
  content: 'サブタスク',
});
// => { parentId: 'abc123' }
```

親の最初の子として `- [ ] サブタスク` を挿入します。

**InsertChildTaskParams:**

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `parentId` | ○ | `string` | 親タスクID |
| `content` | ○ | `string` | 子タスクの内容 |

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

API の詳細リファレンスを表示します。パラメータ、フィールド、フィルタの演算子、並べ替えの性質の一覧は、プラグインが使う表から作られます。

**エディタ（DataviewJS）で表示:**

```dataviewjs
const api = app.plugins.plugins['obsidian-task-viewer'].api;
dv.paragraph("```\n" + api.help() + "\n```");
```

**コンソール（DevTools: Ctrl+Shift+I）で表示:**

```javascript
console.log(app.plugins.plugins['obsidian-task-viewer'].api.help())
```

## FilterState

`filter` と `.json` のフィルタファイルが受け取る形です。ビューのフィルタメニューが保存する形と同じです。

```json
{
  "logic": "and",
  "filters": [
    { "property": "tag", "operator": "includes", "value": ["work"] },
    { "logic": "or", "filters": [
      { "property": "due", "operator": "onOrBefore", "value": { "preset": "today" } },
      { "property": "status", "operator": "includes", "value": ["!"] }
    ] }
  ]
}
```

- 条件は `{ property, operator, value?, target? }` です。`filters` にはグループ（`{ logic, filters }`）も入れられます
- 条件1つだけをそのまま渡すこともできます（`{ property: 'tag', operator: 'includes', value: ['work'] }`）

| property | 演算子 | 値 |
|----------|--------|-----|
| `file` | `includes`, `excludes` | `string[]`。ファイルパス全体 |
| `tag` | `includes`, `excludes`, `equals`, `only` | `string[]`。`includes` と `excludes` は下位のタグも含む（`work` は `work/x` にも当たる）。`equals` はそのタグちょうど、`only` はタスクのタグがこの集合だけ |
| `status` | `includes`, `excludes` | `string[]`。ステータス文字 |
| `content` | `contains`, `notContains` | `string`。大文字小文字を問わない部分一致 |
| `startDate` | `isSet`, `isNotSet`, `equals`, `before`, `after`, `onOrBefore`, `onOrAfter` | 日付 `'YYYY-MM-DD'`、日時 `'YYYY-MM-DDTHH:mm'`、`{ preset, n? }`、範囲 `{ from?, to? }`（`equals` だけ）。タスクの開始の瞬間を、値の視覚日の窓と比べる（下の「日付の値の比べ方」） |
| `endDate` | `isSet`, `isNotSet`, `equals`, `before`, `after`, `onOrBefore`, `onOrAfter` | startDate と同じ。終了の瞬間を区間の終わりとして比べる |
| `due` | `isSet`, `isNotSet`, `equals`, `before`, `after`, `onOrBefore`, `onOrAfter` | startDate と同じ。締切の瞬間（受け継いだ締切を含む）を区間の終わりとして比べる |
| `period` | `overlaps`, `within`, `notOverlaps`, `notWithin` | 日付、日時、プリセット、範囲。開始から終了までの期間が、値の窓と重なるか、窓に含まれるか（とその否定）。期限は見ない。期間の無いタスクはどれにも当たらない。`target: parent` は受けない |
| `anyDate` | `isSet`, `isNotSet` | なし。開始、終了、締切のどれかがあれば set |
| `color` | `includes`, `excludes` | `string[]` |
| `linestyle` | `includes`, `excludes` | `string[]` |
| `length` | `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`, `equals`, `isSet`, `isNotSet` | `number` と `unit`（`'hours'` が既定、`'minutes'`）。実効の開始から終了まで |
| `notation` | `includes`, `excludes` | `string[]`。`taskviewer`、`tasks`、`dayplanner` |
| `parent` | `isSet`, `isNotSet` | なし |
| `children` | `isSet`, `isNotSet` | なし。子タスクだけを数える |
| `property` | `isSet`, `isNotSet`, `equals`, `contains`, `notContains` | `key` と `value`（`string`）。`equals` は完全一致、`contains` は大文字小文字を問わない |

日付のプリセットは `today`、`thisWeek`、`nextWeek`、`pastWeek`、`nextNDays`（`n` で日数）、`thisMonth`、`thisYear` です。

### 日付の値の比べ方

- 日付とプリセットは視覚日（設定の startHour で始まる日）の窓です。`2026-10-04` は `[10/04 05:00, 10/05 05:00)`（startHour 5）
- 範囲 `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` は、`from` の日の始まりから `to` の日の終わりまでの窓で、両端の日を含みます。端は日付、日時、プリセットのどれでもよく、片方を省くとその側は開いた窓になります。`{}` と、`from` が `to` より後の範囲はエラーです。開始、終了、締切の条件では `equals` だけが範囲を受けます（`'due' takes a range only with equals`）
- 開始は窓の中にあれば窓に属し、終了と締切は窓を閉じる側として比べます。`@2026-10-04` は「開始 = 10/04」「終了 = 10/04」に当たり、ちょうど `2026-10-05T05:00` の締切は 10/04 に属します
- 日時 `2026-10-04T10:00` は瞬間で、開始か終了かを問わず数で比べます。`@2026-10-04T09:00>10:00` は「終了 `before` 10:00」に当たらず、「`onOrBefore`」と「`equals`」に当たります。`@2026-10-04` は「開始 `before` `2026-10-04T10:00`」に当たります
- `period` に日時を1つ書くと、その瞬間に期間がかかっているタスク（開始 ≤ 瞬間 < 終了）に当たります
- 読み込んだ `YYYY-MM-DD HH:mm` は `YYYY-MM-DDTHH:mm` に直して保存します

### 否定と `target: parent`

- 否定の演算子（`excludes`、`notContains`、`isNotSet`）は、肯定の演算子（`includes`、`contains`、`isSet`）が当たらないタスクを通します。`period` の否定（`notOverlaps`、`notWithin`）は例外で、期間の無いタスクを通しません
- `period` の条件は `target` を受けません（`'period' asks about the task itself: it takes no target parent`）
- `"target": "parent"` は、条件をタスクの祖先（親、その親、…）に問います。肯定の演算子は、祖先のどれかが当たれば通ります。否定の演算子は、どの祖先も肯定に当たらないときに通ります。したがって、親の無いタスクは否定の条件を通り、肯定の条件を通りません
- 例: `{ property: 'tag', operator: 'excludes', value: ['archive'], target: 'parent' }` は、親か祖父のどちらかが `#archive` を持つタスクを外します

### 値を選んでいない条件

値を選んでいない条件（空の配列、日付の無い日付の条件、両端とも選んでいない範囲、数の無い `length`、`key` の無い `property`）は、すべてのタスクを通します。フィルタメニューで行を足したばかりの状態です。

### 読めない条件

次のような条件は読めません: 知らない `property`、その `property` が取らない演算子、形の合わない値（集合に文字列、実在しない日 `2026-02-30`、知らないプリセット、数でない `length`、`self` と `parent` 以外の `target`）。

- `filter` と `filterFile` では、エラーになります。文は場所を付けて、読めない所をすべて並べます（`Invalid filter: filters[1].filters[0]: ...; filters[2]: ...`）。`filter: {}` も `not a filter group` でエラーです
- 保存されたビュー、テンプレート、URI では、その条件を外して読み、通知します

## NormalizedTask フィールド

API が返すタスクオブジェクトのフィールド一覧です。CLI の `output-fields` でも同じ名前を使用します。

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
| `due` | `string \| null` | 生の締切（`YYYY-MM-DD` か `YYYY-MM-DDTHH:mm`） |
| `tags` | `string[]` | タグ一覧（`#` なし。見出しやノートから受け継いだものを含む） |
| `parserId` | `string` | パーサー種別（`tv-inline`、`tasks-plugin`、`day-planner` のいずれか） |
| `parentId` | `string \| null` | 親タスクID |
| `childIds` | `string[]` | 子タスクID一覧 |
| `color` | `string \| null` | カードの色 |
| `linestyle` | `string \| null` | 線スタイル |
| `effectiveStartDate` | `string \| null` | 期間の開始の瞬間の暦の日付（`@2026-10-04` は `2026-10-04`） |
| `effectiveStartTime` | `string \| null` | 期間の開始の瞬間の時刻（`@2026-10-04` は startHour の `05:00`） |
| `effectiveEndDate` | `string \| null` | 期間の終了の瞬間の暦の日付（`@2026-10-04` は `2026-10-05`） |
| `effectiveEndTime` | `string \| null` | 期間の終了の瞬間の時刻（`@2026-10-04` は `05:00`。期間は終了の瞬間を含まない） |
| `effectiveDue` | `string \| null` | 受け継ぎを含む締切。行に無ければ見出しやノートの締切（フィルタと並べ替えの `due` はこの値） |
| `durationMinutes` | `number \| null` | 所要時間（分）。期間の開始から終了まで（フィルタの `length` と同じ。`@2026-10-04` と `@>>2026-10-04` は 1440）。日付も締切も無いタスクは `null` |
| `properties` | `Record<string, unknown>` | カスタムプロパティ。値は型に従う: 数は `number`、真偽値（`true` `True` `TRUE` `false` `False` `FALSE`。行でも frontmatter でも同じ）は `boolean`、配列は `string[]`、ほかは `string` |
| `flow` | `string \| null` | `==>` に続くフローのコマンドを正規の形で1行にしたもの（例: `every tue,fri`、[コマンド](commands.md)）。子の `- ==>` 行も含む。無ければ `null` |

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
