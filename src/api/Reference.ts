import {
    renderFlagTable, renderParamTable, toCliName, type ParamSpec,
    LIST_SCHEMA, TODAY_SCHEMA, GET_SCHEMA, CREATE_SCHEMA, UPDATE_SCHEMA,
    DELETE_SCHEMA, DUPLICATE_SCHEMA,
    TASKS_FOR_DATE_RANGE_SCHEMA, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA,
    INSERT_CHILD_TASK_SCHEMA, EXPORT_IMAGE_SCHEMA, CLI_OUTPUT_SCHEMA, LIMIT_PARAM,
} from './OperationSchemas';
import { ALL_FIELD_NAMES } from './TaskNormalizer';
import { exportableShortNames } from '../views/ViewDescriptors';
import type { TaskApi } from './TaskApi';
import { PROPERTY_OPERATORS, MAX_FILTER_DEPTH, RELATIVE_DATE_PRESETS, type FilterProperty } from '../services/filter/FilterTypes';
import { NAMED_DATE_PRESETS } from '../services/filter/DatePreset';
import { TaskValues } from '../services/filter/TaskValues';
import { SORT_PROPERTIES } from '../services/sort/SortTypes';
import { DEFAULT_SORT_ORDER } from '../services/sort/TaskSorter';

/**
 * The reference texts: `api.help()` (`API_REFERENCE`) and the CLI's `help`
 * command (`CLI_REFERENCE`). Both are made here from the tables the plugin
 * runs on, so what they list cannot drift from what is taken:
 *
 *   - the operations (`OPERATIONS`): their summaries, parameters
 *     (`OperationSchemas`), results and notes. The CLI registers its commands
 *     from the same table (`CLI_COMMANDS`).
 *   - the fields a task is handed out with (`ALL_FIELD_NAMES`)
 *   - the filter's properties and operators (`PROPERTY_OPERATORS`), with how
 *     each property's value is written (`FILTER_VALUE_DOC`)
 *   - the sort's properties (`SORT_PROPERTIES`), with what each compares
 *     (`TaskValues.words`) and the order without rules (`DEFAULT_SORT_ORDER`)
 *
 * Only the prose between the tables is written by hand.
 */

// ── Operations ──

/**
 * How the CLI checks a command's flags before its handler runs.
 * `strict`: only the declared flags, a boolean one without a value.
 * `handler`: the handler checks its flags itself — `export-image` takes the
 * flags of the view it exports, which are known only once the view is.
 */
export type FlagCheck = 'strict' | 'handler';

interface Operation {
    /** One line, for both references and the CLI's command list. */
    readonly summary: string;
    readonly schema?: Record<string, ParamSpec>;
    /** Prose under the parameters, in both references. */
    readonly notes?: string;
    /** As a method of the API; absent when the CLI alone has it. */
    readonly api?: { readonly signature: string; readonly returns?: string };
    /** As a command of the CLI (named `toCliName` of the key); absent when the API alone has it. */
    readonly cli?: {
        /** Prints tasks: takes `format` and `output-fields`. */
        readonly output?: true;
        readonly flagCheck?: FlagCheck;
        readonly returns?: string;
        readonly notes?: string;
    };
}

const WINDOW_NOTE = `\
The window (date, or from and to) matches the task's effective calendar
dates and leaves out due-only tasks. The date-range operations match the
visual (startHour-adjusted) span, as the views do, and include due-only
tasks whose due falls in the window.`;

const SOURCE_NOTE = `\
Where the filter comes from: filterFile, else filter (API only), else the
simple fields. What is overridden is not read. A pinned list (list) needs
filterFile, a .md view template. A filter file is answered as the views
answer it: without the tasks that have a validation error, and in the
pinned list's own order unless sort is given. Without a filter file, the
tasks with a validation error are listed too.`;

const RANGE_NOTE = `\
from and to are required; a preset takes its whole span (from=thisWeek
to=thisWeek is the week). The filter narrows the tasks in the window; it
does not move the window.`;

