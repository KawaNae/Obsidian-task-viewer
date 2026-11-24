import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every place in the source that calls `.focus(`, each with what the focus
 * is for. Each place puts the focus at a moment of its own: at once in a
 * click's handler, a frame after an overlay opens, once a redraw is done.
 * A place added, or one gone, fails here until it is listed with its
 * reason, so the moments the focus is put at stay known in one table.
 *
 * A place is named by its file and its line's code (comments cut,
 * trimmed), not by its line number: a line that moves keeps its place.
 */

const SRC = join(__dirname, '../../../src');

/** A place that calls `.focus(`, by its file and its line's code, and what the focus is for. */
const PLACES: Array<{ file: string; line: string; why: string }> = [
    // The overlay: its opening and its closing.
    {
        file: 'utils/FieldFocus.ts',
        line: 'to.focus(options);',
        why: 'focusField: the field named takes the focus, its text met as the field asks; the overlay\'s first focus and the hub menu\'s Properties items go through it',
    },
    {
        file: 'views/sharedUI/FocusPlacement.ts',
        line: 'opts.hold?.focus({ preventScroll: true });',
        why: 'placeFocus waiting for a menu to go or an overlay to open: what the caller names (an overlay\'s panel) holds the focus, which raises no keyboard, until the field takes it',
    },
    {
        file: 'views/sharedUI/OverlayShell.ts',
        line: 'if (!holds(doc.activeElement)) panel.focus({ preventScroll: true });',
        why: 'an overlay\'s first focus that did not go into the surface (the field hidden or disabled, or none named): the panel takes it',
    },
    {
        file: 'views/sharedUI/OverlayShell.ts',
        line: 'before.focus({ preventScroll: true });',
        why: 'an overlay closed: the focus goes back to what held it before the overlay opened',
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
        file: 'modals/place/PlaceModal.ts',
        line: 'initialFocus: () => (this.field ? this.field.focus(\'note\') : null),',
        why: 'the dialog\'s initialFocus: answers where the overlay puts its first focus, and puts none',
    },

    // In an open dialog, after a press or a key in it.
    {
        file: 'modals/form/FormActions.ts',
        line: 'this.cancelButton.focus();',
        why: 'the question a close puts, asked first or again: the answer that keeps takes the focus',
    },
    {
        file: 'modals/form/ClearButton.ts',
        line: 'if (opts.focusesField) input.focus();',
        why: 'a field cleared by its button: the focus stays on the field',
    },
    {
        file: 'modals/TimerStartOffsetModal.ts',
        line: 'this.input().focus();',
        why: 'the kind of start switched in the open dialog: the field drawn for it takes the focus',
    },
    {
        file: 'modals/hub/TaskHubForm.ts',
        line: 'first.input.focus();',
        why: 'a create pressed while a field cannot be saved: that field takes the focus',
    },
    {
        file: 'modals/hub/TaskHubForm.ts',
        line: '(first?.input ?? this.nameField.fieldElement())?.focus();',
        why: 'keep, the answer to a close\'s question: the first field that cannot be saved, or the name, takes the focus',
    },
    {
        file: 'modals/hub/TaskHubSource.ts',
        line: 'editor.focus();',
        why: 'the hub\'s source mode opened from its button: its editor takes the focus',
    },
    {
        file: 'modals/hub/TaskHubSource.ts',
        line: 'if (this.guard.keep()) this.opened?.editor.focus();',
        why: 'keep, the answer to a close\'s question in the source mode: the editor takes the focus',
    },
    {
        file: 'modals/noteops/SendDialog.ts',
        line: 'if (this.guard.keep()) this.firstEditor()?.focus();',
        why: 'keep, the answer to a close\'s question: the first draft\'s editor takes the focus',
    },
    {
        file: 'modals/form/source/SourceEditor.ts',
        line: 'this.parentView.focus();',
        why: 'SourceEditor.focus: the parent\'s line takes the focus, the caret at its end',
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
    {
        file: 'modals/hub/fields/PropertiesFieldGroup.ts',
        line: 'valueInput.focus();',
        why: 'a key picked from the key field\'s list: the value field beside it takes the focus',
    },

    // A part drawn again: the focus kept, or put where the edit goes on.
    {
        file: 'modals/hub/fields/TagsFieldGroup.ts',
        line: 'if (restoreFocus) this.addInput?.focus();',
        why: 'the tags drawn again on a tag added or taken out: the add field keeps the focus it held',
    },
    {
        file: 'modals/hub/fields/PropertiesFieldGroup.ts',
        line: 'if (focus) this.lists.get(focus.folded)?.focusTarget(focus.focus)?.focus();',
        why: 'a property\'s list drawn again on its item written: the focus goes where the list says the edit goes on',
    },
    {
        file: 'modals/hub/fields/StyleFieldGroup.ts',
        line: 'this.inputs[field]?.focus();',
        why: 'StyleFieldGroup.focus: the style field named takes the focus; nothing in the source calls it',
    },

    // In a view.
    {
        file: 'views/sharedUI/ListSectionRenderer.ts',
        line: 'input.focus();',
        why: 'a list section\'s rename, from its menu: the name field put in the name\'s place takes the focus at once',
    },
    {
        file: 'views/sharedUI/NativePicker.ts',
        line: 'input.focus();',
        why: 'the native picker refused (showPicker threw): the input is focused and clicked, the best left to open it',
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

describe('the places that put the focus', () => {
    it('are the places listed, each as many times as listed', () => {
        const listed = PLACES.map(p => `${p.file} | ${p.line}`).sort();
        expect(found()).toEqual(listed);
    });

    it('are counted from the code only, not from what a comment says', () => {
        expect(codeOf('// the input.focus() above')).toBe('');
        expect(codeOf(' * calls input.focus() once open')).toBe('');
        expect(codeOf('input.focus(); // at once')).toBe('input.focus();');
    });

    it('each say what the focus is for', () => {
        expect(PLACES.filter(p => p.why.trim() === '')).toEqual([]);
    });
});
