import { describe, it, expect, vi } from 'vitest';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';
import { renderGenBody } from '../../../src/services/parsing/gen/GenBodyRenderer';
import type { EvalContext } from '../../../src/services/lang/ExprEvaluator';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { DEFAULT_SETTINGS, type Task } from '../../../src/types';

/**
 * The ceilings an evaluation stops at.
 *
 * All of them answer one question: what can be written down and read back. A
 * value that leaves the block has to survive being printed onto a task line
 * and scanned again, and the ones here are the shapes that did not — a year
 * the notation cannot read, a host exception with nowhere to be caught, a tree
 * too deep for the stack that walks it.
 */

const CTX = {
    props: {
        today: { type: 'date', value: '2026-08-16' },
        done: { type: 'datetime', date: '2026-08-16', time: '10:00' },
        start: { type: 'date', value: '2026-08-17' },
        content: { type: 'string', value: 'c' },
    },
    today: '2026-08-16',
    now: { date: '2026-08-16', time: '10:00' },
    weekStartDay: 0,
    // Enough of a host for the one built-in that asks for one.
    host: { formatDate: () => 'formatted' },
} as unknown as EvalContext;

/** What the block does with one interpolation: a refusal, a failure, or a line. */
function run(expr: string): string {
    const body = parseGenBody([`- [ ] c \${${expr}}`], 0);
    const errors = body.diagnostics.filter(d => d.severity === 'error');
    if (errors.length) return `refused: ${errors.map(d => d.code).join(',')}`;
    const out = renderGenBody(body, CTX);
    return out.ok ? `wrote: ${out.parentText}` : `failed: ${out.error.message}`;
}

describe('a date that leaves the calendar stops the evaluation', () => {
    it('refuses the shifts that used to write NaN', () => {
        for (const expr of [
            'today + 99999999y', 'today + 99999999d', 'today + 99999999w', 'today + 99999999mo',
            'today - 99999999y', 'done + 99999999y', 'today + 1d * 999999999',
        ]) {
            expect(run(expr), expr).toContain('failed: This lands outside the four-digit years');
        }
    });

    it('refuses a year the notation cannot read, even where the arithmetic worked', () => {
        // These are the quiet half: no NaN, a real date, and a line that comes
        // back from the next scan with its date gone and the text in its title.
        expect(run('today + 9999y')).toContain('failed:');
        expect(run('today - 9999y')).toContain('failed:');
        expect(run('today + 8000y')).toContain('failed:');
    });

    it('leaves the dates that do read back alone', () => {
        expect(run('today + 1y')).toBe('wrote: - [ ] c 2027-08-16');
        expect(run('today + 7000y')).toBe('wrote: - [ ] c 9026-08-16');
        // Padded, because the notation reads four digits and not fewer.
        expect(run('today - 2000y')).toBe('wrote: - [ ] c 0026-08-16');
        expect(run('today - 1927y')).toBe('wrote: - [ ] c 0099-08-16');
        expect(run('done + 1d')).toBe('wrote: - [ ] c 2026-08-17T10:00');
    });

    it('reads a padded year as the year it wrote, not as a two-digit one', () => {
        // JS maps a two-digit year onto 1900 + y. Padding alone would have
        // turned a loud failure — `26-08-16` is not a date and gets swallowed
        // by the title — into a silent one, a date off by nineteen centuries.
        // Worse inside the language than on the page: this one reads, computes
        // and writes back before any ceiling can look at it.
        expect(run('startOf(year, today - 2000y)')).toBe('wrote: - [ ] c 0026-01-01');
        expect(run('date(today - 2026y)')).toBe('wrote: - [ ] c 0000-08-16');
        expect(run('(today - 2000y) + 1y')).toBe('wrote: - [ ] c 0027-08-16');
    });

    it('holds for every built-in that produces a date', () => {
        // The shift is guarded; these take a date and give one back, so an
        // in-range input has to stay in range. Swept rather than argued.
        for (const expr of [
            'startOf(month, today)', 'endOf(year, today)', 'next("mon", today)',
            'nextCycle(today, 3d)', 'date(done)', 'format(today, "YYYY-MM-DD")',
        ]) {
            expect(run(expr), expr).toMatch(/^wrote:/);
        }
    });
});