const EXPORT_NOTE = `\
Exports a view as a PNG image at 2× pixel ratio.
Supported views: ${exportableShortNames().join(', ')}.
Very large calendars (thousands of task cards) may exceed rendering limits.

Modes:
  view=timeline                        Captures the open view (must be visible).
  view=timeline start-date=2026-07-14  Opens a temporary window, renders with
                                       the given config, captures, closes it.

The view's own config flags are taken too (use an unknown flag to see them):
  timeline : start-date=, days-to-show=, zoom-level=, show-all-day=, mask-mode=, ...
  calendar : window-start=, mask-mode=, ...
  schedule : current-date=, mask-mode=, ...
  kanban   : mask-mode=, ...
A template's or a flag's filter that cannot be read is an error.

Behavior:
  - Default filename: {name or template or viewType}_{YYYY-MM-DD}.png;
    the same day's export overwrites it.
  - width/height in the result are CSS pixels of the expanded content. The
    PNG is twice that, clamped to 16384px (tall views are scaled down).
  - wait= and keep-open apply to the temporary window only.
  - output-folder: vault-relative or absolute. Default: the export folder
    setting. A relative folder is written through the vault; an absolute
    one needs the desktop app. The returned path uses forward slashes.`;

/**
 * Every operation, under its API name; its CLI command is `toCliName` of it.
 * The order is the references' order.
 */
export const OPERATIONS = {
    list: {
        summary: 'List tasks with filters, sort, and pagination',
        schema: LIST_SCHEMA,
        notes: `${WINDOW_NOTE}\n\n${SOURCE_NOTE}`,
        api: { signature: 'list(params?: ListParams): Promise<TaskListResult>', returns: 'TaskListResult' },
        cli: { output: true },
    },
    today: {
        summary: 'List tasks active today (visual-date aware)',
        schema: TODAY_SCHEMA,
        notes: `\
Today is the visual date of now. A task is active when its effective start
is on or before today and its effective end on or after (a start without
an end: that day only), or, without a start, when its due is today.`,
        api: { signature: 'today(params?: TodayParams): TaskListResult', returns: 'TaskListResult' },
        cli: { output: true },
    },
    get: {
        summary: 'Get a single task by ID',
        schema: GET_SCHEMA,
        api: { signature: 'get(params: GetParams): NormalizedTask' },
        cli: { output: true },
    },
    create: {
        summary: 'Create a new inline task',
        schema: CREATE_SCHEMA,
        api: { signature: 'create(params: CreateParams): Promise<MutationResult>', returns: '{ task: NormalizedTask }' },
        cli: { output: true },
    },
    update: {
        summary: 'Update an existing task',
        schema: UPDATE_SCHEMA,
        notes: '"none" clears start, end and due, and unchecks status; content takes "none" as text.',
        api: { signature: 'update(params: UpdateParams): Promise<MutationResult>', returns: '{ task: NormalizedTask } (a task without a ^id comes back under its new ID)' },
        cli: { output: true },
    },
    delete: {
        summary: 'Delete a task',
        schema: DELETE_SCHEMA,
        api: { signature: 'delete(params: DeleteParams): Promise<DeleteResult>', returns: '{ deleted: string }' },
        cli: { returns: '{ "deleted": "<id>" }' },
    },
    duplicate: {
        summary: 'Duplicate a task with optional date shifting',
        schema: DUPLICATE_SCHEMA,
        notes: `\
Without dayOffset the copies run on the clock: the first starts where the
task ends and keeps its length. With it they run one per day. A task with
no time of day is copied as it is. A copy on another day moves its due by
the same days as its start and end; a copy on the clock keeps the due.`,
        api: { signature: 'duplicate(params: DuplicateParams): Promise<DuplicateResult>', returns: '{ duplicated: string }' },
        cli: { returns: '{ "duplicated": "<id>" }' },
    },
    tasksForDateRange: {
        summary: 'List tasks whose visual span overlaps a date range',
        schema: TASKS_FOR_DATE_RANGE_SCHEMA,
        notes: `${RANGE_NOTE}\nDue-only tasks are included when the due falls in the window.`,
        api: { signature: 'tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult>', returns: 'TaskListResult' },
        cli: { output: true },
    },
    categorizedTasksForDateRange: {
        summary: 'Get tasks in a date range, categorized into allDay/timed/dueOnly per date',
        schema: CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA,
        notes: `${RANGE_NOTE}\nallDay and timed follow the visual span; dueOnly the calendar date of the due.`,
        api: {
            signature: 'categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): Promise<CategorizedTasksForDateRangeResult>',
            returns: 'Record<date, { allDay: NormalizedTask[], timed: NormalizedTask[], dueOnly: NormalizedTask[] }>',
        },
        cli: { returns: '{ "YYYY-MM-DD": { "allDay": [...], "timed": [...], "dueOnly": [...] }, ... }' },
    },
    insertChildTask: {
        summary: 'Insert a child task under a parent task',
        schema: INSERT_CHILD_TASK_SCHEMA,
        notes: 'Inserts "- [ ] <content>" as the parent\'s first child.',
        api: { signature: 'insertChildTask(params: InsertChildTaskParams): Promise<InsertChildTaskResult>', returns: '{ parentId: string }' },
        cli: { returns: '{ "parentId": "<id>" }' },
    },
    getStartHour: {
        summary: 'Get the current startHour setting (visual day boundary)',
        api: { signature: 'getStartHour(): StartHourResult', returns: '{ startHour: number }' },
        cli: { returns: '{ "startHour": 5 }' },
    },
    onChange: {
        summary: 'Subscribe to task changes; returns the function that unsubscribes',
        api: { signature: 'onChange(callback: (taskId?: string) => void): () => void' },
    },
    exportImage: {
        summary: 'Export a view as a PNG image',
        schema: EXPORT_IMAGE_SCHEMA,
        cli: {
            flagCheck: 'handler',
            returns: '{ path, width, height, captureDurationMs, totalDurationMs, resolvedAnchor?, renderedRange? }',
            notes: EXPORT_NOTE,
        },
    },
    help: {
        summary: 'Show this reference',
        api: { signature: 'help(): string' },
        cli: {},
    },
} as const satisfies Record<string, Operation>;

