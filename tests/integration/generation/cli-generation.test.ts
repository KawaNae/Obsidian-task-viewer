/**
 * Flow Command Integration Tests
 *
 * Tests the `==>` flow language (schedule / telomere / until / move) via
 * CLI update against a live Obsidian instance.
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/generation/cli-generation.test.ts
 *
 * Note: fixtures use `at(start + Nd)` for date assertions because it is
 * deterministic (pre-shift anchor), unlike `every`/`+N` which are
 * today-relative by design.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliList, cliUpdate,
    isObsidianRunning, waitForTask, waitForTaskGone, sleep,
} from '../helpers/cli-helper';
import {
    writeTestFile, deleteTestFile,
    waitForFileIndexed, waitForFileDeindexed, vaultAbsolute,
} from '../helpers/test-file-manager';
import * as fs from 'fs';

const TEST_FILE = 'test-int-generation.md';
const ARCHIVE_FILE = 'test-archive.md';

const FIXTURE_CONTENT = [
    '# Flow Commands テスト',
    '',
    '## schedule (at = deterministic)',
    '- [ ] flow-shift-A @2026-04-01 ==> at(start + 1d)',
    '- [ ] flow-range-B @2026-04-01>2026-04-03 ==> at(start + 7d)',
    '',
    '## telomere',
    '- [ ] flow-telomere-C @2026-04-01 ==> at(start + 3d) x1',
    '',
    '## until (expired)',
    '- [ ] flow-until-D @2026-04-01 ==> every mon until 2026-04-30',
    '',
    '## move',
    '- [ ] flow-move-E @2026-04-01 ==> move([[test-archive]])',
    '',
    '## combined',
    '- [ ] flow-combo-F @2026-04-01 ==> at(start + 1d) move([[test-archive]])',
    '',
    '## multi-line',
    '- [ ] flow-multi-G @2026-04-01 ==> at(start + 1d)',
    '\t- ==> setDue(start + 3d)',
    '\t- ==> x3',
    '- [ ] flow-multi-H @2026-04-01',
    '\t- ==> at(start + 2d)',
    '- [ ] flow-multi-I @2026-04-01 ==> at(start + 1d)',
    '\t- ==> x1',
    '- [ ] flow-multi-J @2026-04-01',
    '\t- ==> move([[test-archive]])',
].join('\n');

/** Find a task by content substring in the test file */
function findTask(contentSubstr: string, outputFields = 'id,content,status,startDate,endDate') {
    const r = cliList({ file: TEST_FILE, 'output-fields': outputFields });
    return r.tasks.find(t => (t.content as string).includes(contentSubstr));
}

function readTestFile(): string {
    return fs.readFileSync(vaultAbsolute(TEST_FILE), 'utf-8');
}

/** Poll the raw file until the predicate holds (fire-consumes assertions). */
async function waitForFileContent(predicate: (content: string) => boolean, timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate(readTestFile())) return true;
        await sleep(250);
    }
    return predicate(readTestFile());
}

/** Reset fixture to clean state */
async function resetFixture(): Promise<void> {
    writeTestFile(TEST_FILE, FIXTURE_CONTENT);
    await waitForFileIndexed(TEST_FILE);
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error(
            'Obsidian is not running or CLI is unreachable. ' +
            'Start Obsidian with the Dev vault before running integration tests.',
        );
    }
    await resetFixture();
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);

    // Clean up archive file if it was created
    const archiveAbs = vaultAbsolute(ARCHIVE_FILE);
    if (fs.existsSync(archiveAbs)) {
        deleteTestFile(ARCHIVE_FILE);
        await waitForFileDeindexed(ARCHIVE_FILE);
    }
});

