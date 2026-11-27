import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { VaultSession } from '../helpers/vaultSession';
import { openMoveHub, stubMoveHubGlobals, settle, tick } from '../helpers/moveHub';
import { holdPresses } from '../../../src/views/sharedUI/PressCommit';
import { asEl } from '../helpers/focusDom';

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

describe('the date fields and their menus, as the row\'s line and its section say', () => {
    type Key = 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'dueDate' | 'dueTime';
    const input = (h: Hub, key: Key) =>
        (h.form as unknown as { dateGroup: { getInput(key: Key): unknown } }).dateGroup.getInput(key) as Hub['root'];
    const dashed = (h: Hub, key: Key) => input(h, key).parent!.classes.has('tv-form__control--inherited');
    const menu = (h: Hub, key: Key) => {
        h.click(input(h, key).parent!.find('tv-form__menu-button'));
        return h.menus.last()!.items;
    };
    const pick = async (h: Hub, key: Key, title: string) => {
        menu(h, key).find(item => item.title === title)!.click!();
        await settle();
        await tick(60);
    };

    it('shows the section\'s start date faint in a dashed field, and writes it to the row from its menu', async () => {
        const h = await open(['# Tasks', '- tv-start:: 2026-12-01', '- [ ] Row', '# Done', '']);
        expect([input(h, 'startDate').placeholder, dashed(h, 'startDate')]).toEqual(['2026-12-01', true]);
        expect(menu(h, 'startDate').map(item => item.title)).toEqual(['Inherited from section', 'Open inherited line', 'Write inherited value to this task']);
        await pick(h, 'startDate', 'Write inherited value to this task');
        expect(h.lines()[2]).toBe('- [ ] Row @2026-12-01');
        expect([input(h, 'startDate').value, dashed(h, 'startDate')]).toEqual(['2026-12-01', false]);
        expect(rowSays(h)).toEqual([]);
    });

    it('frames what the rules fill in solid, not as an inherited value', async () => {
        const h = await open(['# Tasks', '- [ ] Row @2026-11-26', '# Done', '']);
        expect(dashed(h, 'endDate')).toBe(false);
        expect(input(h, 'endDate').placeholder).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(input(h, 'startDate').parent!.find('tv-form__menu-button')!.style.display).toBe('');
        expect(input(h, 'endDate').parent!.find('tv-form__menu-button')!.style.display).toBe('none');
        expect(input(h, 'startDate').parent!.find('tv-form__clear-button')).toBeNull();
    });

    it('clears the row\'s own start date to follow the section\'s, its time kept', async () => {
        const h = await open(['# Tasks', '- tv-start:: 2026-12-01', '- [ ] Row @2026-11-26T10:00', '# Done', '']);
        expect(menu(h, 'startDate').map(item => item.title)).toEqual(['Inherited from section', 'Open inherited line', 'Clear and follow inherited value']);
        await pick(h, 'startDate', 'Clear and follow inherited value');
        expect(h.lines()[2]).toBe('- [ ] Row @10:00');
        expect([input(h, 'startDate').value, input(h, 'startDate').placeholder, dashed(h, 'startDate')]).toEqual(['', '2026-12-01', true]);
    });

    it('writes the whole inherited due from the due\'s time field', async () => {
        const h = await open(['# Tasks', '- tv-due:: 2026-12-05 18:00', '- [ ] Row', '# Done', '']);
        expect([input(h, 'dueDate').placeholder, input(h, 'dueTime').placeholder, dashed(h, 'dueTime')]).toEqual(['2026-12-05', '18:00', true]);
        await pick(h, 'dueTime', 'Write inherited value to this task');
        expect(h.host.task().due).toBe('2026-12-05T18:00');
        expect([input(h, 'dueDate').value, input(h, 'dueTime').value]).toEqual(['2026-12-05', '18:00']);
    });

    it('shows the time\'s format in the due\'s time field under an inherited due with no time', async () => {
        const h = await open(['# Tasks', '- tv-due:: 2026-12-05', '- [ ] Row', '# Done', '']);
        expect([input(h, 'dueTime').placeholder, dashed(h, 'dueTime')]).toEqual(['HH:mm', true]);
    });

    it('clears the due\'s time alone from its time field, the date kept', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '# Done', '']);
        input(h, 'dueDate').focus();
        input(h, 'dueDate').type('2026-12-05');
        input(h, 'dueTime').focus();
        input(h, 'dueTime').type('18:00');
        h.field('name').focus();
        await settle();
        await tick(60);
        expect(h.host.task().due).toBe('2026-12-05T18:00');
        expect(menu(h, 'dueTime').map(item => item.title)).toEqual(['Clear value']);
        await pick(h, 'dueTime', 'Clear value');
        expect(h.host.task().due).toBe('2026-12-05');
    });

    it('writes nothing where the inherited value breaks a rule, the value left in the field and why said under it', async () => {
        const h = await open(['# Tasks', '- tv-end:: 2026-11-01', '- [ ] Row @2026-11-26', '# Done', '']);
        await pick(h, 'endDate', 'Write inherited value to this task');
        expect(h.lines()[2]).toBe('- [ ] Row @2026-11-26');
        expect(input(h, 'endDate').value).toBe('2026-11-01');
        expect(rowSays(h)).not.toEqual([]);
    });

    it('clears the whole due from its date field, the date and the time', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '# Done', '']);
        input(h, 'dueDate').focus();
        input(h, 'dueDate').type('2026-12-05');
        input(h, 'dueTime').focus();
        input(h, 'dueTime').type('18:00');
        h.field('name').focus();
        await settle();
        await tick(60);
        expect(menu(h, 'dueDate').map(item => item.title)).toEqual(['Clear value']);
        await pick(h, 'dueDate', 'Clear value');
        expect(h.host.task().due).toBeUndefined();
        expect([input(h, 'dueDate').value, input(h, 'dueTime').value]).toEqual(['', '']);
    });

    it('draws no menu and no dashed frame in the due\'s time field for a due of the row\'s own with no time and nothing inherited', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '# Done', '']);
        input(h, 'dueDate').focus();
        input(h, 'dueDate').type('2026-12-05');
        h.field('name').focus();
        await settle();
        await tick(60);
        expect(h.host.task().due).toBe('2026-12-05');
        expect(input(h, 'dueTime').parent!.find('tv-form__menu-button')!.style.display).toBe('none');
        expect(dashed(h, 'dueTime')).toBe(false);
        expect(input(h, 'dueDate').parent!.find('tv-form__menu-button')!.style.display).toBe('');
    });

    it('shows the start the rules fill in from the end solid under a section\'s no value of the start, and no value dashed where they fill in none', async () => {
        const filled = await open(['# Tasks', '- tv-start::', '- [ ] Row @>2026-12-08', '# Done', '']);
        expect(input(filled, 'startDate').placeholder).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(dashed(filled, 'startDate')).toBe(false);
        const none = await open(['# Tasks', '- tv-start::', '- [ ] Row', '# Done', '']);
        expect([input(none, 'startDate').placeholder, dashed(none, 'startDate')]).toEqual(['No value', true]);
    });

    it('greys the opening of the inherited line alone while the row is moved', async () => {
        const h = await open(['# Tasks', '- tv-start:: 2026-12-01', '- [ ] Row', '# Done', '']);
        await h.begin();
        expect(menu(h, 'startDate').map(item => [item.title, item.disabled])).toEqual([
            ['Inherited from section', true],
            ['Open inherited line', true],
            ['Write inherited value to this task', false],
        ]);
    });

    describe('pressed with a text in the fields that does not read, the hub holding its presses as its panel does', () => {
        const held = async (lines: string[]) => {
            const h = await open(lines);
            holdPresses(asEl(h.root));
            return h;
        };
        const typeIn = (h: Hub, key: Key, text: string) => {
            input(h, key).focus();
            input(h, key).type(text);
        };
        const press = (h: Hub, key: Key) => {
            const shown = h.menus.last();
            h.click(input(h, key).parent!.find('tv-form__menu-button'));
            return h.menus.last() === shown ? null : h.menus.last()!.items;
        };

        it('opens the field\'s own menu, the text kept and why said, and the item picked puts its value in the text\'s stead', async () => {
            const h = await held(['# Tasks', '- [ ] Row @2026-11-26', '# Done', '']);
            typeIn(h, 'startDate', 'tomorrow');
            const items = press(h, 'startDate');
            expect(items?.map(item => item.title)).toEqual(['Clear value']);
            expect(input(h, 'startDate').value).toBe('tomorrow');
            expect(rowSays(h)).not.toEqual([]);
            items!.find(item => item.title === 'Clear value')!.click!();
            await settle();
            await tick(60);
            expect(h.lines()[1]).toBe('- [ ] Row');
            expect(input(h, 'startDate').value).toBe('');
            expect(rowSays(h)).toEqual([]);
        });

        it('opens the due\'s date menu over a time typed that does not read, the due being one value, and writes the inherited due over it', async () => {
            const h = await held(['# Tasks', '- tv-due:: 2026-12-05', '- [ ] Row', '# Done', '']);
            typeIn(h, 'dueTime', '99:99');
            const items = press(h, 'dueDate');
            expect(items?.map(item => item.title)).toEqual(['Inherited from section', 'Open inherited line', 'Write inherited value to this task']);
            items!.find(item => item.title === 'Write inherited value to this task')!.click!();
            await settle();
            await tick(60);
            expect(h.host.task().due).toBe('2026-12-05');
            expect([input(h, 'dueDate').value, input(h, 'dueTime').value]).toEqual(['2026-12-05', '']);
            expect(rowSays(h)).toEqual([]);
        });

        it('opens no menu of another value over it: the start date\'s, over a start time that does not read', async () => {
            const h = await held(['# Tasks', '- [ ] Row @2026-11-26', '# Done', '']);
            typeIn(h, 'startTime', '99:99');
            expect(press(h, 'startDate')).toBeNull();
            expect(input(h, 'startTime').value).toBe('99:99');
        });
    });

    it('shows a section\'s no value of the start as no value in a dashed field, with nothing the rules fill in', async () => {
        const h = await open(['# Tasks', '- tv-start::', '- [ ] Row', '# Done', '']);
        expect([input(h, 'startDate').placeholder, dashed(h, 'startDate')]).toEqual(['No value', true]);
        expect(menu(h, 'startDate').map(item => item.title)).toEqual(['Inherited from section', 'Open inherited line']);
    });
});

