import { setIcon, type App } from 'obsidian';
import { t } from '../../../i18n';
import type { PropertyScalar } from '../../../types';
import { PropertyItemInput } from '../../../services/parsing/utils/PropertyItemInput';
import { optional, type Issue } from '../../../utils/values/Read';
import { bindField, type BoundField } from '../../form/bindField';
import { readIssue, type FormIssue } from '../../form/FormIssue';
import { ValueSuggest } from '../../../suggest/ValueSuggest';
import type { HubField, UnsavedField } from './FieldGroupContext';

const ITEM = optional(PropertyItemInput);

/** Where a list field puts its focus once the rows are built anew: an item's input by its place, or the add field. */
export type ListFocus = number | 'add';

export interface PropertyListFieldOptions {
    app: App;
    /** The property's key as the row shows it. */
    key: string;
    /** The field its issues are said of (`prop:<key folded>`). */
    at: HubField;
    /**
     * The row's own items (its list, or the draft made of the inherited
     * one), which the field edits; or the inherited items, which it shows
     * and does not edit.
     */
    own: boolean;
    items: readonly PropertyScalar[];
    /** The form is shut, or a finding locks the property: nothing is edited. */
    disabled: boolean;
    /** The values offered for an item, as spelled (`collectPropertySpellingsForKey`). */
    candidates(): readonly string[];
    /** Write `items` as the row's own list, then put the focus at `focus` (left where it is when none). */
    write(items: PropertyScalar[], focus?: ListFocus): void;
    /** Say what the field's inputs read as wrong, under the row (`IssueBoard`, by `source`). */
    say(source: string, issues: readonly FormIssue<HubField>[]): void;
}

/**
 * A custom property's list in the hub: an item a line, as the note writes
 * it under `- key::`.
 *
 * The row's own items are edited in place: each item's text (an item
 * emptied is taken out), its × taking it out, the add field putting one at
 * the end, and the order changed by dragging an item's handle or by
 * Alt+Up and Alt+Down in its text. An item is read as a line holding it
 * reads it (`PropertyItemInput`): what does not read back as that one item
 * (`null`, `[ ] x`, `a:: b`) is said under the row and not written. Every
 * edit writes the whole list (`write`); a list left with no item takes the
 * property's line out, and the value above comes through.
 *
 * A write builds the rows anew, and the focus stays where it was: in the
 * add field, or in the item it was in at that item's new place (the add
 * field when the item is gone). Focus outside the list's inputs is not
 * moved, so a tap on an item's × or handle brings up no keyboard.
 *
 * An inherited list is shown as it is, and not edited here: its source is
 * opened from the row, and the row made its own starts from a copy of its
 * items (`PropertiesFieldGroup`).
 */
export class PropertyListField {
    readonly el: HTMLElement;
    private readonly itemInputs: HTMLInputElement[] = [];
    private readonly itemBound: BoundField<PropertyScalar | undefined>[] = [];
    private addInput: HTMLInputElement | null = null;
    private addBound: BoundField<PropertyScalar | undefined> | null = null;
    private readonly suggests: ValueSuggest[] = [];
    /** The issue each input says now, by its source: an item's place, or the add field. */
    private readonly sources = new Set<string>();
    /**
     * Where the focus went when it last left one of the list's inputs. A
     * blur commits before the focus lands, so its write finds the focus
     * here and not on the document.
     */
    private leftFor: Element | null = null;

    constructor(parent: HTMLElement, private readonly opts: PropertyListFieldOptions) {
        this.el = parent.createDiv({ cls: 'task-hub__list tv-form__control' });
        // Heard in the capture phase, before the input's own blur commits.
        this.el.addEventListener('blur', (e: FocusEvent) => {
            this.leftFor = e.relatedTarget instanceof Element ? e.relatedTarget : null;
        }, true);
        if (opts.own) this.renderOwn();
        else this.renderInherited();
    }

    private renderInherited(): void {
        const chips = this.el.createDiv({ cls: 'tv-ctrl__pills task-hub__list-chips' });
        for (const item of this.opts.items) {
            chips.createSpan({ cls: 'tv-ctrl__pill task-hub__list-chip task-hub__list-chip--cascade', text: item.spelling });
        }
    }

