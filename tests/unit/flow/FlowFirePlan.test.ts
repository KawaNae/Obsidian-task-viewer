import { describe, it, expect, vi, afterEach } from 'vitest';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';
import { editLines } from '../../../src/utils/FileLines';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { freezeDate } from '../helpers/fakeDate';

// `every 1d` lands on the day after the later of today and the row's date.
freezeDate(new Date(2026, 7, 17, 12, 0, 0));
afterEach(() => {
    vi.restoreAllMocks();
});

const FILE = 'note.md';
const app = { vault: { getAbstractFileByPath: () => null } };

function executor(): FlowExecutor {
    return new FlowExecutor({} as never, {} as never, app as never, () => DEFAULT_SETTINGS);
}

const writer = new InlineTaskWriter(app as never, new FileOperations(app as never));

/** The lines a write of `ops` to the row at `line` leaves, with nothing written anywhere. */
function written(lines: readonly string[], line: number, ops: readonly TaskOp[]): readonly string[] | null {
    const edited = editLines(FILE, lines, '\n', undefined,
        (draft, _eol, session) => writer.applyOps(draft, session, { line, text: lines[line] }, ops));
    return edited.written ? edited.lines : null;
}

describe('FlowExecutor.planFire: a completion planned from the lines the write holds', () => {
    it('plans the next instance and the consumed command of a completed row', () => {
        const lines = ['# N', '- [x] T @2026-08-17 ==> every 1d', '- [ ] U'];
        const plan = executor().planFire(FILE, lines, 1);
        expect(plan.kind).toBe('fires');
        if (plan.kind !== 'fires') return;
        expect(plan.away).toBeNull();
        expect(plan.ops.map(op => op.kind)).toEqual(['insert-instance', 'strip-flow']);
        expect(written(lines, 1, plan.ops)).toEqual(['# N', '- [ ] T @2026-08-18 ==> every 1d', '- [x] T @2026-08-17', '- [ ] U']);
    });

    it('plans the row at the line it is asked for, not another that also fires', () => {
        const lines = ['- [x] A @2026-08-17 ==> every 1d', '- [x] B @2026-08-17 ==> every 2d'];
        const plan = executor().planFire(FILE, lines, 1);
        expect(plan.kind === 'fires' && plan.task.content).toBe('B');
        // The next instance goes in at the head of the sibling group.
        expect(written(lines, 1, plan.kind === 'fires' ? plan.ops : [])).toEqual([
            '- [ ] B @2026-08-19 ==> every 2d', '- [x] A @2026-08-17 ==> every 1d', '- [x] B @2026-08-17']);
    });

    it('reads a block the command names from the same lines', () => {
        const lines = [
            '- [x] 週報 @2026-08-17 ==> every 1d use("w")', '',
            '```tv-gen w', '- [ ] 週報 @${start}', '\t- [ ] 資料', '```', '',
        ];
        const plan = executor().planFire(FILE, lines, 0);
        expect(plan.kind).toBe('fires');
        if (plan.kind !== 'fires') return;
        const insert = plan.ops.find(op => op.kind === 'insert-instance');
        expect(insert?.kind === 'insert-instance' && insert.insert.kind).toBe('generated');
    });

    it('fires nothing for a row that is not complete, or is no task, or has no command', () => {
        expect(executor().planFire(FILE, ['- [/] T @2026-08-17 ==> every 1d'], 0)).toEqual({ kind: 'none' });
        expect(executor().planFire(FILE, ['T ==> every 1d'], 0)).toEqual({ kind: 'none' });
        expect(executor().planFire(FILE, ['- [x] T @2026-08-17', '- [ ] U ==> every 1d'], 0)).toEqual({ kind: 'none' });
    });

    it('fires nothing in an ignored note', () => {
        const lines = ['---', 'tv-ignore: true', '---', '- [x] T @2026-08-17 ==> every 1d'];
        expect(executor().planFire(FILE, lines, 3)).toEqual({ kind: 'none' });
    });

    it('reads nothing when no command stands on the row or below it', () => {
        const parse = vi.spyOn(FileParsePipeline, 'parse');
        const lines = ['- [ ] U ==> every 1d', '- [x] T @2026-08-17', '- [ ] V'];
        expect(executor().planFire(FILE, lines, 1)).toEqual({ kind: 'none' });
        expect(parse).not.toHaveBeenCalled();
    });

    it('answers a plan that failed, and plans nothing to write', () => {
        const plan = executor().planFire(FILE, ['- [x] T @2026-08-17 ==> at(end + 1d)'], 0);
        expect(plan.kind).toBe('failed');
    });

    it('holds a move to another file apart: nothing in the completing write, the source\'s ops after', () => {
        const lines = ['- [x] T @2026-08-17 ==> move("archive")', '    - c'];
        const plan = executor().planFire(FILE, lines, 0);
        expect(plan.kind).toBe('fires');
        if (plan.kind !== 'fires') return;
        expect(plan.ops).toEqual([]);
        expect(plan.away?.destPath).toBe('archive.md');
        expect(plan.away?.content).toBe('- [x] T @2026-08-17');
        expect(plan.away?.ops.map(op => op.kind)).toEqual(['remove']);
    });
});

describe('the fire and update ops, in one write', () => {
    it('rewrites the row, then fires from the lines the rewrite left', () => {
        const lines = ['# N', '- [ ] T @2026-08-17 ==> every 1d', '- [ ] U'];
        const fire = executor().fireOp(FILE);
        const after = written(lines, 1, [{ kind: 'update', text: '- [x] T @2026-08-17 ==> every 1d' }, fire.op]);
        expect(after).toEqual(['# N', '- [ ] T @2026-08-18 ==> every 1d', '- [x] T @2026-08-17', '- [ ] U']);
        expect(fire.planned()?.kind).toBe('fires');
    });

    it('writes the rewrite alone when the fire plans nothing, and says what it planned', () => {
        const lines = ['- [ ] T @2026-08-17 ==> at(end + 1d)'];
        const fire = executor().fireOp(FILE);
        const after = written(lines, 0, [{ kind: 'update', text: '- [x] T @2026-08-17 ==> at(end + 1d)' }, fire.op]);
        expect(after).toEqual(['- [x] T @2026-08-17 ==> at(end + 1d)']);
        expect(fire.planned()?.kind).toBe('failed');
    });

    it('keeps the row\'s indentation on an update, and changes its property lines', () => {
        const lines = ['- [ ] P', '    - [ ] T', '        - color:: red'];
        const after = written(lines, 1, [{
            kind: 'update', text: '- [x] T',
            childOps: [{ key: 'color', op: 'set', value: 'blue' }],
        }]);
        expect(after).toEqual(['- [ ] P', '    - [x] T', '        - color:: blue']);
    });
});
