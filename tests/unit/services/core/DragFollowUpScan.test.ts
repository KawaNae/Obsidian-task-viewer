import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { TaskIndex } from '../../../../src/services/core/TaskIndex';
import { vaultSession, makeFile as sessionFile } from '../../helpers/vaultSession';
import { freezeDate } from '../../helpers/fakeDate';

// Frozen so `==> every mon` on `@2026-09-21` lands on the `@2026-09-28` these
// tests hard-code, no matter which day the suite runs.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

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
        skippedDuringDrag: null as string | null,
        disposed: false,
        app: { vault: { getAbstractFileByPath: (path: string) => makeFile(path) } },
        rescanAndNotify: vi.fn(async () => {}),
        ...overrides,
    };
}

/** The modify handler's drag branch, as the index runs it. */
function arriveDuringDrag(host: ReturnType<typeof buildHost>): void {
    host.skippedDuringDrag = FILE;
}

describe('the scans a drag suppressed', () => {
    it('reads the file back when the drag ends', () => {
        const host = buildHost({ draggingFilePath: FILE });
        arriveDuringDrag(host);

        proto.setDraggingFile.call(host, null);

        expect(host.rescanAndNotify).toHaveBeenCalledTimes(1);
        const [file] = host.rescanAndNotify.mock.calls[0];
        expect((file as TFile).path).toBe(FILE);
    });

    it('does not scan when nothing arrived', () => {
        const host = buildHost({ draggingFilePath: FILE });

        proto.setDraggingFile.call(host, null);

        expect(host.rescanAndNotify).not.toHaveBeenCalled();
    });

    it('does not scan again on the next drag', () => {
        const host = buildHost({ draggingFilePath: FILE });
        arriveDuringDrag(host);
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

    // Whether what the drag held back fires is no longer carried across the
    // drag as one flag for the whole batch (F6): each completion answers by
    // the write that made it, whenever the scan reads it.
    const WEEKLY = '- [ ] 週報 @2026-09-21 ==> every mon\n';
    const CHECKED = '- [x] 週報 @2026-09-21 ==> every mon\n';
    const FIRED = '- [ ] 週報 @2026-09-28 ==> every mon\n- [x] 週報 @2026-09-21\n';

    it('fires a completion the user made during the drag once, when the drag ends', async () => {
        const contents = new Map([[FILE, WEEKLY]]);
        const live = vaultSession(contents);
        try {
            await live.scanAll();
            const weekly = live.index.getTasks()[0];
            live.index.setDraggingFile(FILE);
            await live.index.updateTask(weekly.id, { statusChar: 'x' });
            await live.settle(FILE);
            expect(contents.get(FILE)).toBe(CHECKED);

            live.index.setDraggingFile(null);
            await vi.waitFor(() => expect(contents.get(FILE)).toBe(FIRED));
            await live.settle(FILE);
            expect(contents.get(FILE)).toBe(FIRED);
        } finally {
            live.dispose();
        }
    });

    it('does not fire a completion that came from outside during the drag', async () => {
        const contents = new Map([[FILE, WEEKLY]]);
        const live = vaultSession(contents);
        try {
            await live.scanAll();
            live.index.setDraggingFile(FILE);
            contents.set(FILE, CHECKED);
            await live.fireVault('modify', sessionFile(FILE));
            live.index.setDraggingFile(null);
            await live.settle(FILE);
            expect(contents.get(FILE)).toBe(CHECKED);
        } finally {
            live.dispose();
        }
    });

    it('leaves a file nobody touched during the drag alone', async () => {
        const contents = new Map([[FILE, `${ALPHA}\n`]]);
        const live = vaultSession(contents);
        try {
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
        expect(await proto.createTask.call(host(), FILE, '- [ ] x')).toBe(null);
        expect(await proto.insertSiblingAfterTask.call(host(), 'id', '- [ ] x')).toBe(false);
    });

    it('reach neither the store nor the repository', async () => {
        const closed = buildHost({
            disposed: true,
            refuseAfterDispose: proto.refuseAfterDispose,
            store: { getTask: vi.fn() },
            repository: { updateTaskInFile: vi.fn(), deleteTaskFromFile: vi.fn() },
        });

        await proto.updateTask.call(closed, 'id', { statusChar: 'x' });
        await proto.deleteTask.call(closed, 'id');

        expect(closed.store.getTask).not.toHaveBeenCalled();
        expect(closed.repository.updateTaskInFile).not.toHaveBeenCalled();
        expect(closed.repository.deleteTaskFromFile).not.toHaveBeenCalled();
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