// ────────────────────────────────────────────
// 1. schedule fires and consumes
// ────────────────────────────────────────────
describe('schedule (at)', () => {
    beforeAll(() => resetFixture());

    it('generates a shifted instance and strips the command from the original', async () => {
        const task = findTask('flow-shift-A');
        expect(task).toBeDefined();
        expect(task!.startDate).toBe('2026-04-01');

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, 'output-fields': 'id,content,status,startDate' },
            t => (t.content as string).includes('flow-shift-A')
                && t.status === ' '
                && t.startDate === '2026-04-02',
            8000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-02');
        expect(newTask!.status).toBe(' ');

        // Fire-consumes: the completed original keeps its line but loses `==>`
        const consumed = await waitForFileContent(c =>
            c.includes('- [x] flow-shift-A @2026-04-01') &&
            !c.includes('flow-shift-A @2026-04-01 ==>'));
        expect(consumed).toBe(true);

        // The generated instance inherits the command (canonical form)
        expect(readTestFile()).toContain('flow-shift-A @2026-04-02 ==> at(start + 1d)');
    }, 20000);

    it('shifts the whole date block by the anchor delta', async () => {
        await resetFixture();

        const task = findTask('flow-range-B');
        expect(task).toBeDefined();
        expect(task!.startDate).toBe('2026-04-01');
        expect(task!.endDate).toBe('2026-04-03');

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, 'output-fields': 'id,content,status,startDate,endDate' },
            t => (t.content as string).includes('flow-range-B')
                && t.status === ' '
                && t.startDate === '2026-04-08',
            8000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-08');
        expect(newTask!.endDate).toBe('2026-04-10');
    }, 20000);
});

// ────────────────────────────────────────────
// 2. telomere
// ────────────────────────────────────────────
describe('telomere (xN)', () => {
    beforeAll(() => resetFixture());

    it('x1: generates the final instance without any command', async () => {
        const task = findTask('flow-telomere-C');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, 'output-fields': 'id,content,status,startDate' },
            t => (t.content as string).includes('flow-telomere-C')
                && t.status === ' '
                && t.startDate === '2026-04-04',
            8000,
        );
        expect(newTask).not.toBeNull();

        // The final instance carries no `==>` (telomere exhausted)
        const content = readTestFile();
        expect(content).toContain('- [ ] flow-telomere-C @2026-04-04');
        expect(content).not.toContain('flow-telomere-C @2026-04-04 ==>');
    }, 20000);
});

// ────────────────────────────────────────────
// 3. until expired: consume without generating
// ────────────────────────────────────────────
describe('until (expired)', () => {
    beforeAll(() => resetFixture());

    it('consumes the command without generating when past the until date', async () => {
        const task = findTask('flow-until-D');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        // Command disappears from the completed line...
        const consumed = await waitForFileContent(c =>
            c.includes('- [x] flow-until-D @2026-04-01') &&
            !c.includes('flow-until-D @2026-04-01 ==>'));
        expect(consumed).toBe(true);

        // ...and no new instance exists
        const stillOne = cliList({ file: TEST_FILE, content: 'flow-until-D', 'output-fields': 'id,status' });
        expect(stillOne.count).toBe(1);
    }, 20000);
});

// ────────────────────────────────────────────
// 4. move
// ────────────────────────────────────────────
describe('move', () => {
    beforeAll(() => resetFixture());

    it('moves the task to the archive file and deletes the original', async () => {
        const task = findTask('flow-move-E');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const gone = await waitForTaskGone(
            { file: TEST_FILE, 'output-fields': 'id,content' },
            t => (t.content as string).includes('flow-move-E'),
            5000,
        );
        expect(gone).toBe(true);

        const archiveResult = cliList({
            file: ARCHIVE_FILE,
            content: 'flow-move-E',
            'output-fields': 'id,content,status',
        });
        expect(archiveResult.count).toBeGreaterThanOrEqual(1);
    }, 20000);

    it('schedule + move: generates the next instance AND archives the completed one', async () => {
        await resetFixture();

        const task = findTask('flow-combo-F');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        // Next instance appears in the source file
        const newTask = await waitForTask(
            { file: TEST_FILE, 'output-fields': 'id,content,status,startDate' },
            t => (t.content as string).includes('flow-combo-F')
                && t.status === ' '
                && t.startDate === '2026-04-02',
            8000,
        );
        expect(newTask).not.toBeNull();

        // Completed original moved to the archive
        const archived = cliList({
            file: ARCHIVE_FILE,
            content: 'flow-combo-F',
            'output-fields': 'id,content,status',
        });
        expect(archived.count).toBeGreaterThanOrEqual(1);

        // Exactly one instance remains in the source (the new one)
        const remaining = cliList({ file: TEST_FILE, content: 'flow-combo-F', 'output-fields': 'id,status' });
        expect(remaining.count).toBe(1);
    }, 20000);
});