    private renderOwn(): void {
        const { items, disabled } = this.opts;
        const listEl = this.el.createDiv({ cls: 'task-hub__list-items' });
        items.forEach((item, index) => {
            const itemEl = listEl.createDiv({ cls: 'task-hub__list-item' });
            itemEl.dataset.index = String(index);

            const handle = itemEl.createSpan({ cls: 'task-hub__list-handle' });
            setIcon(handle, 'grip-vertical');
            handle.setAttribute('aria-label', t('modal.hub.moveItem'));
            if (!disabled) this.dragBy(handle, itemEl, listEl);

            const input = itemEl.createEl('input', {
                type: 'text',
                cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
            });
            input.value = item.spelling;
            input.disabled = disabled;
            this.itemInputs.push(input);
            const suggest = this.offer(input, (value) => {
                input.value = value;
                bound.commit();
            });
            const source = `${this.opts.at}:${index}`;
            const bound = bindField(input, {
                codec: ITEM,
                current: () => item,
                // An item emptied is taken out; one typed is put in its place.
                commit: (value) => {
                    if (value === undefined) this.writeKept(...removed(this.opts.items, index));
                    else this.writeKept(this.opts.items.map((x, i) => (i === index ? value : x)), places(this.opts.items));
                },
                issues: (issue) => this.sayOf(source, input, issue),
                takesEnter: () => suggest.listShown,
            });
            this.itemBound.push(bound);
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                const to = index + (e.key === 'ArrowUp' ? -1 : 1);
                if (to < 0 || to >= this.opts.items.length) return;
                e.preventDefault();
                this.writeKept(moved(this.opts.items, index, to), moved(places(this.opts.items), index, to));
            });

            const removeBtn = itemEl.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove' });
            setIcon(removeBtn.createSpan(), 'x');
            removeBtn.setAttribute('aria-label', t('modal.hub.removeItem', { item: item.spelling }));
            removeBtn.disabled = disabled;
            removeBtn.addEventListener('click', () => {
                this.writeKept(...removed(this.opts.items, index));
            });
        });

        // The add field stands where an item's text does: a handle's room before it, a ×'s after.
        const addEl = this.el.createDiv({ cls: 'task-hub__list-item task-hub__list-item--add' });
        setIcon(addEl.createSpan({ cls: 'task-hub__list-handle is-placeholder' }), 'grip-vertical');
        const add = addEl.createEl('input', {
            type: 'text',
            placeholder: t('modal.hub.addItem'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow task-hub__list-add',
        });
        setIcon(addEl.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove is-placeholder', attr: { tabindex: '-1', 'aria-hidden': 'true' } }).createSpan(), 'x');
        add.disabled = disabled;
        this.addInput = add;
        const suggest = this.offer(add, (value) => {
            add.value = value;
            this.addBound?.commit();
        });
        const source = `${this.opts.at}:add`;
        // The field stands for no item: what it reads is put at the end, and it empties.
        this.addBound = bindField(add, {
            codec: ITEM,
            current: () => undefined,
            commit: (value) => {
                if (value === undefined) return;
                this.writeKept([...this.opts.items, value], places(this.opts.items));
            },
            issues: (issue) => this.sayOf(source, add, issue),
            takesEnter: () => suggest.listShown,
        });
    }

    /** A list of the values offered under `input`, those the list holds left out. */
    private offer(input: HTMLInputElement, pick: (value: string) => void): ValueSuggest {
        const suggest = new ValueSuggest(this.opts.app, input, {
            candidates: (query) => {
                const q = query.trim().toLowerCase();
                const held = new Set(this.opts.items.map(item => item.spelling));
                return this.opts.candidates().filter(v => !held.has(v) && (!q || v.toLowerCase().includes(q)));
            },
            pick,
        });
        this.suggests.push(suggest);
        return suggest;
    }

    /**
     * Drag the item by its handle to another place among the items: the place
     * it would go is marked as the pointer moves (a line above or below an
     * item), and the order it is let go in is written. Moves and the release
     * are heard on the document, so the item may be dragged past the list,
     * and nothing is moved in the DOM until the write builds the rows anew.
     */
    private dragBy(handle: HTMLElement, itemEl: HTMLElement, listEl: HTMLElement): void {
        handle.addEventListener('pointerdown', (down: PointerEvent) => {
            if (down.button !== 0) return;
            down.preventDefault();
            const doc = handle.ownerDocument;
            const from = Number(itemEl.dataset.index);
            const rows = Array.from(listEl.children) as HTMLElement[];
            let to = from;
            const mark = () => {
                rows.forEach((row, i) => {
                    row.toggleClass('is-drop-before', to !== from && i === to && to < from);
                    row.toggleClass('is-drop-after', to !== from && i === to && to > from);
                });
            };
            itemEl.addClass('is-dragging');
            const move = (e: PointerEvent) => {
                // The item goes before the first item whose middle is below the pointer, or last.
                const before = rows.findIndex(row => {
                    const rect = row.getBoundingClientRect();
                    return e.clientY < rect.top + rect.height / 2;
                });
                to = before === -1 ? rows.length - 1 : before > from ? before - 1 : before;
                mark();
            };
            const up = () => {
                doc.removeEventListener('pointermove', move);
                doc.removeEventListener('pointerup', up);
                doc.removeEventListener('pointercancel', up);
                itemEl.removeClass('is-dragging');
                const target = to;
                to = from;
                mark();
                if (target !== from) this.writeKept(moved(this.opts.items, from, target), moved(places(this.opts.items), from, target));
            };
            doc.addEventListener('pointermove', move);
            doc.addEventListener('pointerup', up);
            doc.addEventListener('pointercancel', up);
        });
    }

    /**
     * Write `items` with the focus kept where it is (or is going, while an
     * input blurs). `order` names, for each place in `items`, the place the
     * item had; an item that is not there any more leaves the focus it held
     * to the add field.
     */
    private writeKept(items: PropertyScalar[], order: readonly number[]): void {
        const doc = this.el.ownerDocument;
        const active = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : this.leftFor;
        let focus: ListFocus | undefined;
        if (active && active === this.addInput) focus = 'add';
        else {
            const from = this.itemInputs.findIndex(input => input === active);
            if (from !== -1) {
                const to = order.indexOf(from);
                focus = to === -1 ? 'add' : to;
            }
        }
        this.opts.write(items, focus);
    }

    private sayOf(source: string, input: HTMLInputElement, issue: Issue | null): void {
        input.toggleClass('tv-ctrl__text-input--invalid', issue !== null);
        if (issue) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
        this.sources.add(source);
        this.opts.say(source, readIssue(this.opts.at, issue));
    }

    /** The input to focus: an item's by its place, or the add field; null when there is none. */
    focusTarget(focus: ListFocus): HTMLInputElement | null {
        return focus === 'add' ? this.addInput : this.itemInputs[focus] ?? this.addInput;
    }

    /** The inputs whose text a close cannot save: an item, or an item to add, that does not read. */
    unsaved(): UnsavedField[] {
        const inputs = [...this.itemInputs, ...(this.addInput ? [this.addInput] : [])];
        const bound = [...this.itemBound, ...(this.addBound ? [this.addBound] : [])];
        return inputs
            .filter((_, i) => bound[i].pending()?.ok === false)
            .map(input => ({ label: this.opts.key, input }));
    }

    discardUnsaved(): void {
        for (const bound of [...this.itemBound, ...(this.addBound ? [this.addBound] : [])]) {
            if (bound.pending()?.ok === false) bound.discard();
        }
    }

    /**
     * Save what is typed and reads, as blurs would, in one write: each item
     * typed over in its place (taken out when emptied), and an item to add
     * at the end.
     */
    save(): void {
        let changed = false;
        const next: (PropertyScalar | undefined)[] = [...this.opts.items];
        this.itemBound.forEach((bound, i) => {
            const read = bound.pending();
            if (!read?.ok) return;
            next[i] = read.value;
            changed = true;
        });
        const added = this.addBound?.pending();
        if (added?.ok && added.value !== undefined) {
            next.push(added.value);
            changed = true;
        }
        if (changed) this.opts.write(next.filter((item): item is PropertyScalar => item !== undefined));
    }

    /** Close the lists under its inputs and take back what it said: the rows are being built anew. */
    dispose(): void {
        for (const suggest of this.suggests) suggest.close();
        for (const source of this.sources) this.opts.say(source, []);
    }
}

/** The places of `items`, in their order. */
function places(items: readonly unknown[]): number[] {
    return items.map((_, i) => i);
}

/** `items` with the item at `at` taken out, and the places the rest had. */
function removed<T>(items: readonly T[], at: number): [T[], number[]] {
    const keep = (_: unknown, i: number) => i !== at;
    return [items.filter(keep), places(items).filter(keep)];
}

/** `items` with the item at `from` moved to `to`. */
function moved<T>(items: readonly T[], from: number, to: number): T[] {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}