type Operations = typeof OPERATIONS;
type OperationName = keyof Operations;

/** The operations the API has a method for. */
type ApiOperation = { [K in OperationName]: Operations[K] extends { api: object } ? K : never }[OperationName];

// The API's methods are the operations with `api`, no more and no fewer: a
// public method of TaskApi without its line in OPERATIONS (or a line without
// its method) is a compile error here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const API_METHODS_LISTED: Same<ApiOperation, keyof TaskApi> = true;
void API_METHODS_LISTED;

/** The operations the CLI has a command for. */
export type CliOperation = { [K in OperationName]: Operations[K] extends { cli: object } ? K : never }[OperationName];

export interface CliCommand {
    readonly operation: CliOperation;
    /** The command, without the plugin's prefix. */
    readonly name: string;
    readonly summary: string;
    readonly schema?: Record<string, ParamSpec>;
    readonly output: boolean;
    readonly flagCheck: FlagCheck;
}

/** The CLI's commands, in the reference's order. The registrar registers these and no others. */
export const CLI_COMMANDS: readonly CliCommand[] = (Object.keys(OPERATIONS) as OperationName[]).flatMap(key => {
    const op: Operation = OPERATIONS[key];
    if (!op.cli) return [];
    return [{
        operation: key as CliOperation,
        name: toCliName(key),
        summary: op.summary,
        schema: op.schema,
        output: op.cli.output === true,
        flagCheck: op.cli.flagCheck ?? 'strict',
    }];
});

// ── Filter values ──

/**
 * How a condition's value is written, for each property. `satisfies` keeps
 * it to the properties there are: a property added to the filter without a
 * line here is a compile error.
 */
export const FILTER_VALUE_DOC = {
    file: '"value": ["notes/a.md"] — whole file paths',
    tag: '"value": ["work"] — includes and excludes take sub-tags too (work matches work/x); equals is the exact tag; only = the task\'s tags are this set and no other',
    status: '"value": [" ", "x"] — status characters',
    content: '"value": "text" — contained, any case',
    startDate: '"value": "YYYY-MM-DD" or { "preset": "<preset>", "n"?: number } — the effective date, without its time',
    endDate: '(as startDate)',
    due: '(as startDate)',
    anyDate: 'no value — set when any of start, end and due is',
    color: '"value": ["red"]',
    linestyle: '"value": ["dashed"]',
    length: '"value": number, "unit"?: "hours" (default) | "minutes" — from the effective start to the effective end',
    notation: '"value": ["taskviewer" | "tasks" | "dayplanner"]',
    parent: 'no value',
    children: 'no value — child tasks only (plain checkbox lines and links are not)',
    property: '"key": "priority", "value": "high" — equals is exact, contains any case',
} as const satisfies Record<FilterProperty, string>;

