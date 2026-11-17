import { execFileSync } from 'child_process';
import { VAULT_NAME } from '../vault/location';

/**
 * Run the Obsidian CLI against the E2E vault and return what it printed.
 * The vault is always named, so a call does not depend on which vault's
 * window is in front, and never reaches a vault the user works in. Each
 * argument is handed over as it is, not through a shell.
 *
 * SIGKILL: a CLI client has been seen to wait more than ten minutes for an
 * answer that never came, and not to end on the SIGTERM the timeout sent,
 * which left the suite hanging instead of failing the call.
 */
function runCli(args: string[]): string {
    return execFileSync('obsidian', [`vault=${VAULT_NAME}`, ...args],
        { encoding: 'utf-8', timeout: 15000, killSignal: 'SIGKILL' }).trim();
}

/**
 * Execute one of the plugin's CLI commands in the E2E vault and return its
 * answer parsed as JSON. A flag `true` is passed bare, a flag `false` or
 * empty not at all. A failed call, or an answer that is not JSON, comes
 * back as `{ error }`.
 */
export function obsidianCli(command: string, flags: Record<string, string | boolean> = {}): unknown {
    const args: string[] = [];
    for (const [key, val] of Object.entries(flags)) {
        if (val === true) {
            args.push(key);
        } else if (val !== false && val !== '') {
            args.push(`${key}=${String(val)}`);
        }
    }

    let raw: string;
    try {
        raw = runCli([`obsidian-task-viewer:${command}`, ...args]);
    } catch (err: unknown) {
        // A non-zero exit throws; stderr may hold the error
        const msg = (err as { stderr?: string }).stderr?.trim()
            || (err as { stdout?: string }).stdout?.trim()
            || String(err);
        return { error: msg };
    }

    try {
        return JSON.parse(raw);
    } catch {
        // Non-JSON output (e.g. Obsidian's built-in "Error: Missing required parameter" text)
        return { error: raw };
    }
}

/**
 * `code` with every character outside ASCII written as its `\uXXXX` escape,
 * which a string, a template and a regular expression of JavaScript read as
 * the character.
 *
 * A character of several bytes does not always reach Obsidian whole: one
 * whose bytes lie across the 8048th byte of the code arrived as two U+FFFD
 * (Obsidian 1.14.5's CLI on macOS; the code seems to be handed over in
 * pieces of 8192 bytes, each decoded by itself). A text of the vault's
 * locale in a snippet that long (a menu item's title) then no longer equals
 * the text on the screen, for one length of the snippet and not for the
 * next.
 */
function asciiOnly(code: string): string {
    return code.replace(/[^\x00-\x7f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Evaluate `code` in the E2E vault's Obsidian (`obsidian eval`) and return
 * the value it printed, parsed as JSON when it is JSON. `code` is an
 * expression; a Promise is waited for. A thrown error comes back as
 * `{ error }`. The code is passed as one argument, not through a shell, so it
 * needs no quoting. Killed as a CLI call is (see {@link runCli}).
 */
export function obsidianEval(code: string): unknown {
    let raw: string;
    try {
        raw = runCli(['eval', `code=${asciiOnly(code)}`]);
    } catch (err: unknown) {
        return { error: (err as { stderr?: string }).stderr?.trim() || String(err) };
    }
    // The console lines the code wrote come first; the value is on the line
    // `=> ` opens.
    const at = raw.lastIndexOf('=> ');
    const value = at >= 0 && (at === 0 || raw[at - 1] === '\n') ? raw.slice(at + 3) : raw;
    if (value.startsWith('Error:')) return { error: value };
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/** List tasks. Returns { count, tasks }. */
export function cliList(flags: Record<string, string> = {}): ListResult {
    return obsidianCli('list', flags) as ListResult;
}

/** List today's tasks. Returns { count, tasks }. */
export function cliToday(flags: Record<string, string> = {}): ListResult {
    return obsidianCli('today', flags) as ListResult;
}

/** Get a single task by ID. */
export function cliGet(id: string, flags: Record<string, string> = {}): Record<string, unknown> {
    return obsidianCli('get', { id, ...flags }) as Record<string, unknown>;
}

/** Create a task. Returns { task }. */
export function cliCreate(flags: Record<string, string>): MutationResult {
    return obsidianCli('create', flags) as MutationResult;
}

/** Update a task. Returns { task }. */
export function cliUpdate(flags: Record<string, string>): MutationResult {
    return obsidianCli('update', flags) as MutationResult;
}

/** Delete a task. Returns { deleted }. */
export function cliDelete(id: string): DeleteResult {
    return obsidianCli('delete', { id }) as DeleteResult;
}

/** Duplicate a task. Returns { duplicated }. */
export function cliDuplicate(flags: Record<string, string>): DuplicateResult {
    return obsidianCli('duplicate', flags) as DuplicateResult;
}

/** List tasks in a date range. Returns { count, tasks }. */
export function cliTasksForDateRange(flags: Record<string, string>): ListResult {
    return obsidianCli('tasks-for-date-range', flags) as ListResult;
}

/** Get tasks in a date range, categorized per date, with `flags` besides. Returns Record<date, { allDay, timed }>. */
export function cliCategorizedTasksForDateRange(from: string, to: string, flags: Record<string, string> = {}): CategorizedForDateRangeResult {
    return obsidianCli('categorized-tasks-for-date-range', { from, to, ...flags }) as CategorizedForDateRangeResult;
}

/** Insert a child task under a parent. Returns { parentId }. */
export function cliInsertChildTask(flags: Record<string, string>): InsertChildTaskResult {
    return obsidianCli('insert-child-task', flags) as InsertChildTaskResult;
}

/** Get the current startHour setting. Returns { startHour }. */
export function cliGetStartHour(): StartHourResult {
    return obsidianCli('get-start-hour') as StartHourResult;
}

/** Show CLI help text. Returns raw text string. */
export function cliHelp(): string {
    const result = obsidianCli('help');
    return typeof result === 'string' ? result : JSON.stringify(result);
}

/** Sleep for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Types ──

export interface ListResult {
    count: number;
    tasks: Record<string, unknown>[];
}

export interface MutationResult {
    task: Record<string, unknown>;
}

export interface DeleteResult {
    deleted: string;
}

export interface DuplicateResult {
    duplicated: string;
}

export interface CategorizedResult {
    allDay: Record<string, unknown>[];
    timed: Record<string, unknown>[];
}

export type CategorizedForDateRangeResult = Record<string, CategorizedResult>;

export interface InsertChildTaskResult {
    parentId: string;
}

export interface StartHourResult {
    startHour: number;
}
