/**
 * Generation Commands E2E Tests
 *
 * Tests repeat, next, and move commands via CLI update.
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *   - test-generation-commands.md exists in the vault root
 *
 * Run:  npx vitest run tests/e2e/
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    cliList, cliGet, cliUpdate, cliDelete,
    isObsidianRunning, waitForTask, waitForTaskGone, sleep,
} from './cli-helper';

const TEST_FILE = 'test-generation-commands.md';
const VAULT_PATH = 'C:\\Obsidian\\Dev';
const TEST_FILE_FULL = path.join(VAULT_PATH, TEST_FILE);
const ARCHIVE_FILE = 'test-archive.md';
const ARCHIVE_FILE_FULL = path.join(VAULT_PATH, ARCHIVE_FILE);

// Save original file content for restoration
let originalContent: string;

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error(
            'Obsidian is not running or CLI is unreachable. ' +
            'Start Obsidian with the Dev vault before running E2E tests.',
        );
    }
    originalContent = fs.readFileSync(TEST_FILE_FULL, 'utf-8');
});

afterAll(async () => {
    // Restore original test file
    fs.writeFileSync(TEST_FILE_FULL, originalContent, 'utf-8');

    // Clean up archive file if it was created
    if (fs.existsSync(ARCHIVE_FILE_FULL)) {
        fs.unlinkSync(ARCHIVE_FILE_FULL);
    }

    // Wait for Obsidian to pick up file changes
    await sleep(2000);
});

/** Find a task by content substring in the test file */
function findTask(contentSubstr: string, outputFields = 'id,content,status,startDate,endDate') {
    const r = cliList({ file: TEST_FILE, outputFields });
    return r.tasks.find(t => (t.content as string).includes(contentSubstr));
}

// ────────────────────────────────────────────
// 1. repeat command
// ────────────────────────────────────────────
describe('repeat command', () => {
    it('generates a new task with shifted date when completed', async () => {
        // 1. Find the repeat-test-A task
        const task = findTask('repeat-test-A');
        expect(task).toBeDefined();
        const taskId = task!.id as string;
        expect(task!.startDate).toBe('2026-04-01');

        // 2. Complete the task
        const updateResult = cliUpdate({ id: taskId, status: 'x' });
        expect(updateResult.status).toBe('ok');

        // 3. Wait for the new task to appear (startDate = 2026-04-02, status = ' ')
        const newTask = await waitForTask(
            { file: TEST_FILE, outputFields: 'id,content,status,startDate' },
            t => (t.content as string).includes('repeat-test-A')
                && t.status === ' '
                && t.startDate === '2026-04-02',
            5000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-02');
        expect(newTask!.status).toBe(' ');

        // 4. Verify original task is still present and completed
        const original = findTask('repeat-test-A');
        const completedOriginal = cliList({
            file: TEST_FILE,
            status: 'x',
            content: 'repeat-test-A',
            outputFields: 'id,content,status',
        });
        expect(completedOriginal.count).toBeGreaterThanOrEqual(1);

        // 5. Cleanup: delete the generated task, restore original to unchecked
        if (newTask) {
            cliDelete(newTask.id as string);
        }
        // Re-fetch original (ID may have changed)
        const freshOriginal = findTask('repeat-test-A');
        if (freshOriginal && freshOriginal.status === 'x') {
            cliUpdate({ id: freshOriginal.id as string, status: ' ' });
        }
        await sleep(2000);
    }, 20000);

    it('repeat with date range shifts both start and end dates', async () => {
        // repeat-test-B: @2026-04-01>2026-04-03 ==> repeat(7d)
        const task = findTask('repeat-test-B');
        expect(task).toBeDefined();
        expect(task!.startDate).toBe('2026-04-01');
        expect(task!.endDate).toBe('2026-04-03');

        const taskId = task!.id as string;
        cliUpdate({ id: taskId, status: 'x' });

        // Wait for new task: startDate=2026-04-08, endDate=2026-04-10
        const newTask = await waitForTask(
            { file: TEST_FILE, outputFields: 'id,content,status,startDate,endDate' },
            t => (t.content as string).includes('repeat-test-B')
                && t.status === ' '
                && t.startDate === '2026-04-08',
            8000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-08');
        expect(newTask!.endDate).toBe('2026-04-10');

        // Cleanup
        if (newTask) {
            cliDelete(newTask.id as string);
        }
        const freshOriginal = findTask('repeat-test-B');
        if (freshOriginal && freshOriginal.status === 'x') {
            cliUpdate({ id: freshOriginal.id as string, status: ' ' });
        }
        await sleep(2000);
    }, 20000);
});

// ────────────────────────────────────────────
// 2. next command
// ────────────────────────────────────────────
describe('next command', () => {
    it('generates a new task without commands when completed', async () => {
        // next-test-A: @2026-04-01 ==> next(3d)
        const task = findTask('next-test-A');
        expect(task).toBeDefined();
        const taskId = task!.id as string;

        cliUpdate({ id: taskId, status: 'x' });

        // Wait for new task: startDate=2026-04-04, status=' '
        const newTask = await waitForTask(
            { file: TEST_FILE, outputFields: 'id,content,status,startDate' },
            t => (t.content as string).includes('next-test-A')
                && t.status === ' '
                && t.startDate === '2026-04-04',
            8000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-04');

        // Cleanup
        if (newTask) {
            cliDelete(newTask.id as string);
        }
        const freshOriginal = findTask('next-test-A');
        if (freshOriginal && freshOriginal.status === 'x') {
            cliUpdate({ id: freshOriginal.id as string, status: ' ' });
        }
        await sleep(2000);
    }, 20000);
});

// ────────────────────────────────────────────
// 3. move command
// ────────────────────────────────────────────
describe('move command', () => {
    it('moves task to archive file and deletes original', async () => {
        // move-test-A: @2026-04-01 ==> move(test-archive)
        const task = findTask('move-test-A');
        expect(task).toBeDefined();
        const taskId = task!.id as string;

        cliUpdate({ id: taskId, status: 'x' });

        // Wait for the task to disappear from the original file
        const gone = await waitForTaskGone(
            { file: TEST_FILE, outputFields: 'id,content' },
            t => (t.content as string).includes('move-test-A'),
            5000,
        );

        expect(gone).toBe(true);

        // Verify it appeared in archive file
        const archiveResult = cliList({
            file: ARCHIVE_FILE,
            content: 'move-test-A',
            outputFields: 'id,content,status',
        });
        expect(archiveResult.count).toBeGreaterThanOrEqual(1);

        // Cleanup: delete from archive (file restoration handled by afterAll)
        for (const t of archiveResult.tasks) {
            cliDelete(t.id as string);
        }
        await sleep(2000);
    }, 20000);
});
