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

describe('the color\'s field and its menu, as its own line and its section say', () => {
    const colorInput = (h: Hub) => h.field('color');
    const box = (h: Hub) => colorInput(h).parent!;
    const button = (h: Hub) => box(h).find('tv-form__menu-button')!;
    /** The color's menu, opened: its lines' titles, the greyed head first. */
    const menu = (h: Hub) => {
        h.click(button(h));
        return h.menus.last()!.items;
    };
    const titles = (h: Hub) => menu(h).map(item => item.title);
    const pick = async (h: Hub, title: string) => {
        menu(h).find(item => item.title === title)!.click!();
        await settle();
        await tick(60);
    };
    const swatch = (h: Hub) => h.root.find('task-hub__color-swatch')!.style.backgroundColor;
    const struck = (h: Hub) => box(h).find('tv-form__struck-text')?.text ?? null;

    it('shows the section\'s color faint in a dashed field, offers to write it or hide it, and writes it', async () => {
        const h = await open(['# Tasks', '- tv-color:: blue', '- [ ] Row', '# Done', '']);
        expect(colorInput(h).placeholder).toBe('blue');
        expect(box(h).classes.has('tv-form__control--inherited')).toBe(true);
        expect(swatch(h)).toBe('blue');
        expect(titles(h)).toEqual(['Inherited from section', 'Open inherited line', 'Write inherited value to this task', 'Set to no value']);
        await pick(h, 'Write inherited value to this task');
        expect(h.lines()).toEqual(['# Tasks', '- tv-color:: blue', '- [ ] Row', '\t- tv-color:: blue', '# Done', '']);
        expect(colorInput(h).value).toBe('blue');
        expect(box(h).classes.has('tv-form__control--inherited')).toBe(false);
    });

    it('hides the section\'s color under the row\'s own no value, struck through, and follows it again', async () => {
        const h = await open(['# Tasks', '- tv-color:: blue', '- [ ] Row', '# Done', '']);
        await pick(h, 'Set to no value');
        expect(h.lines()).toEqual(['# Tasks', '- tv-color:: blue', '- [ ] Row', '\t- tv-color::', '# Done', '']);
        expect(struck(h)).toBe('blue');
        expect(colorInput(h).placeholder).toBe('blue');
        expect(box(h).classes.has('tv-form__control--inherited')).toBe(false);
        expect(swatch(h)).toBe('transparent');
        expect(titles(h)).toEqual(['Inherited from section', 'Open inherited line', 'Follow inherited value']);
        await pick(h, 'Follow inherited value');
        expect(h.lines()).toEqual(['# Tasks', '- tv-color:: blue', '- [ ] Row', '# Done', '']);
        expect(struck(h)).toBeNull();
        expect(colorInput(h).placeholder).toBe('blue');
    });

    it('offers to hide the section\'s color, or to clear the row\'s own and follow it, over the row\'s own color', async () => {
        const h = await open(['# Tasks', '- tv-color:: blue', '- [ ] Row', '    - tv-color:: red', '# Done', '']);
        expect(box(h).classes.has('tv-form__control--inherited')).toBe(false);
        // What emptying the field shows.
        expect(colorInput(h).placeholder).toBe('blue');
        expect(titles(h)).toEqual(['Inherited from section', 'Open inherited line', 'Set to no value', 'Clear and follow inherited value']);
        await pick(h, 'Clear and follow inherited value');
        expect(h.lines()).toEqual(['# Tasks', '- tv-color:: blue', '- [ ] Row', '# Done', '']);
        expect(colorInput(h).value).toBe('');
    });

    it('clears the row\'s own color with nothing inherited, and offers nothing once the field has neither', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '    - tv-color:: red', '# Done', '']);
        expect(titles(h)).toEqual(['Clear value']);
        await pick(h, 'Clear value');
        expect(h.lines()).toEqual(['# Tasks', '- [ ] Row', '# Done', '']);
        expect(button(h).style.display).toBe('none');
    });

    it('shows the row\'s own no value with nothing inherited as no value, its swatch empty, and deletes its key', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '    - tv-color::', '# Done', '']);
        expect(colorInput(h).placeholder).toBe('No value');
        expect(swatch(h)).toBe('transparent');
        expect(titles(h)).toEqual(['Delete key']);
        await pick(h, 'Delete key');
        expect(h.lines()).toEqual(['# Tasks', '- [ ] Row', '# Done', '']);
    });

    it('shows a section\'s no value as no value in a dashed field, its menu only where it is written', async () => {
        const h = await open(['---', 'tv-color: red', '---', '# Tasks', '- tv-color::', '- [ ] Row', '# Done', '']);
        expect(colorInput(h).placeholder).toBe('No value');
        expect(box(h).classes.has('tv-form__control--inherited')).toBe(true);
        expect(titles(h)).toEqual(['Inherited from section', 'Open inherited line']);
    });
});

describe('the mask\'s field and its menu', () => {
    it('stands in a box of its own, which draws its frame and its menu button', async () => {
        const h = await open(['# Tasks', '- tv-mask:: ***', '- [ ] Row', '    - tv-mask::', '# Done', '']);
        const box = h.field('mask').parent!;
        expect(box.classes.has('tv-form__control')).toBe(true);
        expect(box.classes.has('tv-form__has-menu')).toBe(true);
        expect(box.find('tv-form__struck-text')!.text).toBe('***');
    });
});
