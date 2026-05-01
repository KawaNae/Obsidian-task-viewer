/**
 * Frontmatter Task Writer — CLI Integration Tests
 *
 * Tests frontmatter task updates via CLI commands and verifies
 * the actual file content (frontmatter YAML) on disk.
 *
 * Replaces the vault-mock FrontmatterWriter.test.ts with real CLI-based tests.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *
 * Run:  npx vitest run tests/integration/persistence/frontmatter-write.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliList, cliUpdate, cliDelete,
    isObsidianRunning, waitForTask, waitForTaskGone, sleep,
} from '../helpers/cli-helper';
import {
    writeTestFile, deleteTestFile,
    waitForFileIndexed, waitForFileDeindexed,
} from '../helpers/test-file-manager';
import {
    getFileLines, getFrontmatterRaw,
    expectFrontmatterKey, expectFileContains, expectFileNotContains,
} from '../helpers/vault-assertions';

const TEST_FILE = 'test-int-fm-write.md';
const OUTPUT_FIELDS = 'content,status,startDate,startTime,endDate,endTime,due,tags,parserId,file,line';

// ── Helpers ──

/** Find the frontmatter task in our test file (parserId=frontmatter). */
function findFmTask(): Record<string, unknown> | undefined {
    const r = cliList({ file: TEST_FILE, outputFields: OUTPUT_FIELDS });
    return r.tasks.find(t => t.parserId === 'tv-file');
}

/** Wait for the frontmatter task to appear in the index. */
async function waitForFmTask(timeoutMs = 8000): Promise<Record<string, unknown> | null> {
    return waitForTask(
        { file: TEST_FILE, outputFields: OUTPUT_FIELDS },
        t => t.parserId === 'tv-file',
        timeoutMs,
    );
}

/** Get the current ID of the frontmatter task. */
function fmTaskId(): string {
    const t = findFmTask();
    if (!t) throw new Error('Frontmatter task not found in index');
    return t.id as string;
}

// ── Setup / Teardown ──

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error(
            'Obsidian is not running or CLI is unreachable. ' +
            'Start Obsidian with the Dev vault before running integration tests.',
        );
    }
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

// ────────────────────────────────────────────
// 1. Update frontmatter fields
// ────────────────────────────────────────────
describe('update frontmatter task — status', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: FM Project',
            '---',
            'Body text here.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('updates status to x', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        const r = cliUpdate({ id, status: 'x', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.status).toBe('x');

        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-status', 'x');
    });

    // Note: Clearing status via CLI (status=' ') doesn't properly convey a space
    // character through PowerShell → Obsidian CLI. Tested via unit tests instead.
});

describe('update frontmatter task — start datetime', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: FM Datetime Test',
            '---',
            'Body.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('updates startDate + startTime to datetime format', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        const r = cliUpdate({ id, start: '2026-06-01T09:00', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.startDate).toBe('2026-06-01');
        expect(r.task.startTime).toBe('09:00');

        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-start', '2026-06-01T09:00');
    });
});

describe('update frontmatter task — start date only', () => {
    beforeAll(async () => {
        // Fresh file without startTime — test all-day update
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: FM AllDay Test',
            '---',
            'Body.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('updates startDate only (all-day)', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        const r = cliUpdate({ id, start: '2026-07-01', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.startDate).toBe('2026-07-01');

        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-start', '2026-07-01');
    });
});

describe('update frontmatter task — end and due', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: FM EndDue Test',
            '---',
            'Body.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('updates end date', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        const r = cliUpdate({ id, end: '2026-07-05', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.endDate).toBe('2026-07-05');

        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-end', '2026-07-05');
    });

    it('updates due date', async () => {
        const id = fmTaskId();
        const r = cliUpdate({ id, due: '2026-08-15', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.due).toBe('2026-08-15');

        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-due', '2026-08-15');
    });

    // Note: Clearing due via CLI is not supported (empty string causes parse error).
    // This is tested via the unit-level FrontmatterWriter tests instead.
});

describe('update frontmatter task — content', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: Original Name',
            '---',
            'Body.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('updates content', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        const r = cliUpdate({ id, content: 'Renamed Project', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.content).toContain('Renamed Project');

        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-content', 'Renamed Project');
    });
});