describe('a host limit is said in this language before the host says it', () => {
    it('names the digits toFixed will write', () => {
        expect(run('(1.5).toFixed(-1)')).toBe("failed: 'toFixed' takes 0 to 100 digits, got -1");
        expect(run('(1.5).toFixed(101)')).toBe("failed: 'toFixed' takes 0 to 100 digits, got 101");
        expect(run('(1.5).toFixed(1000000)')).toContain('failed:');
    });

    it('leaves the range that works alone', () => {
        expect(run('(1.5).toFixed(0)')).toBe('wrote: - [ ] c 2');
        expect(run('(1.5).toFixed(2)')).toBe('wrote: - [ ] c 1.50');
    });
});

describe('a chain too long to walk is refused where it is written', () => {
    const chain = (n: number, op = ' + ') => Array.from({ length: n }, () => '1').join(op);

    it('refuses the same way every time, however deep the caller was', () => {
        // The old ceiling was the host's stack, so which message came back
        // depended on how much of it was left: a refusal while reading, or a
        // RangeError in the middle of a fire.
        expect(run(chain(2000))).toBe('refused: expr.chain-too-long');
        expect(run(chain(2000, ' * '))).toBe('refused: expr.chain-too-long');
        expect(run(chain(200))).toBe('refused: expr.chain-too-long');
    });

    it('leaves an expression anyone would write alone', () => {
        expect(run(chain(50))).toBe('wrote: - [ ] c 50');
        expect(run('"a".trim().trim().trim()')).toBe('wrote: - [ ] c a');
    });

    it('counts a run of dots too', () => {
        const dots = `"a"${'.trim()'.repeat(200)}`;
        expect(run(dots)).toBe('refused: expr.chain-too-long');
    });
});

// ---------------------------------------------------------------------------
// The other road to a written date: no block, no interpolation
// ---------------------------------------------------------------------------

const FILE = 'note.md';

function makeRepository() {
    return {
        insertRecurrenceForTask: vi.fn().mockResolvedValue(undefined),
        insertGeneratedInstance: vi.fn().mockResolvedValue(undefined),
        appendTaskWithChildren: vi.fn().mockResolvedValue(undefined),
        updateTaskInFile: vi.fn().mockResolvedValue(undefined),
        stripFlow: vi.fn().mockResolvedValue(undefined),
        deleteTaskFromFile: vi.fn().mockResolvedValue(undefined),
    };
}

function makeExecutor(repository: ReturnType<typeof makeRepository>) {
    const taskIndex = {
        waitForScan: vi.fn().mockResolvedValue(undefined),
        resolveTask: vi.fn((t: Task) => t),
        requestScan: vi.fn().mockResolvedValue(undefined),
        notifyImmediate: vi.fn(),
        getGenBlock: vi.fn(() => undefined),
    };
    return new FlowExecutor(
        repository as unknown as TaskRepository,
        taskIndex as unknown as TaskIndex,
        app as never,
        () => DEFAULT_SETTINGS
    );
}

const app = { vault: { getAbstractFileByPath: () => null } };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** Complete a task and hand back the line written for the next one. */
async function fire(line: string): Promise<string | null> {
    const repository = makeRepository();
    const task = TaskParser.parse(line, FILE, 0);
    await makeExecutor(repository).handleTaskCompletion({ ...task!, statusChar: 'x' });
    await flush();
    return (repository.insertRecurrenceForTask.mock.calls[0]?.[1] as string) ?? null;
}

describe('a plain repeating task cannot write a date either', () => {
    it('does not fire when the schedule leaves the calendar', async () => {
        // No generation block is involved. This used to write
        // `- [ ] T @NaN-NaN-NaN ==> +99999999y` into the file.
        expect(await fire('- [x] T @2026-08-17 ==> +99999999y')).toBeNull();
    });

    it('does not fire when the schedule lands on a year that cannot be read', async () => {
        expect(await fire('- [x] T @2026-08-17 ==> +9999y')).toBeNull();
    });

    it('still fires when the date it lands on reads back', async () => {
        const written = await fire('- [x] T @2026-08-17 ==> +1y');
        expect(written).toBe('- [ ] T @2027-08-17 ==> +1y');
        // And the line it wrote is one the scanner reads as the same task.
        const back = TaskParser.parse(written!, FILE, 0);
        expect(back?.startDate).toBe('2027-08-17');
        expect(back?.content).toBe('T');
    });
});
