import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * The places in the source that call `.focus(` themselves rather than ask
 * `placeFocus` (`views/sharedUI/FocusPlacement.ts`), each with why.
 *
 * A focus put on a field raises the on-screen keyboard, so `placeFocus`
 * puts it once the plugin's menus have gone from the screen and its
 * overlays have opened: what moves meanwhile would rise with the keyboard.
 * A place that puts a focus goes through it, unless it is one of these:
 * the parts of putting a focus themselves, a place that only answers where
 * the focus goes, a focus kept where it is as a part is drawn again or
 * moved on within what is being typed (the keyboard is up already, and
 * closing it for a wait would drop what is typed), an editor's own keys, a
 * button, and the native picker's fallback. A place added fails here until
 * it goes through `placeFocus`, or is listed with its reason.
 *
 * A place is named by its file and its line's code (comments cut,
 * trimmed), not by its line number: a line that moves keeps its place.
 */

const SRC = join(__dirname, '../../../src');

/** A place that calls `.focus(` itself, by its file and its line's code, and why it does not ask `placeFocus`. */
const PLACES: Array<{ file: string; line: string; why: string }> = [
    // Putting a focus: what placeFocus and the overlay's first focus are made of.
    {
        file: 'utils/FieldFocus.ts',
        line: 'to.focus(options);',
        why: 'focusField: the field takes the focus, its text met as the field asks; placeFocus puts every focus through it',
    },
    {
        file: 'views/sharedUI/FocusPlacement.ts',
        line: 'opts.hold?.focus({ preventScroll: true });',
        why: 'placeFocus waiting: what the caller names (an overlay\'s panel) holds the focus meanwhile, which raises no keyboard',
    },
    {
        file: 'views/sharedUI/OverlayShell.ts',
        line: 'if (!holds(doc.activeElement)) panel.focus({ preventScroll: true });',
        why: 'an overlay\'s first focus, put by placeFocus, that did not go into the surface (the field hidden or disabled, or none named): the panel takes it, which raises no keyboard',
    },

    // Where an overlay's first focus goes: answered, not put.
    {
        file: 'modals/section/SectionField.ts',
        line: 'return at === \'note\' ? this.note.focus() : { to: this.headingInput, selection: NAME_ON_FOCUS };',
        why: 'answers where the focus goes (NoteField.focus answers a FieldFocus) and puts none',
    },
    {
        file: 'modals/noteops/DestinationField.ts',
        line: 'return at === \'note\' ? this.note.focus() : { to: this.headingInput, selection: NAME_ON_FOCUS };',
        why: 'answers where the focus goes (NoteField.focus answers a FieldFocus) and puts none',
    },
    {
        file: 'modals/section/SectionModal.ts',
        line: '? this.field.focus(this.opts.initial.note.picked === null ? \'note\' : \'heading\')',
        why: 'the dialog\'s initialFocus: answers where the overlay puts its first focus, and puts none',
    },
    {
        file: 'modals/noteops/SendModal.ts',
        line: 'return editor ? { to: editor } : this.field.focus(\'note\');',
        why: 'the dialog\'s initialFocus: answers where the overlay puts its first focus, and puts none',
    },
    {
        file: 'modals/place/PlacePane.ts',
        line: 'return this.field.focus(wrong ?? \'note\');',
        why: 'answers where the focus goes in the place\'s fields (HubPlace.focus) and puts none',
    },

    {
        file: 'modals/hub/TaskHubForm.ts',
        line: 'return this.place?.focus() ?? null;',
        why: 'answers where the focus goes in the place\'s fields (HubPlace.focus answers a FieldFocus) and puts none',
    },

    // A part drawn again, or the typing going on to the next field: the keyboard is up, and a wait would close it.
    {
        file: 'modals/hub/fields/TagsFieldGroup.ts',
        line: 'if (restoreFocus) this.addInput?.focus();',
        why: 'the tags drawn again on a tag added or taken out: the add field keeps the focus it held',
    },
    {
        file: 'modals/hub/fields/PropertiesFieldGroup.ts',
        line: 'if (focus) this.lists.get(focus.folded)?.focusTarget(focus.focus)?.focus();',
        why: 'a property\'s list drawn again on its item written: the focus goes on where the list says the edit goes on',
    },
    {
        file: 'modals/hub/fields/PropertiesFieldGroup.ts',
        line: 'valueInput.focus();',
        why: 'a key picked from the key field\'s list: the typing goes on into the value field beside it',
    },

    // An editor's own keys: the caret goes on between the source editor's two editors.
    {
        file: 'modals/form/source/SourceEditor.ts',
        line: 'this.parentView.focus();',
        why: 'SourceEditor.focus: the Focusable placeFocus puts the focus on; the parent\'s line takes it, the caret at its end',
    },
    {
        file: 'modals/form/source/SourceEditor.ts',
        line: 'children.focus();',
        why: 'Enter splitting the parent\'s line, and ArrowDown off its last row: the caret goes on into the children\'s editor',
    },
    {
        file: 'modals/form/source/SourceEditor.ts',
        line: 'children.focus();',
        why: 'Enter splitting the parent\'s line, and ArrowDown off its last row: the caret goes on into the children\'s editor',
    },
    {
        file: 'modals/form/source/SourceEditor.ts',
        line: 'parent.focus();',
        why: 'ArrowUp off the children\'s first row: the caret goes back to the parent\'s line',
    },

    // No field: no keyboard to wait for.
    {
        file: 'modals/form/FormActions.ts',
        line: 'this.cancelButton.focus();',
        why: 'the question a close puts: its answer that keeps, a button, takes the focus, which raises no keyboard',
    },
    {
        file: 'modals/form/FormActions.ts',
        line: 'this.buttons.find(({ spec }) => spec.tone === \'cta\')?.el.focus();',
        why: 'a create ended unwritten that can be asked again: the act, a button, takes the focus, which raises no keyboard',
    },
    {
        file: 'views/sharedUI/TabStrip.ts',
        line: 'this.tabs.get(id)?.button.focus();',
        why: 'a tab gone to by the arrow keys, chosen with the focus by its caller (focusTab: the hub form\'s basic tab, for a place with no field), or chosen while the focus was in the pane it hides: its button takes the focus, which raises no keyboard',
    },
    {
        file: 'views/sharedUI/NativePicker.ts',
        line: 'input.focus();',
        why: 'the native picker refused (showPicker threw): the date, time or colour input is focused and clicked in the press\'s own task, the best left to open it',
    },
];

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return path.endsWith('.ts') ? [path] : [];
    });
}