describe('the opening of the inherited line from a field\'s menu, for a value the note\'s frontmatter gives', () => {
    it('opens the frontmatter\'s line of the field\'s own key: the end, the due, the line style and the mask', async () => {
        const h = await open(['---', 'tv-end: 2026-12-08', 'tv-due: 2026-12-05', 'tv-linestyle: dashed', 'tv-mask: "***"', '---', '# Tasks', '- [ ] Row @2026-11-26', '# Done', '']);
        const opened: unknown[] = [];
        Object.defineProperty(h.host, 'openSource', { get: () => (locate: (task: Hub['row']) => unknown) => { opened.push(locate(h.host.task())); } });
        const boxes = [
            h.root.findAll('tv-ctrl__text-input').find(el => el.attrs.get('aria-label')?.startsWith('End'))!.parent!,
            h.root.findAll('tv-ctrl__text-input').find(el => el.attrs.get('aria-label')?.startsWith('Due') && el.attrs.get('aria-label')!.endsWith('Time'))!.parent!,
            h.field('linestyle').parent!,
            h.field('mask').parent!,
        ];
        for (const box of boxes) {
            h.click(box.find('tv-form__menu-button'));
            h.menus.last()!.items.find(item => item.title === 'Open inherited line')!.click!();
        }
        expect(opened).toEqual([
            { line: 1, frontmatterKey: 'tv-end' },
            { line: 2, frontmatterKey: 'tv-due' },
            { line: 3, frontmatterKey: 'tv-linestyle' },
            { line: 4, frontmatterKey: 'tv-mask' },
        ]);
    });
});

describe('the color, the line style and the mask locked by a finding', () => {
    it('draw no menu, though the section gives a value', async () => {
        for (const [key, value] of [['tv-color', 'red'], ['tv-linestyle', 'dashed'], ['tv-mask', '***']] as const) {
            const h = await open(['# Tasks', `- ${key}:: ${value}`, '- [ ] Row', `    - ${key}:: ${value}`, `    - ${key}:: ${value}`, '# Done', '']);
            const field = key === 'tv-color' ? 'color' : key === 'tv-linestyle' ? 'linestyle' : 'mask';
            expect(h.field(field).disabled, key).toBe(true);
            expect(h.field(field).parent!.find('tv-form__menu-button')!.style.display, key).toBe('none');
        }
    });
});
