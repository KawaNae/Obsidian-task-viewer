import * as fs from 'fs';
import * as path from 'path';
import { VAULT_PATHS } from '../../../dev-paths.mjs';
import { sleep, cliList } from './cli-helper';

/** Dev vault root. Must match the path Obsidian is watching. */
const VAULT_PATH = VAULT_PATHS.dev;

/** Resolve a relative vault path to its absolute location on disk. */
export function vaultAbsolute(relativePath: string): string {
    return path.join(VAULT_PATH, relativePath);
}

/**
 * Write (or overwrite) a file in the Dev vault.
 * Parent directories are created automatically.
 */
export function writeTestFile(relativePath: string, content: string): void {
    const abs = vaultAbsolute(relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
}

/** Read a file from the Dev vault. */
export function readTestFile(relativePath: string): string {
    return fs.readFileSync(vaultAbsolute(relativePath), 'utf-8');
}

/** Delete a file from the Dev vault. Silently ignores missing files. */
export function deleteTestFile(relativePath: string): void {
    try {
        fs.unlinkSync(vaultAbsolute(relativePath));
    } catch {
        // file already gone — no-op
    }
}

/**
 * Wait for Obsidian to index a file by polling `cliList` until the file
 * appears (at least one task is returned), and no ID in `stale` is returned
 * any more.
 *
 * @param relativePath  vault-relative path (e.g. `test-scanning.md`)
 * @param timeoutMs     max wait time (default 8 000 ms)
 * @param stale         IDs of a reading the index must have left behind
 *                      (`writeIndexedTestFile`)
 */
export async function waitForFileIndexed(
    relativePath: string,
    timeoutMs = 8000,
    stale: ReadonlySet<string> = new Set(),
): Promise<boolean> {
    const file = relativePath.replace(/\.md$/, '');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const result = cliList({ file });
        if (result.count > 0 && !result.tasks.some(t => stale.has(t.id as string))) return true;
        await sleep(300);
    }
    return false;
}

/**
 * The IDs the index hands out for the file's rows now that name a reading of
 * it: every ID but a `path#^id` one, which outlives readings. Such an ID
 * lasts until the file changes other than by a write of the plugin's
 * (`src/api/TaskIds.ts`), so once none of them is handed out, the index has
 * read the file again.
 */
function readingIds(relativePath: string): Set<string> {
    const result = cliList({ file: relativePath.replace(/\.md$/, '') });
    return new Set((result.tasks ?? []).map(t => t.id as string).filter(id => !id.includes('#^')));
}

/**
 * Write a file in the Dev vault from outside, as `writeTestFile` does, and
 * wait until the index lists the file as written (`waitForFileIndexed`).
 *
 * The index learns of a write from outside when Obsidian's watcher tells it,
 * a moment later. Until then `list` answers the reading from before the
 * write, and its IDs are refused by the next update ("Task not found ... list
 * the tasks again"). Having some rows listed is not enough when the file had
 * rows before: the wait is over when the IDs of the former reading are gone.
 * A file written with the content it already has is not read again, and
 * there is nothing to wait out.
 */
export async function writeIndexedTestFile(
    relativePath: string,
    content: string,
    timeoutMs = 8000,
): Promise<boolean> {
    let before: string | null;
    try {
        before = fs.readFileSync(vaultAbsolute(relativePath), 'utf-8');
    } catch {
        before = null;
    }
    const stale = before === null || before === content ? new Set<string>() : readingIds(relativePath);
    writeTestFile(relativePath, content);
    return waitForFileIndexed(relativePath, timeoutMs, stale);
}

/**
 * Wait for Obsidian to de-index a file (no tasks returned for it).
 */
export async function waitForFileDeindexed(
    relativePath: string,
    timeoutMs = 8000,
): Promise<boolean> {
    const file = relativePath.replace(/\.md$/, '');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const result = cliList({ file });
        if (result.count === 0) return true;
        await sleep(300);
    }
    return false;
}

/**
 * Save-and-restore helper for use in `beforeAll` / `afterAll`.
 *
 * Usage:
 *   const fixture = createFixture('test-file.md', initialContent);
 *   beforeAll(() => fixture.setup());
 *   afterAll(() => fixture.teardown());
 */
export function createFixture(relativePath: string, content: string) {
    let originalContent: string | null = null;
    const abs = vaultAbsolute(relativePath);

    return {
        async setup() {
            // Save original content if file already exists
            try {
                originalContent = fs.readFileSync(abs, 'utf-8');
            } catch {
                originalContent = null;
            }
            await writeIndexedTestFile(relativePath, content);
        },
        async teardown() {
            if (originalContent !== null) {
                writeTestFile(relativePath, originalContent);
            } else {
                deleteTestFile(relativePath);
            }
            // Brief wait for Obsidian to pick up the restoration
            await sleep(500);
        },
    };
}
