import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Notice } from 'obsidian';
import { openVault } from '../../helpers/vaultSession';
import { TaskApi } from '../../../../src/api/TaskApi';
import { TaskReadService } from '../../../../src/services/data/TaskReadService';
import { TaskWriteService } from '../../../../src/services/data/TaskWriteService';

/**
 * While a file is dragged, no reading of it is taken into the store, whoever
 * reads it: the one place a reading is committed holds it back
 * (`TaskScanner.commit`), and reads the file when the drag ends. A write
 * that was not written puts its values back and asks for the file to be read
 * again (`requestScan`); that reading is held back too, so the names held
 * from before the drag still name their rows, and a write by one of them
 * lands as it would without the drag.
 *
 * The shape is case 222 of stage N1's counterexample run (`n1drag`): with
 * the reading taken in at the refused write, the write by the child's name
 * held from before was refused.
 */

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0)); });
afterAll(() => { vi.useRealTimers(); });

const FILE = 'note.md';
const START = ['- [ ] K ^k1', '    - [ ] c', '- [ ] A', '    - [x] c', '- [x] A', '- [ ] D ^dd', '    - [ ] A', '', '- [ ] A', '    - [ ] c', '    text', ''];

async function replay(drag: boolean, dupBy: 'anchor' | 'name') {
    const { contents, session } = await openVault({ [FILE]: START });
    try {
        const plugin = {
            app: session.app,
            settings: { startHour: 0 },
            getTaskReadService: () => new TaskReadService(session.index, 0),
            getTaskWriteService: () => new TaskWriteService(session.index),
        };
        const api = new TaskApi(plugin as never);
        const byLine = new Map(session.index.getTasks().filter(t => t.file === FILE).map(t => [t.line, t.id]));
        Notice.messages.length = 0;
        if (drag) session.index.setDraggingFile(FILE);
        const steps: unknown[] = [];
        steps.push(['delete', Boolean((await api.delete({ id: byLine.get(2)! })).deleted)]);
        // Its row went with the delete: refused, and the file is asked to be read again.
        steps.push(['update-gone', await session.index.updateTask(byLine.get(3)!, { startDate: '2026-09-15' })]);
        if (dupBy === 'anchor') steps.push(['duplicate', Boolean((await api.duplicate({ id: `${FILE}#^dd` })).duplicated)]);
        else steps.push(['duplicate', await session.index.duplicateTask(byLine.get(5)!)]);
        steps.push(['update-child', await session.index.updateTask(byLine.get(6)!, { startDate: '2026-09-16' })]);
        const during = session.index.getTasks().filter(t => t.file === FILE).map(t => t.originalText).sort();
        if (drag) session.index.setDraggingFile(null);
        await session.settle(FILE);
        const after = session.index.getTasks().filter(t => t.file === FILE).sort((a, b) => a.line - b.line).map(t => t.originalText);
        return { steps, during, file: contents.get(FILE), after, notices: [...Notice.messages] };
    } finally {
        session.dispose();
    }
}

describe('a write refused during a drag', () => {
    for (const dupBy of ['anchor', 'name'] as const) {
        it(`does not take in a reading of the dragged file: a name held from before still writes (duplicate by ${dupBy})`, async () => {
            const dragged = await replay(true, dupBy);
            const plain = await replay(false, dupBy);

            expect(dragged.steps).toEqual([['delete', true], ['update-gone', false], ['duplicate', true], ['update-child', true]]);
            expect(plain.steps).toEqual(dragged.steps);
            expect(dragged.file).toBe(plain.file);
            expect(dragged.after).toEqual(plain.after);
            // One notice each, for the refused update and nothing after it.
            // Its words differ: without the drag the store no longer holds
            // the row (`gone`); with it, the store holds the copy from before
            // the drag, and the write finds its line gone from the file
            // (`changed`).
            expect(plain.notices).toHaveLength(1);
            expect(dragged.notices).toHaveLength(1);
            // Held back: the store holds the rows as they were when the drag began.
            expect(dragged.during).toEqual(START.filter(line => /- \[/.test(line)).sort());
        });
    }
});
