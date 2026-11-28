import { describe, it, expect } from 'vitest';
import { FieldMenuButton, type FieldMenu } from '../../../src/modals/form/FieldMenuButton';
import { FieldLookView } from '../../../src/modals/hub/fields/FieldLookView';
import { FieldMenus, HEAD_VALUE_LENGTH } from '../../../src/modals/hub/fields/FieldMenus';
import type { MenuPresenter } from '../../../src/interaction/menu/MenuPresenter';
import { keyOf } from '../../../src/views/sharedUI/PressCommit';
import { FocusDoc, asEl } from '../helpers/focusDom';
import { menuSpy } from '../helpers/menuSpy';

/**
 * The … at a field's end: out of the Tab order, keyed for the hub's presses,
 * shown while its menu has an item, and showing the menu as the field is
 * when it is pressed.
 */
describe('FieldMenuButton', () => {
    function setUp(menu: () => FieldMenu, disabled = false) {
        const doc = new FocusDoc();
        const box = doc.root().createDiv({ cls: 'tv-form__control' });
        const menus = menuSpy();
        const button = new FieldMenuButton(asEl(box), {
            label: 'Menu of color',
            key: 'color:menu',
            fields: () => [],
            menu,
            presenter: menus.presenter as unknown as MenuPresenter,
            disabled: () => disabled,
        });
        return { box, button: button.button, menus, sync: () => button.sync() };
    }

    const ran: string[] = [];
    const full: FieldMenu = {
        heads: FieldMenus.heads({ source: 'section', inherited: { kind: 'value', text: 'sales' }, overridden: true }),
        items: [
            FieldMenus.item({ action: 'openSource', disabled: true }, () => ran.push('open')),
            FieldMenus.item({ action: 'dropOwn', name: 'clearToInherited', reach: 'value' }, () => ran.push('drop')),
        ],
    };

    it('stands at the field\'s end, out of the Tab order, keyed for a press', () => {
        const { box, button } = setUp(() => full);
        expect(box.classes.has('tv-form__has-menu')).toBe(true);
        expect(button.tabIndex).toBe(-1);
        expect(keyOf(button)).toBe('color:menu');
        expect(button.getAttribute('aria-label')).toBe('Menu of color');
    });

    it('shows the menu under its head, a greyed item taking no press', () => {
        const { button, menus } = setUp(() => full);
        button.dispatchEvent(new Event('click'));
        const shown = menus.last()!;
        expect(shown.items.map(item => [item.title, item.disabled])).toEqual([
            ['Inherited from section', true],
            ['Inherited value: sales', true],
            ['The inherited value is overridden', true],
            ['Open inherited line', true],
            ['Clear and follow inherited value', false],
        ]);
        expect(shown.separatorsAt).toEqual([3]);
        shown.items[4].click!();
        expect(ran).toEqual(['drop']);
    });

    it('is hidden while its menu has no item, and shown once it has', () => {
        let menu: FieldMenu = { heads: [], items: [] };
        const { button, sync } = setUp(() => menu);
        expect(button.style.display).toBe('none');
        menu = full;
        sync();
        expect(button.style.display).toBe('');
    });

    it('opens nothing while the field takes no edit', () => {
        const { button, menus } = setUp(() => full, true);
        expect(button.disabled).toBe(true);
        button.dispatchEvent(new Event('click'));
        expect(menus.last()).toBeUndefined();
    });
});

describe('FieldLookView', () => {
    function setUp() {
        const doc = new FocusDoc();
        const box = doc.root().createDiv({ cls: 'tv-form__control' });
        const input = box.createEl('input', { type: 'text' });
        return { box, input, view: new FieldLookView(asEl(box), asEl(input)) };
    }

    it('frames what the field is given dashed, its value faint', () => {
        const { box, input, view } = setUp();
        view.show({ frame: 'inherited', faint: { kind: 'value', text: 'blue' } });
        expect(box.classes.has('tv-form__control--inherited')).toBe(true);
        expect(input.placeholder).toBe('blue');
        view.show({ frame: 'own', faint: null }, 'YYYY-MM-DD');
        expect(box.classes.has('tv-form__control--inherited')).toBe(false);
        expect(input.placeholder).toBe('YYYY-MM-DD');
    });

    it('draws a value hidden over the field after the input, its placeholder the same value, which the stylesheet draws clear', () => {
        const { box, input, view } = setUp();
        view.show({ frame: 'own', faint: { kind: 'struck', text: 'c' } });
        const struck = box.find('tv-form__struck')!;
        expect(struck.find('tv-form__struck-text')!.text).toBe('c');
        expect(box.classes.has('tv-form__has-struck')).toBe(true);
        expect(box.children.indexOf(struck)).toBeGreaterThan(box.children.indexOf(input));
        expect(input.placeholder).toBe('c');
        view.show({ frame: 'own', faint: { kind: 'noValue' } });
        expect(box.find('tv-form__struck')).toBeNull();
        expect(box.classes.has('tv-form__has-struck')).toBe(false);
        expect(input.placeholder).toBe('No value');
    });
});

describe('FieldMenus.heads: the greyed lines at the head of a field\'s menu', () => {
    const titles = (head: Parameters<typeof FieldMenus.heads>[0]) => FieldMenus.heads(head).map(line => line.title);

    it('says where the value is inherited from and what it is, and that the field\'s own line overrides it where it does', () => {
        expect(titles({ source: 'section', inherited: { kind: 'value', text: 'sales' }, overridden: false }))
            .toEqual(['Inherited from section', 'Inherited value: sales']);
        expect(titles({ source: 'file', inherited: { kind: 'value', text: 'sales' }, overridden: true }))
            .toEqual(['Inherited from file', 'Inherited value: sales', 'The inherited value is overridden']);
    });

    it('says an inherited no value as the fields say it', () => {
        expect(titles({ source: 'section', inherited: { kind: 'noValue' }, overridden: true }))
            .toEqual(['Inherited from section', 'Inherited value: No value', 'The inherited value is overridden']);
    });

    it('cuts a value longer than the line holds, by characters, and ends it in …', () => {
        const at = (text: string) => titles({ source: 'section', inherited: { kind: 'value', text }, overridden: false })[1];
        const fits = 'あ'.repeat(HEAD_VALUE_LENGTH);
        expect(at(fits)).toBe(`Inherited value: ${fits}`);
        expect(at(`${fits}い`)).toBe(`Inherited value: ${fits}…`);
    });

    it('has none where nothing is inherited', () => {
        expect(FieldMenus.heads(null)).toEqual([]);
    });
});