// ────────────────────────────────────────────
// 2. Surgical edit — preserves non-task keys
// ────────────────────────────────────────────
describe('surgical edit — preserves non-task keys', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'title: My Important Note',
            'tv-start: 2026-05-01',
            'tv-content: Surgical Test',
            'tags: [project, important]',
            'custom-field: keep-this',
            '---',
            'Body with content.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('updating task fields preserves non-task frontmatter keys', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        const r = cliUpdate({ id, start: '2026-06-01', status: 'x', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');

        await sleep(500);

        // Non-task keys should be preserved
        const fm = getFrontmatterRaw(TEST_FILE);
        expect(fm['title']).toBe('My Important Note');
        expect(fm['tags']).toBe('[project, important]');
        expect(fm['custom-field']).toBe('keep-this');

        // Task keys should be updated
        expect(fm['tv-start']).toBe('2026-06-01');
        expect(fm['tv-status']).toBe('x');
    });

    it('preserves body text after frontmatter', async () => {
        await sleep(300);
        expectFileContains(TEST_FILE, 'Body with content.');
    });
});

// ────────────────────────────────────────────
// 3. Key ordering — surgical edits don't reorder
// ────────────────────────────────────────────
describe('key ordering preserved', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'alpha: first',
            'tv-start: 2026-05-01',
            'beta: second',
            'tv-content: Key Order Test',
            'gamma: third',
            '---',
            'Body.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('update does not reorder frontmatter keys', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        cliUpdate({ id, start: '2026-06-15', outputFields: OUTPUT_FIELDS });

        await sleep(500);

        const lines = getFileLines(TEST_FILE);
        // Find positions of keys
        const alphaIdx = lines.findIndex(l => l.startsWith('alpha:'));
        const tvStartIdx = lines.findIndex(l => l.startsWith('tv-start:'));
        const betaIdx = lines.findIndex(l => l.startsWith('beta:'));
        const tvContentIdx = lines.findIndex(l => l.startsWith('tv-content:'));
        const gammaIdx = lines.findIndex(l => l.startsWith('gamma:'));

        // Order should be preserved
        expect(alphaIdx).toBeLessThan(tvStartIdx);
        expect(tvStartIdx).toBeLessThan(betaIdx);
        expect(betaIdx).toBeLessThan(tvContentIdx);
        expect(tvContentIdx).toBeLessThan(gammaIdx);

        // Value should be updated
        expect(lines[tvStartIdx]).toContain('2026-06-15');
    });
});

// ────────────────────────────────────────────
// 4. Delete frontmatter task
// ────────────────────────────────────────────
describe('delete frontmatter task', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'title: Preserved Title',
            'tv-start: 2026-05-01',
            'tv-end: 2026-05-10',
            'tv-due: 2026-05-20',
            'tv-status: x',
            'tv-content: Delete Target',
            'other-key: keep',
            '---',
            'Body remains.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('removes all task keys from frontmatter', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();

        const id = task!.id as string;
        const r = cliDelete(id);
        expect(r).not.toHaveProperty('error');

        await sleep(1000);

        // All tv-* task keys should be removed
        expectFileNotContains(TEST_FILE, 'tv-start');
        expectFileNotContains(TEST_FILE, 'tv-end');
        expectFileNotContains(TEST_FILE, 'tv-due');
        expectFileNotContains(TEST_FILE, 'tv-status');
        expectFileNotContains(TEST_FILE, 'tv-content');
    });

    it('preserves non-task frontmatter keys after delete', async () => {
        const fm = getFrontmatterRaw(TEST_FILE);
        expect(fm['title']).toBe('Preserved Title');
        expect(fm['other-key']).toBe('keep');
    });

    it('preserves body text after delete', () => {
        expectFileContains(TEST_FILE, 'Body remains.');
    });

    it('task disappears from index after delete', async () => {
        const gone = await waitForTaskGone(
            { file: TEST_FILE, outputFields: 'parserId' },
            t => t.parserId === 'tv-file',
            5000,
        );
        expect(gone).toBe(true);
    });
});

