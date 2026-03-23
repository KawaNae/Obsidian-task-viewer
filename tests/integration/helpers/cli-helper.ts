import { execSync } from 'child_process';

/**
 * Execute an Obsidian CLI command via PowerShell and return parsed JSON.
 * Requires Obsidian to be running with the Dev vault open.
 */
export function obsidianCli(command: string, flags: Record<string, string | boolean> = {}): unknown {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(flags)) {
        if (val === true) {
            parts.push(key);
        } else if (val !== false && val !== '') {
            // Quote values that contain spaces so the CLI parser doesn't split them
            const strVal = String(val);
            const needsQuoting = strVal.includes(' ');
            parts.push(needsQuoting ? `${key}='${strVal}'` : `${key}=${strVal}`);
        }
    }
    const args = parts.join(' ');
    const fullCmd = `obsidian obsidian-task-viewer:${command}${args ? ' ' + args : ''}`;

    let raw: string;
    try {
        raw = execSync(
            `powershell.exe -Command "${fullCmd}"`,
            { encoding: 'utf-8', timeout: 15000 },
        ).trim();
    } catch (err: unknown) {
        // execSync throws on non-zero exit code; stderr may contain the error
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

/** Check if Obsidian CLI is reachable. */
export function isObsidianRunning(): boolean {
    try {
        const result = obsidianCli('list', { limit: '1' });
        return result !== null && typeof result === 'object';
    } catch {
        return false;
    }
}

/** Sleep for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll until a task matching the predicate appears in list results.
 * Returns the matching task, or null if timeout is reached.
 */
export async function waitForTask(
    flags: Record<string, string>,
    predicate: (task: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
    intervalMs = 200,
): Promise<Record<string, unknown> | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const result = cliList(flags);
        const found = result.tasks.find(predicate);
        if (found) return found;
        await sleep(intervalMs);
    }
    return null;
}

/**
 * Poll until a task disappears from list results.
 * Returns true if the task is gone, false if timeout is reached.
 */
export async function waitForTaskGone(
    flags: Record<string, string>,
    predicate: (task: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
    intervalMs = 200,
): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const result = cliList(flags);
        const found = result.tasks.find(predicate);
        if (!found) return true;
        await sleep(intervalMs);
    }
    return false;
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