// ── Shared sections ──

const indent = (text: string, n: number) => text.replace(/^(?=.)/gm, ' '.repeat(n));

function heading(title: string, underline = '-'): string {
    return `${title}\n${underline.repeat(title.length)}`;
}

/** `items` joined by ", " in lines of at most `width` characters. */
function wrapList(items: readonly string[], width = 74): string {
    const lines: string[] = [];
    let line = '';
    for (const item of items) {
        const next = line ? `${line}, ${item}` : item;
        if (next.length > width && line) {
            lines.push(line + ',');
            line = item;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines.join('\n');
}

/** `text` broken at spaces into lines of at most `width` characters. */
function wrapWords(text: string, width: number): string {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > width && line) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines.join('\n');
}

/** `text` with the API's keys of `schema` spelled as the CLI's flags (`dayOffset` as `day-offset`). */
function inCliSpelling(text: string, schema: Record<string, ParamSpec> | undefined): string {
    let out = text;
    for (const key of Object.keys(schema ?? {})) {
        const flag = toCliName(key);
        if (flag !== key) out = out.replace(new RegExp(`\\b${key}\\b`, 'g'), flag);
    }
    return out;
}

function propertiesSection(): string {
    const properties = Object.keys(PROPERTY_OPERATORS) as FilterProperty[];
    const width = Math.max(...properties.map(p => p.length)) + 1;
    const rows = properties.map(p =>
        `  ${p.padEnd(width)}: ${PROPERTY_OPERATORS[p].join(', ')}\n${indent(wrapWords(FILTER_VALUE_DOC[p], 74 - width), width + 4)}`);
    const presets = RELATIVE_DATE_PRESETS.map(p => (p === 'nextNDays' ? `${p} (with "n")` : p)).join(', ');
    return `${heading('Properties & Operators')}\n${rows.join('\n')}\n\n  Date presets in a FilterState:\n${indent(wrapWords(presets, 70), 4)}`;
}

function filterSection(): string {
    return `\
${heading('FilterState (JSON)')}
  { "logic": "and" | "or", "filters": [ <condition | group>, ... ] }

  Condition:
    { "property": "<property>", "operator": "<operator>", "value": <value>, "target"?: "parent" }
  A group is a FilterState inside filters; the filter menu nests them ${MAX_FILTER_DEPTH} deep.

  Example: tasks tagged exactly "work"
    { "logic": "and", "filters": [ { "property": "tag", "operator": "equals", "value": ["work"] } ] }

  Negative operators (excludes, notContains, isNotSet) pass a task when the
  positive one does not.

  A condition whose value is not chosen yet (an empty list, no date, no
  number, no key) passes every task.

  A condition that cannot be read — an unknown property, an operator the
  property does not take, a value of the wrong shape (a day that does not
  exist, an unknown preset) — is an error in filter and in a filter file.
  A saved view drops it and says so.

  Target:
    "target": "parent" asks the condition of the task's ancestors (the
    parent, its parent, ...). A positive operator passes when some ancestor
    matches; a negative one passes when no ancestor matches the positive
    form, so a task without a parent passes it.
    Example: tasks with an ancestor tagged "project":
    { "property": "tag", "operator": "includes", "value": ["project"], "target": "parent" }

${propertiesSection()}`;
}

function datesSection(): string {
    return `\
${heading('Dates, Times and Numbers')}
  Date:      YYYY-MM-DD (e.g. 2026-03-15), naming a day that exists
             (2026-02-30 is an error)
  Datetime:  YYYY-MM-DD HH:mm or YYYY-MM-DDTHH:mm (e.g. 2026-03-15 14:00);
             9:40 is read as 09:40
  Time only: HH:mm (e.g. 14:00), for start and end; a due needs a date
  Full-width digits and hyphen-like characters (ー, −) are read as ASCII,
  and spaces around a value are dropped.
  Presets (date, from, to, due; any case):
             ${NAMED_DATE_PRESETS.join(', ')},
             next<N>days (e.g. next7days)
  Whole numbers: digits only; 3days and 1.5 are errors. limit is
  ${LIMIT_PARAM.int.min} or more (0 counts only).`;
}

function sortSection(rule: string): string {
    const width = Math.max(...SORT_PROPERTIES.map(p => p.length)) + 2;
    const rows = SORT_PROPERTIES.map(p => `    ${p.padEnd(width)}${TaskValues.words(p)}`);
    return `\
${heading('Sort')}
  ${rule}
  Direction: asc (default), desc
  Properties, and what each compares:
${rows.join('\n')}
  A task without the value comes first in asc. Without rules: ${DEFAULT_SORT_ORDER.join(', ')}.`;
}

function fieldsSection(title: string): string {
    return `${heading(title)}\n${indent(wrapList(ALL_FIELD_NAMES), 2)}`;
}

const TASK_IDS = `\
${heading('Task IDs')}
  IDs take one of two shapes:
    path#^id  for a line whose ^id no other line of the file carries.
              It lasts across edits from outside and reloads.
    a name    for any other line: a receipt for one reading of the file.
              It lasts until the file changes outside the plugin or the
              plugin reloads, even when the file comes back to what it
              was. Do not store it; list the tasks again. Give a task a
              ^id to keep its ID.
  update returns the task as written: a name comes back as its new ID.`;

const VOCABULARY = `\
${heading('Vocabulary')}
  from / to         = query window (inclusive overlap). A task matches when
                      its span intersects [from, to].
  date              = single-day window, sugar for from=X to=X (list only)
  start / end / due = the task's own fields (create / update)`;

// ── API reference ──

function apiMethod(name: OperationName): string {
    const op: Operation = OPERATIONS[name];
    if (!op.api) return '';
    const parts = [`  ${op.api.signature}`, `    ${op.summary}.`];
    if (op.schema) {
        const typeName = name.charAt(0).toUpperCase() + name.slice(1) + 'Params';
        parts.push('', `    ${typeName}:`, indent(renderParamTable(op.schema), 4));
    }
    if (op.notes) parts.push('', indent(op.notes, 4));
    if (op.api.returns) parts.push('', `    Returns: ${op.api.returns}`);
    return parts.join('\n');
}

const API_EXAMPLES = `\
${heading('Examples')}
  const api = app.plugins.plugins['obsidian-task-viewer'].api;

  // Tasks of a file
  await api.list({ file: 'daily/2026-03-15' });

  // A FilterState
  await api.list({
    filter: { logic: 'and', filters: [{ property: 'tag', operator: 'equals', value: ['work'] }] },
  });

  // A filter file, and a pinned list of a view template
  await api.list({ filterFile: 'filters/exact-tag.json' });
  await api.list({ filterFile: 'templates/work.md', list: 'urgent' });

  // Today's tasks, by start date
  api.today({ sort: [{ property: 'startDate', direction: 'asc' }] });

  // One task
  api.get({ id: 'daily/2026-03-15.md#^review' });

  // Copies: one a day later; three on the clock
  await api.duplicate({ id: 'daily/2026-03-15.md#^review', dayOffset: 1 });
  await api.duplicate({ id: 'daily/2026-03-15.md#^review', count: 3 });

  // A date range (presets too)
  await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31' });
  await api.tasksForDateRange({ from: 'thisWeek', to: 'thisWeek' });
  await api.categorizedTasksForDateRange({ from: '2026-03-23', to: '2026-03-29' });

  // A child task
  await api.insertChildTask({ parentId: 'daily/2026-03-15.md#^review', content: 'Sub-task' });

  // Changes
  const unsubscribe = api.onChange((taskId) => console.log('Task changed:', taskId));
  unsubscribe();`;

export const API_REFERENCE = `
${heading('Task Viewer API Reference', '=')}

Access: app.plugins.plugins['obsidian-task-viewer'].api

${VOCABULARY}

  Unknown parameter keys are errors (with a did-you-mean suggestion); they
  are never ignored. Params written as comma-separated strings (status,
  tag, color, type) also take string arrays.

${heading('Errors')}
  A method throws TaskApiError. Its message ends with "— See api.help() for
  reference"; its rawMessage is without it, and param names the parameter
  the error is about, when it is about one.

${TASK_IDS}

${heading('Methods')}

${(Object.keys(OPERATIONS) as OperationName[]).map(apiMethod).filter(Boolean).join('\n\n')}

${heading('TaskListResult')}
  { total: number, count: number, truncated: boolean, limit: number | null, tasks: NormalizedTask[] }
  total counts the tasks before limit; limit is null for no limit (Infinity).

${sortSection("sort: [{ property, direction? }, ...] (e.g. [{ property: 'due', direction: 'desc' }])")}

${datesSection()}

${filterSection()}

${fieldsSection('NormalizedTask Fields')}

${API_EXAMPLES}
`.trim();

// ── CLI reference ──

const PREFIX = 'obsidian obsidian-task-viewer:';

function cliCommand(command: CliCommand): string {
    if (command.operation === 'help') return '';
    const op: Operation = OPERATIONS[command.operation];
    const parts = [heading(command.name), `  ${op.summary}.`, ''];
    parts.push(command.schema && Object.keys(command.schema).length > 0 ? renderFlagTable(command.schema) : '  (no flags)');
    if (command.output) parts.push('  (and format=, output-fields= — see Common Flags)');
    if (op.notes) parts.push('', indent(inCliSpelling(op.notes, op.schema), 2));
    if (op.cli?.notes) parts.push('', indent(op.cli.notes, 2));
    if (op.cli?.returns) parts.push('', `  Returns: ${op.cli.returns}`);
    return parts.join('\n');
}

const FILTER_FILE = `\
${heading('filter-file: File-based Filtering', '=')}

filter-file= reads a filter from a file in the vault, and list= picks a
pinned list of a view template. The API reads the file (as for filterFile),
so a part it cannot read is an error.

  .json — a FilterState (standard JSON):
    { "logic": "and", "filters": [ { "property": "tag", "operator": "equals", "value": ["work"] } ] }

    ${PREFIX}list filter-file=filters/exact-tag.json

  .md   — a view template saved from the plugin's "Save view..." menu,
          read as its view reads it:
    ${PREFIX}list filter-file=templates/work.md              (the view's filter)
    ${PREFIX}list filter-file=templates/work.md list=urgent  (a pinned list)

  A pinned list adds the view's filter when its "apply view filter" is on,
  and lists the tasks in its own order unless sort= is given. If the
  template has pinned lists and list= is omitted, the error names them.
  list= without filter-file= is an error.

  With filter-file=, the tasks that have a validation error are left out,
  as the views leave them out; without it, they are listed.

  Every checkbox is a task, dated or not, so list returns undated ones too.
  To keep only dated tasks, filter on anyDate; to keep only top-level
  tasks, pass root.`;

export const CLI_REFERENCE = `
${heading('Task Viewer CLI Reference', '=')}

${heading('Commands')}
${(() => {
        const width = Math.max(...CLI_COMMANDS.map(c => c.name.length)) + 2;
        return CLI_COMMANDS.map(c => `  ${c.name.padEnd(width)}${c.summary}`).join('\n');
    })()}

Run "obsidian help obsidian-task-viewer:<command>" for a command's flags alone.

${VOCABULARY}

  Flags use key=value only (--flag is not taken). Unknown flags are errors
  (with a did-you-mean suggestion). A flag given empty (x=) is an error.
  Boolean flags (leaf, root, keep-open) are given by name ("leaf") or
  as "leaf=true".

${heading('Errors')}
  An error prints { "error": "<what is wrong>", "help": "${PREFIX}help" }.
  A flag is named as written (parent-id, not parentId).

${heading('Common Flags')}
  For ${CLI_COMMANDS.filter(c => c.output).map(c => c.name).join(', ')}:
${renderFlagTable(CLI_OUTPUT_SCHEMA)}
  limit=<number|all> (listings): default 100 for json, all for tsv/jsonl.
    When results exceed limit:
      json:  "truncated": true and "total": N in the response
      tsv:   a trailing line: # truncated: showing N of M
      jsonl: a trailing record: {"_truncated":true,"showing":N,"total":M}
    TSV: tabs and line breaks in values are written as spaces.

${fieldsSection('Output Fields')}

${TASK_IDS}

${sortSection('sort=property[:direction],... (e.g. startDate:asc,due:desc)')}

${datesSection()}

${heading('Flags by Command', '=')}

${CLI_COMMANDS.map(cliCommand).filter(Boolean).join('\n\n')}

${FILTER_FILE}

${filterSection()}
`.trim();
