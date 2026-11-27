import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { VaultSession } from '../helpers/vaultSession';
import { openMoveHub, stubMoveHubGlobals, settle, tick } from '../helpers/moveHub';

/**
 * A row's own date and color emptied in the hub's fields while its section
 * gives a value of the same field: what is written to the note, what is
 * said under the field, and what the field and the color's swatch show. The host, the form and the
 * vault are real (`openMoveHub`).
 */

const lives: VaultSession[] = [];
beforeAll(stubMoveHubGlobals);
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { while (lives.length) lives.pop()!.dispose(); vi.restoreAllMocks(); });
const open = (lines: string[]) => openMoveHub(s => { lives.push(s); }, lines);
type Hub = Awaited<ReturnType<typeof open>>;

/** What is said under the fields, the form's own place left out. */
const rowSays = (h: Hub) => h.root.findAll('tv-form__says')
    .filter(says => !says.classes.has('tv-form__says--form'))
    .flatMap(says => says.children.map(child => child.text));

/** Empty the field and leave it for `next`, and let the write and its echo be answered. */
async function empty(h: Hub, field: Parameters<Hub['field']>[0], next: Parameters<Hub['field']>[0]) {
    h.field(field).focus();
    h.field(field).type('');
    h.field(next).focus();
    await settle();
    await tick(60);
}

describe('a row\'s own start date emptied under a section that gives one', () => {
    it('takes the start out of the line, and shows the section\'s date faint in the field', async () => {
        const h = await open(['# Tasks', '- tv-start:: 2026-12-01', '- [ ] Row @2026-11-26', '# Done', '']);
        await empty(h, 'start', 'end');
        expect(h.lines()[2]).toBe('- [ ] Row');
        expect(h.field('start').value).toBe('');
        expect(h.field('start').placeholder).toBe('2026-12-01');
        expect(rowSays(h)).toEqual([]);
    });
});

describe('a row\'s own start date emptied, its time kept, under a section that gives a date', () => {
    it('writes the start as the time alone, the day the section\'s, and says nothing under the field', async () => {
        const h = await open(['# Tasks', '- tv-start:: 2026-12-01', '- [ ] Row @2026-11-26T10:00', '# Done', '']);
        await empty(h, 'start', 'end');
        expect(rowSays(h)).toEqual([]);
        expect(h.lines()[2]).toBe('- [ ] Row @10:00');
        expect(h.host.task()).toMatchObject({ startTime: '10:00', cascadeContext: { startDate: '2026-12-01' } });
        expect(h.field('start').placeholder).toBe('2026-12-01');
    });
});

describe('a row\'s own color emptied', () => {
    it('takes the row\'s color line out, whether its section gives a color or not', async () => {
        for (const above of [['- tv-color:: blue'], []]) {
            const h = await open(['# Tasks', ...above, '- [ ] Row', '    - tv-color:: red', '# Done', '']);
            await empty(h, 'color', 'name');
            expect(h.lines(), above.join()).toEqual(['# Tasks', ...above, '- [ ] Row', '# Done', '']);
            expect(h.field('color').value, above.join()).toBe('');
        }
    });
});

describe('the color\'s swatch under a section that gives a color', () => {
    const swatch = (h: Hub) => h.root.find('task-hub__color-swatch')!.style.backgroundColor;

    it('shows nothing for a row that says it has no color', async () => {
        const h = await open(['# Tasks', '- tv-color:: blue', '- [ ] Row', '    - tv-color::', '# Done', '']);
        expect(swatch(h)).toBe('transparent');
    });

    it('shows the row\'s own color, and the section\'s while the field is emptied, before it is committed', async () => {
        const h = await open(['# Tasks', '- tv-color:: blue', '- [ ] Row', '    - tv-color:: red', '# Done', '']);
        expect(swatch(h)).toBe('red');
        h.field('color').focus();
        h.field('color').type('');
        expect(swatch(h)).toBe('blue');
    });
});