/** The line's code: a `//` comment cut, trimmed; empty for a line of a block comment. */
function codeOf(line: string): string {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return '';
    return trimmed.replace(/\s+\/\/.*$/, '');
}

/** Every `.focus(` in the source's code, one entry for each, as `file | line`. */
function found(): string[] {
    const at: string[] = [];
    for (const path of sources(SRC)) {
        const file = relative(SRC, path).split('\\').join('/');
        for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
            const line = codeOf(raw);
            const calls = line.split('.focus(').length - 1;
            for (let i = 0; i < calls; i++) at.push(`${file} | ${line}`);
        }
    }
    return at.sort();
}

describe('the places that put the focus themselves, not through placeFocus', () => {
    it('are the places listed, each as many times as listed', () => {
        const listed = PLACES.map(p => `${p.file} | ${p.line}`).sort();
        expect(found()).toEqual(listed);
    });

    it('are counted from the code only, not from what a comment says', () => {
        expect(codeOf('// the input.focus() above')).toBe('');
        expect(codeOf(' * calls input.focus() once open')).toBe('');
        expect(codeOf('input.focus(); // at once')).toBe('input.focus();');
    });

    it('each say why', () => {
        expect(PLACES.filter(p => p.why.trim() === '')).toEqual([]);
    });
});
