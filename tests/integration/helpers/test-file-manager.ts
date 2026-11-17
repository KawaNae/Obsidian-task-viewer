import * as fs from 'fs';
import * as path from 'path';
import { VAULT_PATH } from '../vault/location';
import { sleep, cliList } from './cli-helper';
import { waitForFileIndexed } from './waits';

/** Resolve a relative vault path to its absolute location on disk. */
export function vaultAbsolute(relativePath: string): string {
    return path.join(VAULT_PATH, relativePath);
}

/**
 * Write (or overwrite) a file in the E2E vault.
 * Parent directories are created automatically.
 */
export function writeTestFile(relativePath: string, content: string): void {
    const abs = vaultAbsolute(relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
}

/** Read a file from the E2E vault. */
export function readTestFile(relativePath: string): string {
    return fs.readFileSync(vaultAbsolute(relativePath), 'utf-8');
}

/** Delete a file from the E2E vault. Silently ignores missing files. */
export function deleteTestFile(relativePath: string): void {
    try {
        fs.unlinkSync(vaultAbsolute(relativePath));
    } catch {
        // file already gone — no-op
    }
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
 * Write a file in the E2E vault from outside, as `writeTestFile` does, and
 * wait until the index lists the file as written (`waitForFileIndexed`),
 * which throws when `timeoutMs` runs out.
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
): Promise<void> {
    let before: string | null;
    try {
        before = fs.readFileSync(vaultAbsolute(relativePath), 'utf-8');
    } catch {
        before = null;
    }
    const stale = before === null || before === content ? new Set<string>() : readingIds(relativePath);
    writeTestFile(relativePath, content);
    await waitForFileIndexed(relativePath, timeoutMs, stale);
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