// ────────────────────────────────────────────
// 5. multi-line flows (`- ==>` child segments)
// ────────────────────────────────────────────
describe('multi-line flows', () => {
    beforeAll(() => resetFixture());

    it('fires a multi-line flow: flow lines follow the new task line, telomere decremented in place', async () => {
        const task = findTask('flow-multi-G');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, 'output-fields': 'id,content,status,startDate' },
            t => (t.content as string).includes('flow-multi-G')
                && t.status === ' '
                && t.startDate === '2026-04-02',
            8000,
        );
        expect(newTask).not.toBeNull();

        // Fire-consumes: the original loses `==>` AND its flow child lines
        const consumed = await waitForFileContent(c =>
            c.includes('- [x] flow-multi-G @2026-04-01') &&
            !c.includes('flow-multi-G @2026-04-01 ==>') &&
            !c.includes('- ==> x3'));
        expect(consumed).toBe(true);

        const lines = readTestFile().split('\n');
        // setDue(start + 3d) evaluated post-shift → due = 2026-04-05 in the date block
        const newIdx = lines.findIndex(l =>
            l.includes('flow-multi-G @2026-04-02>>2026-04-05 ==> at(start + 1d)'));
        expect(newIdx).toBeGreaterThanOrEqual(0);
        // Line-level canonical inheritance: each segment keeps its line,
        // emitted right after the task line, xN decremented in place
        expect(lines[newIdx + 1].trim()).toBe('- ==> setDue(start + 3d)');
        expect(lines[newIdx + 2].trim()).toBe('- ==> x2');
        // The consumed original contributed no leftover copies
        expect(lines.filter(l => l.includes('- ==> setDue')).length).toBe(1);
    }, 20000);

    it('fires a child-line-only flow: the task line never gains ==>', async () => {
        await resetFixture();

        const task = findTask('flow-multi-H');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, 'output-fields': 'id,content,status,startDate' },
            t => (t.content as string).includes('flow-multi-H')
                && t.status === ' '
                && t.startDate === '2026-04-03',
            8000,
        );
        expect(newTask).not.toBeNull();

        const lines = readTestFile().split('\n');
        const newIdx = lines.findIndex(l => l.includes('- [ ] flow-multi-H @2026-04-03'));
        expect(newIdx).toBeGreaterThanOrEqual(0);
        expect(lines[newIdx]).not.toContain('==>');
        expect(lines[newIdx + 1].trim()).toBe('- ==> at(start + 2d)');
        // The original's flow line was consumed — exactly one copy remains
        expect(lines.filter(l => l.includes('- ==> at(start + 2d)')).length).toBe(1);
        expect(readTestFile()).toContain('- [x] flow-multi-H @2026-04-01');
    }, 20000);

    it('x1 on a child line: the final instance carries no flow lines at all', async () => {
        await resetFixture();

        const task = findTask('flow-multi-I');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, 'output-fields': 'id,content,status,startDate' },
            t => (t.content as string).includes('flow-multi-I')
                && t.status === ' '
                && t.startDate === '2026-04-02',
            8000,
        );
        expect(newTask).not.toBeNull();

        const lines = readTestFile().split('\n');
        const newIdx = lines.findIndex(l => l.includes('- [ ] flow-multi-I @2026-04-02'));
        expect(newIdx).toBeGreaterThanOrEqual(0);
        expect(lines[newIdx]).not.toContain('==>');
        // Telomere exhausted: neither instance owns any flow line
        expect(lines[newIdx + 1]?.includes('- ==> x1') ?? false).toBe(false);
        expect(lines.filter(l => l.includes('- ==> x1')).length).toBe(0);
    }, 20000);

    it('move via a child-line flow: archive receives no flow lines', async () => {
        await resetFixture();

        const task = findTask('flow-multi-J');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const gone = await waitForTaskGone(
            { file: TEST_FILE, 'output-fields': 'id,content' },
            t => (t.content as string).includes('flow-multi-J'),
            5000,
        );
        expect(gone).toBe(true);

        const archived = cliList({
            file: ARCHIVE_FILE,
            content: 'flow-multi-J',
            'output-fields': 'id,content,status',
        });
        expect(archived.count).toBeGreaterThanOrEqual(1);

        // The consumed flow line must not travel to the archive
        const archiveContent = fs.readFileSync(vaultAbsolute(ARCHIVE_FILE), 'utf-8');
        expect(archiveContent).not.toContain('- ==>');
        // ...and the source file no longer contains J's flow line
        expect(readTestFile()).not.toContain('- ==> move([[test-archive]])');
    }, 20000);
});