// ────────────────────────────────────────────
// 5. Mixed file — frontmatter + inline tasks
// ────────────────────────────────────────────
describe('mixed file — frontmatter + inline coexistence', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: FM Task',
            'unrelated: preserve-me',
            '---',
            '',
            '## Tasks',
            '- [ ] Inline task A @2026-05-10',
            '- [ ] Inline task B @2026-05-11',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('can update frontmatter task without affecting inline tasks', async () => {
        const fmTask = await waitForFmTask();
        expect(fmTask).not.toBeNull();

        const id = fmTask!.id as string;
        cliUpdate({ id, content: 'FM Updated', outputFields: OUTPUT_FIELDS });

        await sleep(500);

        // Frontmatter updated
        expectFrontmatterKey(TEST_FILE, 'tv-content', 'FM Updated');

        // Inline tasks untouched
        expectFileContains(TEST_FILE, 'Inline task A');
        expectFileContains(TEST_FILE, 'Inline task B');
    });

    it('can update inline task without affecting frontmatter task', async () => {
        const r = cliList({ file: TEST_FILE, outputFields: OUTPUT_FIELDS });
        const inlineTask = r.tasks.find(
            t => t.parserId === 'tv-inline' && (t.content as string).includes('Inline task A'),
        );
        expect(inlineTask).toBeDefined();

        cliUpdate({
            id: inlineTask!.id as string,
            content: 'Inline Updated',
            outputFields: OUTPUT_FIELDS,
        });

        await sleep(500);

        // Inline task updated
        expectFileContains(TEST_FILE, 'Inline Updated');
        expectFileNotContains(TEST_FILE, 'Inline task A');

        // Frontmatter unchanged
        expectFrontmatterKey(TEST_FILE, 'tv-content', 'FM Updated');
        const fm = getFrontmatterRaw(TEST_FILE);
        expect(fm['unrelated']).toBe('preserve-me');
    });
});

// ────────────────────────────────────────────
// 6. Round-trip with frontmatter
// ────────────────────────────────────────────
describe('frontmatter round-trip', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: Round Trip FM',
            '---',
            'Notes here.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('multiple sequential updates apply correctly', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();
        let id = task!.id as string;

        // Update 1: change start date
        cliUpdate({ id, start: '2026-06-01', outputFields: OUTPUT_FIELDS });
        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-start', '2026-06-01');

        // Update 2: add due date
        id = fmTaskId();
        cliUpdate({ id, due: '2026-06-30', outputFields: OUTPUT_FIELDS });
        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-due', '2026-06-30');

        // Update 3: change content
        id = fmTaskId();
        cliUpdate({ id, content: 'Final Name', outputFields: OUTPUT_FIELDS });
        await sleep(500);
        expectFrontmatterKey(TEST_FILE, 'tv-content', 'Final Name');

        // All updates should be present simultaneously
        const fm = getFrontmatterRaw(TEST_FILE);
        expect(fm['tv-start']).toBe('2026-06-01');
        expect(fm['tv-due']).toBe('2026-06-30');
        expect(fm['tv-content']).toBe('Final Name');

        // Body preserved
        expectFileContains(TEST_FILE, 'Notes here.');
    });
});

// ────────────────────────────────────────────
// 7. Clear fields via "none" sentinel
// ────────────────────────────────────────────
describe('clear fields via none sentinel', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-due: 2026-06-01',
            'tv-status: x',
            'tv-content: Clear Test',
            '---',
            'Body.',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('clears status via none sentinel', async () => {
        const task = await waitForFmTask();
        expect(task).not.toBeNull();
        expect(task!.status).toBe('x');

        const id = task!.id as string;
        const r = cliUpdate({ id, status: 'none', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.status).toBe(' ');

        await sleep(500);
        // tv-status should be cleared (space or removed)
        const fm = getFrontmatterRaw(TEST_FILE);
        const statusVal = fm['tv-status'];
        expect(!statusVal || statusVal.trim() === '').toBe(true);
    });

    it('clears due via none sentinel', async () => {
        const id = fmTaskId();
        const r = cliUpdate({ id, due: 'none', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');

        await sleep(500);
        expectFileNotContains(TEST_FILE, 'tv-due');
    });
});
