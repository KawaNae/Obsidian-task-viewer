import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { DestinationAsk } from '../../services/data/NotePlaces';
import type { FieldFocus } from '../../utils/FieldFocus';
import { createFormRow } from '../form/formRow';
import type { IssueSlot } from '../form/FormIssue';
import { DestinationField } from './DestinationField';
import type { CandidateView, SendViewState } from './SendDialog';

/** What a {@link SendFields} opens with, and whom it tells. */
export interface SendFieldsOptions {
    /** The fields as they open: the note, and the heading. */
    initial: DestinationAsk;
    /** The classes of the destination's group besides `tv-form__group`. */
    groupClass: string;
    /** A field was typed in, or a note or a heading was picked: what they hold now. */
    onChange(ask: DestinationAsk): void;
    /** Enter in a field, when it is not picking from a list. */
    onEnter(): void;
    /** The user checked or unchecked the value `key` offered. */
    onCheck(key: string, checked: boolean): void;
}

/**
 * Where a send goes, as a form shows it: the destination's fields
 * (`DestinationField`) in a group of the form, and after it the values
 * offered to write into the note, under a section label for each place they
 * are written in (the frontmatter's keys, then the lines above the first
 * heading). It draws what the send's logic says of them (`SendViewState`:
 * the note's headings, the values offered and their checks) and holds
 * nothing of a send; what is said of a field goes under its row, where the
 * form that holds it puts it ({@link slot}). The hub moving a row holds
 * it, in the place of where the row stands (`RowPlace`).
 *
 * A section of the values offered is out of the form while it offers none,
 * put in and taken out rather than hidden: the last group in the form draws
 * no divider under it (`_form.css`), and a hidden group would still be one.
 */
export class SendFields {
    /** The destination's group, the first of the elements it puts in the form. */
    readonly group: HTMLElement;
    private readonly field: DestinationField;
    /** The values offered, a section for each place they are written in, in the order the note holds them. */
    private readonly candidateGroups: { to: CandidateView['to']; label: HTMLElement; el: HTMLElement }[] = [];

    /** Build the destination's group at the end of `parent`; the values offered go after it as they are drawn. */
    constructor(app: App, parent: HTMLElement, private readonly opts: SendFieldsOptions) {
        this.group = parent.createDiv({ cls: `tv-form__group ${opts.groupClass}` });
        this.field = new DestinationField(app, this.group, {
            initial: opts.initial,
            onChange: () => opts.onChange(this.field.ask()),
            onEnter: () => opts.onEnter(),
        });
        for (const [to, text] of [['frontmatter', t('modal.send.frontmatter')], ['root', t('modal.send.root')]] as const) {
            const label = parent.createEl('h4', { cls: 'tv-form__section-label', text });
            const el = parent.createDiv({ cls: `tv-form__group tv-send__candidates tv-send__candidates--${to}` });
            label.detach();
            el.detach();
            this.candidateGroups.push({ to, label, el });
        }
    }

    /** What the fields hold now. */
    ask(): DestinationAsk {
        return this.field.ask();
    }

    /** Where what is said of the note, or of the heading, goes. */
    slot(at: 'note' | 'heading'): IssueSlot {
        return this.field.slot(at);
    }

    /** The focus on the note field, or on the heading. */
    focus(at: 'note' | 'heading'): FieldFocus<HTMLElement> {
        return this.field.focus(at);
    }

    /** The destination's fields taking input or not. */
    setEnabled(enabled: boolean): void {
        this.field.setEnabled(enabled);
    }

    /** Draw the note's headings for the heading field to offer, and the values offered, as the send's state says. */
    render(state: Pick<SendViewState, 'headings' | 'candidates'>): void {
        this.field.offerHeadings(state.headings);
        let after: HTMLElement = this.group;
        for (const group of this.candidateGroups) {
            group.el.empty();
            group.label.detach();
            group.el.detach();
            const ones = state.candidates?.filter(one => one.to === group.to) ?? [];
            if (ones.length === 0) continue;
            after.after(group.label, group.el);
            after = group.el;
            for (const one of ones) this.renderCandidate(group.el, one);
        }
    }

    /** Take what it put in the form out of it. */
    remove(): void {
        for (const group of this.candidateGroups) {
            group.label.detach();
            group.el.detach();
        }
        this.group.detach();
    }

    /**
     * A value offered to write into the note, a form row, as the hub's
     * properties are: the key in the label's place, and the box, the value
     * and where it comes from in the control's.
     */
    private renderCandidate(groupEl: HTMLElement, one: CandidateView): void {
        const { row } = createFormRow(groupEl, one.key, { alignStart: true });
        const label = row.createEl('label', { cls: 'tv-send__candidate' });
        const box = label.createEl('input', { type: 'checkbox' });
        box.checked = one.checked;
        box.disabled = one.shut !== null;
        box.addEventListener('change', () => this.opts.onCheck(one.key, box.checked));
        label.createSpan({ cls: 'tv-send__value', text: one.value });
        label.createSpan({ cls: 'tv-send__from', text: one.from });
        if (one.shut) label.createSpan({ cls: 'tv-send__from', text: one.shut });
    }
}
