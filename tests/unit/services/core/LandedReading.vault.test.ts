import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice, TFile } from 'obsidian';
import { openVault, makeFile, type VaultSession } from '../../helpers/vaultSession';
import { FileParsePipeline } from '../../../../src/services/parsing/FileParsePipeline';

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
    it('puts the older reading back until the write\'s own scan reads the file again; a write in between is refused, not misplaced', async () => {
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

        // The late scan commits what it read before the write.
        release();
        expect(await late).toBe(true);
        const stale = taskNamed(session, 'B');
        expect(stale.line).toBe(3);

        // Planned from that copy, the write finds line 3 reading otherwise.
        expect(await session.index.updateTask(stale.id, { statusChar: 'x' })).toBe(false);
        expect(contents.get(FILE)).toBe(written);
        expect(Notice.messages).toHaveLength(1);

        // The write's own events read the file again, and the index catches up.
        await held.release();
        await session.settle(FILE);
        const b = taskNamed(session, 'B');
        expect(b.line).toBe(4);
        expect(await session.index.updateTask(b.id, { statusChar: 'x' })).toBe(true);
        expect(contents.get(FILE)!.split('\n')[4]).toBe('- [x] B');
    });
});
