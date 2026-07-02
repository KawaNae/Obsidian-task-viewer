import { describe, it, expect } from 'vitest';
import { FlowPlanDeps, planFlow } from '../../../src/services/flow/FlowPlanner';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { EvalError } from '../../../src/services/lang/ExprEvaluator';
import { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

// 2026-07-02 is a Thursday.
const DEPS: FlowPlanDeps = {
    today: '2026-07-02',
    now: { date: '2026-07-02', time: '10:00' },
    weekStartDay: 1,
    host: { formatDate: (v, tokens) => `[${tokens}]` },
};

function plan(src: string, overrides: Partial<Task> = {}) {
    const { program, diagnostics } = parseFlow(src);
    if (!program) throw new Error(`parse failed: ${diagnostics.map(d => d.message).join('; ')}`);
    const task = makeTask({ statusChar: 'x', flow: { raw: src, program, diagnostics: [] }, ...overrides });
    return planFlow(task, program, DEPS);
}

function createNextOf(effects: ReturnType<typeof plan>) {
    const e = effects.find(e => e.kind === 'create-next');
    if (!e || e.kind !== 'create-next') throw new Error('no create-next effect');
    return e;
}

describe('FlowPlanner', () => {
    describe('effect ordering (invariant: line-mutating effects last)', () => {
        it('repeat: create-next then strip-flow', () => {
            const effects = plan('every mon', { startDate: '2026-06-29' });
            expect(effects.map(e => e.kind)).toEqual(['create-next', 'strip-flow']);
        });

        it('move alone: archive-to then delete-original', () => {
            const effects = plan('move([[Archive]])');
            expect(effects.map(e => e.kind)).toEqual(['archive-to', 'delete-original']);
        });

        it('repeat + move: create-next, archive-to, delete-original', () => {
            const effects = plan('every mon move([[Log]])', { startDate: '2026-06-29' });
            expect(effects.map(e => e.kind)).toEqual(['create-next', 'archive-to', 'delete-original']);
        });
    });

    describe('date shifting', () => {
        it('shifts the whole date block by the anchor delta', () => {
            const { newTask } = createNextOf(plan('every mon', {
                startDate: '2026-06-29', startTime: '09:00',
                endDate: '2026-06-30', endTime: '10:00',
                due: '2026-07-03',
            }));
            // next Monday after 7/2 = 7/6; delta = 7 days
            expect(newTask.startDate).toBe('2026-07-06');
            expect(newTask.startTime).toBe('09:00');
            expect(newTask.endDate).toBe('2026-07-07');
            expect(newTask.endTime).toBe('10:00');
            expect(newTask.due).toBe('2026-07-10');
        });

        it('anchors on due when start/end are absent', () => {
            const { newTask } = createNextOf(plan('every mo@25', { due: '2026-06-25T18:00' }));
            expect(newTask.due).toBe('2026-07-25T18:00');
            expect(newTask.startDate).toBeUndefined();
        });

        it('places dateless afterDone results on start', () => {
            const { newTask } = createNextOf(plan('+3d'));
            expect(newTask.startDate).toBe('2026-07-05');
        });

        it('resets per-instance identity', () => {
            const { newTask } = createNextOf(plan('+1d', {
                startDate: '2026-07-01', blockId: 'abc', timerTargetId: undefined,
                statusChar: 'x', originalText: '- [x] Test task @2026-07-01 ==> +1d ^abc',
            }));
            expect(newTask.statusChar).toBe(' ');
            expect(newTask.id).toBe('');
            expect(newTask.blockId).toBeUndefined();
            expect(newTask.originalText).toBe('');
        });
    });

    describe('telomere', () => {
        it('decrements the count into the next instance', () => {
            const { newTask } = createNextOf(plan('+1d x14', { startDate: '2026-07-01' }));
            expect(newTask.flow?.raw).toBe('+1d x13');
            expect(newTask.flow?.program?.lifetime).toMatchObject({ count: 13 });
        });

        it('x1: final instance carries no flow at all', () => {
            const { newTask } = createNextOf(plan('+1d x1', { startDate: '2026-07-01' }));
            expect(newTask.flow).toBeUndefined();
        });

        it('inherits the command canonically when no telomere', () => {
            const { newTask } = createNextOf(plan('until 2026-12-31 every mon', { startDate: '2026-06-29' }));
            expect(newTask.flow?.raw).toBe('every mon until 2026-12-31');
        });
    });

    describe('until (inclusive, checked against next anchor date)', () => {
        it('generates when next date equals until', () => {
            const effects = plan('every mon until 2026-07-06', { startDate: '2026-06-29' });
            expect(effects.map(e => e.kind)).toEqual(['create-next', 'strip-flow']);
        });

        it('consumes without generating when next date exceeds until', () => {
            const effects = plan('every mon until 2026-07-05', { startDate: '2026-06-29' });
            expect(effects.map(e => e.kind)).toEqual(['strip-flow']);
        });
    });

    describe('set()', () => {
        it('evaluates against the post-shift snapshot', () => {
            const { newTask } = createNextOf(plan('every mon set(due: start + 3d)', { startDate: '2026-06-29' }));
            // post-shift start = 7/6 → due = 7/9
            expect(newTask.due).toBe('2026-07-09');
        });

        it('applies all assignments from one snapshot (no chaining)', () => {
            const { newTask } = createNextOf(plan('every mon set(start: due, due: start + 1d)', {
                startDate: '2026-06-29', due: '2026-07-01',
            }));
            // post-shift: start=7/6, due=7/8. Both RHS see that snapshot:
            // start := 7/8 (old due), due := 7/7 (old start + 1d) — not chained
            expect(newTask.startDate).toBe('2026-07-08');
            expect(newTask.due).toBe('2026-07-07');
        });

        it('sets content from string expressions', () => {
            const { newTask } = createNextOf(plan('every mon set(content: "週報 " + format(start, "MM/DD"))', {
                startDate: '2026-06-29', content: 'old',
            }));
            expect(newTask.content).toBe('週報 [MM/DD]');
        });

        it('clears the time part when set assigns a plain date', () => {
            const { newTask } = createNextOf(plan('every mon set(start: 2026-08-01)', {
                startDate: '2026-06-29', startTime: '09:00',
            }));
            expect(newTask.startDate).toBe('2026-08-01');
            expect(newTask.startTime).toBeUndefined();
        });
    });

    describe('at() evaluates pre-shift, set() post-shift', () => {
        it('at(start + 7d) uses the ORIGINAL start', () => {
            const { newTask } = createNextOf(plan('at(start + 7d)', { startDate: '2026-06-29' }));
            expect(newTask.startDate).toBe('2026-07-06');
        });
    });

    describe('move', () => {
        it('normalizes the destination path', () => {
            const effects = plan('move([[Archive/Done:2026]])');
            const archive = effects.find(e => e.kind === 'archive-to');
            expect(archive).toMatchObject({ destPath: 'Archive/Done_2026.md' });
        });

        it('strips flow and ids from the archived task', () => {
            const effects = plan('move([[Archive]])', { blockId: 'xyz' });
            const archive = effects.find(e => e.kind === 'archive-to');
            if (archive?.kind !== 'archive-to') throw new Error('no archive-to');
            expect(archive.archivedTask.flow).toBeUndefined();
            expect(archive.archivedTask.blockId).toBeUndefined();
        });

        it('supports expression destinations', () => {
            const effects = plan('move([[Log/]] + file.name)', { file: 'Projects/note.md' });
            const archive = effects.find(e => e.kind === 'archive-to');
            expect(archive).toMatchObject({ destPath: 'Log/note.md' });
        });
    });

    describe('options', () => {
        it('nochildren turns off child copying', () => {
            expect(createNextOf(plan('+1d nochildren', { startDate: '2026-07-01' })).copyChildren).toBe(false);
            expect(createNextOf(plan('+1d', { startDate: '2026-07-01' })).copyChildren).toBe(true);
        });

        it('strips timer emoji prefixes from the copied content', () => {
            const { newTask } = createNextOf(plan('+1d', { startDate: '2026-07-01', content: '⏱️ Test task' }));
            expect(newTask.content).toBe('Test task');
        });
    });

    describe('runtime failures', () => {
        it('throws EvalError when a referenced property is unset (executor leaves command intact)', () => {
            expect(() => plan('every mon set(due: end + 1d)', { startDate: '2026-06-29' })).toThrow(EvalError);
        });
    });
});
