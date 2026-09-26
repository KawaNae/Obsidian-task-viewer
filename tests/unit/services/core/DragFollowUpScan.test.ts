import { describe, it, expect, vi } from 'vitest';
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
 * Readings of the dragged file are held back from the store so it is not
 * overwritten with values from under the pointer (`TaskScanner.hold`), and
 * read when the drag ends. The drag's own commit is written *before* the drag
 * ends (`DragSession.handleUp` awaits the commit, then lets go of the file), so
 * the write that ends a drag is always one that is read then.
 */

const FILE = 'note.md';
const proto = TaskIndex.prototype as never as Record<string, (...args: unknown[]) => unknown>;

function buildHost(overrides: Record<string, unknown> = {}) {
    return {
        disposed: false,
        ...overrides,
    };
}

describe('through the real modify handler', () => {
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

    // A completion fires in the write that made it (X), so a drag that holds
    // back the scan holds back no fire: the completion fires once, at once,
    // and the scan after the drag reads it without firing again.
    const WEEKLY = '- [ ] 週報 @2026-09-21 ==> every mon\n';
    const CHECKED = '- [x] 週報 @2026-09-21 ==> every mon\n';
    const FIRED = '- [ ] 週報 @2026-09-28 ==> every mon\n- [x] 週報 @2026-09-21\n';

    it('fires a completion the user made during the drag once, in its write', async () => {
        const contents = new Map([[FILE, WEEKLY]]);
        const live = vaultSession(contents);
        try {
            await live.scanAll();
            const weekly = live.index.getTasks()[0];
            live.index.setDraggingFile(FILE);
            await live.index.updateTask(weekly.id, { statusChar: 'x' });
            await live.settle(FILE);
            expect(contents.get(FILE)).toBe(FIRED);

            live.index.setDraggingFile(null);
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

    it('reads what it held back once, not again on the next drag', async () => {
        const contents = new Map([[FILE, `${ALPHA}
`]]);
        const live = vaultSession(contents);
        try {
            await live.scanAll();
            live.index.setDraggingFile(FILE);
            contents.set(FILE, `${ALPHA}
${BETA}
`);
            await live.fireVault('modify', sessionFile(FILE));
            live.index.setDraggingFile(null);
            await live.settle(FILE);
            expect(live.index.getTasks()).toHaveLength(2);
            const read = live.index.getRevision();

            live.index.setDraggingFile(FILE);
            live.index.setDraggingFile(null);
            await live.settle(FILE);

            expect(live.index.getRevision()).toBe(read);
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
        expect(await proto.createTask.call(host(), FILE, '- [ ] x')).toBe(null);
        expect(await proto.insertLine.call(host(), 'id', '- [ ] x', 'afterSubtree')).toBe(false);
    });

    it('reach neither the store nor the repository', async () => {
        const closed = buildHost({
            disposed: true,
            refuseAfterDispose: proto.refuseAfterDispose,
            store: { getTask: vi.fn() },
            repository: { updateTaskInFile: vi.fn(), applyToTask: vi.fn() },
        });

        await proto.updateTask.call(closed, 'id', { statusChar: 'x' });
        await proto.deleteTask.call(closed, 'id');

        expect(closed.store.getTask).not.toHaveBeenCalled();
        expect(closed.repository.updateTaskInFile).not.toHaveBeenCalled();
        expect(closed.repository.applyToTask).not.toHaveBeenCalled();
    });

    it('leave the line-level writes alone too', async () => {
        const closed = buildHost({
            disposed: true,
            refuseAfterDispose: proto.refuseAfterDispose,
            withNotify: vi.fn(),
        });

        await proto.writeLine.call(closed, FILE, { line: 0, text: '- [ ] x', key: '' }, [{ kind: 'update', text: '- [x] x' }]);
        await proto.insertLine.call(closed, 'id', '- [ ] x', 'firstChild');

        expect(closed.withNotify).not.toHaveBeenCalled();
    });
});
