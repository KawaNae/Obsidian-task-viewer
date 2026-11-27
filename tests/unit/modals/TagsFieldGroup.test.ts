import { describe, it, expect } from 'vitest';
import { TagsFieldGroup } from '../../../src/modals/hub/fields/TagsFieldGroup';
import type { FieldGroupContext } from '../../../src/modals/hub/fields/FieldGroupContext';
import { holdPresses } from '../../../src/views/sharedUI/PressCommit';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { FocusDoc, asEl, type FocusEl } from '../helpers/focusDom';

/**
 * A hub's tags in a stand-in DOM (`focusDom`) whose panel holds the presses
 * on its buttons, the task's writes taken as the hub's host takes them: the
 * task changed at once, as a row's host puts a change in before the note
 * is written.
 */

function setUp(tags: string[], inherited: string[] = []) {
    const doc = new FocusDoc();
    let task: Task = makeTask({ tags, ...(inherited.length > 0 ? { cascadeContext: { tags: inherited } } : {}) });
    const writes: string[][] = [];
    const ctx = {
        task: () => task,
        isShut: () => false,
        locked: () => false,
        put: (updates: Partial<Task> | null) => {
            if (updates?.tags) {
                writes.push(updates.tags);
                task = { ...task, tags: updates.tags };
            }
            return Promise.resolve(true);
        },
        app: { keymap: { pushScope: () => { }, popScope: () => { } } },
        index: { getTasks: () => [] },
        openSource: null,
        issues: { set: () => { }, redraw: () => { } },
    } as unknown as FieldGroupContext;
    const root = doc.root();
    holdPresses(asEl(root));
    new TagsFieldGroup(asEl(root), ctx);
    const chips = () => root.findAll('task-hub__tag-chip');
    return {
        doc,
        writes,
        add: () => root.find('task-hub__tag-add-wrap')!.find('tv-ctrl__input')!,
        chips: () => chips().map(chip => chip.children[0].text),
        /** The tags whose chips are drawn as inherited ones. */
        inheritedChips: () => chips().filter(chip => chip.classes.has('task-hub__tag-chip--cascade')).map(chip => chip.children[0].text),
        /** The × of the chip of `tag`. */
        removeOf: (tag: string): FocusEl => chips().find(chip => chip.children[0].text === `#${tag}`)!.find('tv-ctrl__pill-remove')!,
    };
}

describe('a tag\'s × pressed while the add field holds what was typed', () => {
    it('adds the tag typed, which builds the chips anew, then takes out the tag whose × is pressed: the add field empty and in focus', () => {
        const s = setUp(['a', 'b']);
        const x = s.removeOf('a');
        s.add().focus();
        s.add().type('zz');
        x.press();
        expect(s.writes).toEqual([['a', 'b', 'zz'], ['b', 'zz']]);
        expect(s.chips()).toEqual(['#b', '#zz']);
        expect(s.add().value).toBe('');
        expect(s.doc.activeElement).toBe(s.add());
    });
});

describe('a tag of its own the task inherits as well', () => {
    it('takes out the task\'s own by its ×: the tag stays, drawn as the inherited one with no ×', () => {
        const s = setUp(['a', 'b'], ['a']);
        expect(s.inheritedChips()).toEqual([]);
        s.removeOf('a').press();
        expect(s.writes).toEqual([['b']]);
        expect(s.chips()).toEqual(['#a', '#b']);
        expect(s.inheritedChips()).toEqual(['#a']);
        expect(s.removeOf('a')).toBeNull();
    });
});
