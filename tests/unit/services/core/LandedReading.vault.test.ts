import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice, TFile } from 'obsidian';
import { openVault, makeFile, type VaultSession } from '../../helpers/vaultSession';
import { FileParsePipeline } from '../../../../src/services/parsing/FileParsePipeline';
import { contentKeyOf } from '../../../../src/services/core/ContentKey';

/**
 * N1: a write of ours that landed is the index's next reading of the file
 * (`TaskIndex.landed`), taken in before the scan its `modify` starts. That
 * scan reads the same content and commits nothing: a content is parsed once.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
    vi.restoreAllMocks();
});

async function open(lines: string[]) {
    const opened = await openVault(lines);
    live = opened.session;
    return opened;
}

function taskNamed(session: VaultSession, content: string) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0];
}

describe('what a write left, before any scan', () => {
    it('moves the rows below it in the index, so the next write to one of them lands', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '- [ ] B', '']);
        session.holdScans();

        // The fire puts the next instance above A: B moves down a line.
        expect(await session.index.updateTask(taskNamed(session, 'A').id, { statusChar: 'x' })).toBe(true);
        const b = taskNamed(session, 'B');
        expect(b.line).toBe(4);

        expect(await session.index.updateTask(b.id, { statusChar: 'x' })).toBe(true);
        expect(contents.get(FILE)!.split('\n').slice(2)).toEqual(['\t- ==> every 1d', '- [x] A @2026-09-21', '- [x] B', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('is parsed once: the scans the write\'s events start read the same content and commit nothing', async () => {
        const { session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const parse = vi.spyOn(FileParsePipeline, 'parse');
        const held = session.holdScans();

        expect(await session.index.updateTask(taskNamed(session, 'A').id, { statusChar: 'x' })).toBe(true);
        expect(parse).toHaveBeenCalledTimes(1);
        expect(parse.mock.calls[0][1]).toEqual(['# note', '- [x] A', '- [ ] B', '']);

        await held.release();
        await session.settle(FILE);
        expect(parse).toHaveBeenCalledTimes(1);
        expect(await session.scanner.queueScan(makeFile(FILE))).toBe(false);
    });

    it('takes the reading the write\'s own check made, rather than reading the lines again', async () => {
        const { session } = await open(['# note', '- [ ] A', '']);
        const parse = vi.spyOn(FileParsePipeline, 'parse');
        session.holdScans();

        expect(await session.index.updateTask(taskNamed(session, 'A').id, { statusChar: 'x' })).toBe(true);
        const reading = parse.mock.calls[parse.mock.calls.length - 1][3];
        expect(reading?.lines).toEqual(['# note', '- [x] A', '']);
    });

    it('is not taken in for the file being dragged, and is read when the drag ends', async () => {
        const { session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const a = taskNamed(session, 'A');
        session.index.setDraggingFile(FILE);

        expect(await session.index.updateTask(a.id, { statusChar: 'x' })).toBe(true);
        // The copy the update wrote from, not a reading of the file.
        expect(session.index.getTasks().find(task => task.content === 'A')?.originalText).toBe('- [ ] A');

        session.index.setDraggingFile(null);
        await session.settle(FILE);
        expect(taskNamed(session, 'A').originalText).toBe('- [x] A');
    });
});

describe('a scan that read the file before our write and commits after it', () => {
    it('is late, and commits nothing: the index keeps what the write left, and a write in between lands', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '- [ ] B', '']);
        const a = taskNamed(session, 'A');

        // A scan reads the file now, and commits only when released.
        const read = session.app.vault.read.bind(session.app.vault);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let reading!: () => void;
        const started = new Promise<void>(resolve => { reading = resolve; });
        session.app.vault.read = async (file: TFile) => {
            const snapshot = await read(file);
            reading();
            await gate;
            return snapshot;
        };
        const late = session.scanner.queueScan(makeFile(FILE));
        await started;
        session.app.vault.read = read;

        const held = session.holdScans();
        expect(await session.index.updateTask(a.id, { statusChar: 'x' })).toBe(true);
        const written = contents.get(FILE);
        expect(taskNamed(session, 'B').line).toBe(4);

        // The late scan read the file before the write: a later reading, the
        // write's, is in, so what it read is not.
        const landedB = taskNamed(session, 'B');
        release();
        expect(await late).toBe(false);
        expect(taskNamed(session, 'B')).toBe(landedB);
        expect(landedB.line).toBe(4);

        expect(await session.index.updateTask(landedB.id, { statusChar: 'x' })).toBe(true);
        const lines = written!.split('\n');
        lines[4] = '- [x] B';
        expect(contents.get(FILE)).toBe(lines.join('\n'));
        expect(Notice.messages).toEqual([]);

        // The writes' own events read the file again, and find it read.
        await held.release();
        await session.settle(FILE);
        const b = taskNamed(session, 'B');
        expect(b.line).toBe(4);
        expect(b.originalText).toBe('- [x] B');
    });
});

describe('a write of ours that lands after a scan read what came after it', () => {
    it('is late, and commits nothing: the index keeps the later reading', async () => {
        const { contents, session } = await open(['- [ ] A', '']);
        const handed = session.scanner.readingOf(FILE);

        // Something else changed the file after the write, and a scan read it
        // before the write was told it landed.
        contents.set(FILE, ['- [ ] Z', ''].join('\n'));
        expect(await session.scanner.queueScan(makeFile(FILE))).toBe(true);

        const before = ['- [ ] A', ''];
        const landed = session.scanner.landed(FILE, {
            before, lines: ['- [x] A', ''], edits: [], reading: null,
            handed: { n: handed.n, key: contentKeyOf(before) },
        });
        expect(landed).toBe(false);
        expect(session.index.getTasks().map(task => task.content)).toEqual(['Z']);
    });

    it('leaves no name from before it to follow into what the scan read: the write left no reading the index holds', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] B', '']);
        const b = taskNamed(session, 'B').id;
        const handed = session.scanner.readingOf(FILE);

        // An edit from outside put a line above A and B, and a scan read it
        // before the write was told it landed: the scan's reading took the
        // number the write's would have.
        const outside = ['- [ ] Z', '- [ ] A', '- [ ] B', ''].join('\n');
        contents.set(FILE, outside);
        expect(await session.scanner.queueScan(makeFile(FILE))).toBe(true);

        const before = ['- [ ] A', '- [ ] B', ''];
        expect(session.scanner.landed(FILE, {
            before, lines: ['- [x] A', '- [ ] B', ''], edits: [], reading: null,
            handed: { n: handed.n, key: contentKeyOf(before) },
        })).toBe(false);

        // B's name from before the write names no row of the scan's reading:
        // its line there is A's.
        expect(session.index.getTask(b)).toBeUndefined();
        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(false);
        expect(contents.get(FILE)).toBe(outside);
    });

    it('is followed into the scan\'s reading when the scan read what the write left', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] B', '']);
        const b = taskNamed(session, 'B').id;
        const handed = session.scanner.readingOf(FILE);

        // The write's own modify was read before the write was told it landed.
        const left = ['- [x] A', '- [ ] B', ''];
        contents.set(FILE, left.join('\n'));
        expect(await session.scanner.queueScan(makeFile(FILE))).toBe(true);

        const before = ['- [ ] A', '- [ ] B', ''];
        expect(session.scanner.landed(FILE, {
            before, lines: left, edits: [], reading: null,
            handed: { n: handed.n, key: contentKeyOf(before) },
        })).toBe(false);

        expect(session.index.getTask(b)?.content).toBe('B');
        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(true);
        expect(contents.get(FILE)).toBe(['- [x] A', '- [x] B', ''].join('\n'));
    });
});

describe('writes of ours to rows of one file, asked all at once', () => {
    it('land one after another, each after the one before it: a name from before them all is followed across them', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] B', '- [ ] C', '- [ ] D', '']);
        const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(content => taskNamed(session, content).id);
        session.holdScans();

        expect(await Promise.all([
            session.index.updateTask(a, { statusChar: 'x' }),
            session.index.duplicateTask(b),
            session.index.updateTask(c, { statusChar: 'x' }),
        ])).toEqual([true, true, true]);

        expect(await session.index.updateTask(d, { statusChar: 'x' })).toBe(true);
        expect(contents.get(FILE)).toBe(['- [x] A', '- [ ] B', '- [ ] B', '- [x] C', '- [x] D', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });
});
