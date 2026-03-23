import * as fs from 'fs';
import * as path from 'path';
import { sleep, cliList } from './cli-helper';

/** Dev vault root. Must match the path Obsidian is watching. */
const VAULT_PATH = 'C:\\Obsidian\\Dev';

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
 * Wait for Obsidian to index a file by polling `cliList` until
 * the file appears (i.e. at least one task is returned).
 *
 * @param relativePath  vault-relative path (e.g. `test-scanning.md`)
 * @param timeoutMs     max wait time (default 8 000 ms)
 */
export async function waitForFileIndexed(
    relativePath: string,
    timeoutMs = 8000,
): Promise<boolean> {
    const file = relativePath.replace(/\.md$/, '');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const result = cliList({ file });
        if (result.count > 0) return true;
        await sleep(300);
    }
    return false;
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
            writeTestFile(relativePath, content);
            await waitForFileIndexed(relativePath);
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
