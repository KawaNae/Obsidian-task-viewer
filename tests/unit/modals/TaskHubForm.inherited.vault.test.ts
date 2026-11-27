import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { VaultSession } from '../helpers/vaultSession';
import { openMoveHub, stubMoveHubGlobals, settle, tick } from '../helpers/moveHub';

/**
 * A row's own date and color emptied in the hub's fields while its section
 * gives a value of the same field: what is written to the note, and what
 * the field shows once the row is read again. The host, the form and the
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
