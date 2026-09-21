import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { TaskIndex } from '../../../../src/services/core/TaskIndex';
import { vaultSession, makeFile as sessionFile } from '../../helpers/vaultSession';

/**
 * What happens to the changes that arrive while a drag is in flight, and what
 * happens to a write that arrives after the index is closed.
 *
 * Scans of the dragged file are suppressed so the store is not overwritten with
 * values from under the pointer. Nothing used to un-suppress them: the drag's
 * own commit is written *before* the flag comes down (`DragSession.handleUp`
 * awaits the commit, then lowers it in a rAF), so the write that ends a drag
 * was always the one nobody read back.
 */

const FILE = 'note.md';
const proto = TaskIndex.prototype as never as Record<string, (...args: unknown[]) => unknown>;

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.extension = 'md';
    return file;
}

function buildHost(overrides: Record<string, unknown> = {}) {
    return {
        draggingFilePath: null as string | null,
        skippedDuringDrag: null as { path: string; isLocal: boolean } | null,
        disposed: false,
        app: { vault: { getAbstractFileByPath: (path: string) => makeFile(path) } },
        rescanAndNotify: vi.fn(async () => {}),
        ...overrides,
    };
}

/** The modify handler's drag branch, as the index runs it. */
function arriveDuringDrag(host: ReturnType<typeof buildHost>, isLocal: boolean): void {
    host.skippedDuringDrag = {
        path: FILE,
        isLocal: (host.skippedDuringDrag?.isLocal ?? false) || isLocal,
    };
}

describe('the scans a drag suppressed', () => {
    it('reads the file back when the drag ends', () => {
        const host = buildHost({ draggingFilePath: FILE });
        arriveDuringDrag(host, true);

        proto.setDraggingFile.call(host, null);

        expect(host.rescanAndNotify).toHaveBeenCalledTimes(1);
        const [file, isLocal] = host.rescanAndNotify.mock.calls[0];
        expect((file as TFile).path).toBe(FILE);
        expect(isLocal).toBe(true);
    });

    it('does not scan when nothing arrived', () => {
        const host = buildHost({ draggingFilePath: FILE });

        proto.setDraggingFile.call(host, null);

        expect(host.rescanAndNotify).not.toHaveBeenCalled();
    });

    it('treats the batch as local when any of it was', () => {
        // A sync arriving mid-drag does not make the drag's own commit
        // external. The value decides whether completions fire, and losing a
        // completion is the quieter failure of the two.
        const host = buildHost({ draggingFilePath: FILE });
        arriveDuringDrag(host, false);
        arriveDuringDrag(host, true);
        arriveDuringDrag(host, false);

        proto.setDraggingFile.call(host, null);

        expect(host.rescanAndNotify.mock.calls[0][1]).toBe(true);
    });

    it('stays external when none of it was local', () => {
        const host = buildHost({ draggingFilePath: FILE });
        arriveDuringDrag(host, false);

        proto.setDraggingFile.call(host, null);

        expect(host.rescanAndNotify.mock.calls[0][1]).toBe(false);
    });

    it('does not scan again on the next drag', () => {
        const host = buildHost({ draggingFilePath: FILE });
        arriveDuringDrag(host, true);
        proto.setDraggingFile.call(host, null);

        proto.setDraggingFile.call(host, FILE);
        proto.setDraggingFile.call(host, null);

        expect(host.rescanAndNotify).toHaveBeenCalledTimes(1);
    });
});

describe('through the real modify handler', () => {
    // The helper above stands in for the handler's drag branch; this runs the
    // handler itself, so the two halves are pinned together.
    const ALPHA = '- [ ] alpha @2026-09-21';
    const BETA = '- [ ] beta @2026-09-21';

    it('holds the change back during the drag and reads it after', async () => {
        const contents = new Map([[FILE, `${ALPHA}\n`]]);
        const live = vaultSession(contents);
        try {
            await live.initialize();
            await live.scanAll();
            expect(live.index.getTasks()).toHaveLength(1);

            live.index.setDraggingFile(FILE);
            contents.set(FILE, `${ALPHA}\n${BETA}\n`);
            await live.fireVault('modify', sessionFile(FILE));

            // Suppressed: the store still holds what it had when the drag began.
            await live.settle(FILE);
            expect(live.index.getTasks()).toHaveLength(1);

            live.index.setDraggingFile(null);
            await live.settle(FILE);
            expect(live.index.getTasks()).toHaveLength(2);
        } finally {
            live.dispose();
        }
    });

    it('leaves a file nobody touched during the drag alone', async () => {
        const contents = new Map([[FILE, `${ALPHA}\n`]]);
        const live = vaultSession(contents);
        try {
            await live.initialize();
            await live.scanAll();
            const before = live.index.getRevision();

            live.index.setDraggingFile(FILE);
            live.index.setDraggingFile(null);
            await live.settle(FILE);

            expect(live.index.getRevision()).toBe(before);
        } finally {
            live.dispose();
        }
    });
});

describe('writes after dispose', () => {
    const host = () => buildHost({ disposed: true, refuseAfterDispose: proto.refuseAfterDispose });

    it('are refused rather than written', async () => {
        expect(await proto.updateTask.call(host(), 'id', {})).toBe(false);
        expect(await proto.deleteTask.call(host(), 'id')).toBe(false);
        expect(await proto.duplicateTask.call(host(), 'id')).toBe(false);
        expect(await proto.insertChildTask.call(host(), 'id', '- [ ] x')).toBe(false);
        expect(await proto.createTask.call(host(), FILE, '- [ ] x')).toBe(-1);
        expect(await proto.insertSiblingAfterTask.call(host(), 'id', '- [ ] x')).toBe(-1);
    });

    it('reach neither the store nor the repository', async () => {
        const closed = buildHost({
            disposed: true,
            refuseAfterDispose: proto.refuseAfterDispose,
            store: { getTask: vi.fn() },
            repository: { updateTaskInFile: vi.fn(), deleteTaskFromFile: vi.fn() },
            syncDetector: { markLocalEdit: vi.fn() },
        });

        await proto.updateTask.call(closed, 'id', { statusChar: 'x' });
        await proto.deleteTask.call(closed, 'id');

        expect(closed.store.getTask).not.toHaveBeenCalled();
        expect(closed.repository.updateTaskInFile).not.toHaveBeenCalled();
        expect(closed.repository.deleteTaskFromFile).not.toHaveBeenCalled();
        expect(closed.syncDetector.markLocalEdit).not.toHaveBeenCalled();
    });

    it('leave the line-level writes alone too', async () => {
        const closed = buildHost({
            disposed: true,
            refuseAfterDispose: proto.refuseAfterDispose,
            withNotify: vi.fn(),
        });

        await proto.updateLine.call(closed, FILE, 0, '- [x] x');
        await proto.insertLineAfterLine.call(closed, FILE, 0, '- [ ] x');
        await proto.deleteLine.call(closed, FILE, 0);
        await proto.appendChildTask.call(closed, 'id', '- [ ] x');

        expect(closed.withNotify).not.toHaveBeenCalled();
    });
});
