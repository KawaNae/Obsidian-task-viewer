/**
 * TaskNameSuggest - AbstractInputSuggest for task name input.
 * Provides [[wikilink]], [[file#heading]], and #tag suggestions on a plain <input>.
 * What to suggest, over which range and what a pick writes is
 * LinkTagCandidates'; how a candidate is drawn is candidateView's; this
 * shows them. A link is written as Obsidian writes it from the note the
 * task is or goes in, which the field's owner names (`linkSource`).
 * It says whether its list is open (`ShownSuggest`): an Enter then picks
 * from the list, and the form the field is in does not take it.
 */

import type { App } from 'obsidian';
import { ShownSuggest } from './ShownSuggest';
import { t } from '../i18n';
import { renderLinkTag } from './candidateView';
import { NOTE_CANDIDATE_LIMIT } from './NoteCandidates';
import {
    linkTagCandidates, linkTagTrigger, linkTagWrite, replacedRange,
    type LinkTagCandidate, type LinkTagMode,
} from './LinkTagCandidates';

export class TaskNameSuggest extends ShownSuggest<LinkTagCandidate> {
    private inputEl: HTMLInputElement;
    private currentMode: LinkTagMode | null = null;

    /** `linkSource`: the path of the note a link typed here is written in, asked when it is needed. */
    constructor(app: App, inputEl: HTMLInputElement, private readonly linkSource: () => string) {
        super(app, inputEl);
        this.inputEl = inputEl;
        this.limit = NOTE_CANDIDATE_LIMIT;
    }

    protected getSuggestions(query: string): LinkTagCandidate[] {
        const pos = this.inputEl.selectionStart ?? query.length;
        const found = linkTagCandidates(this.app, query.substring(0, pos), this.linkSource());
        this.currentMode = found?.mode ?? null;
        return found?.candidates ?? [];
    }

    renderSuggestion(item: LinkTagCandidate, el: HTMLElement): void {
        renderLinkTag(el, item);
    }

    protected pick(item: LinkTagCandidate, evt: MouseEvent | KeyboardEvent): void {
        const value = this.inputEl.value;
        const pos = this.inputEl.selectionStart ?? value.length;
        const trigger = linkTagTrigger(value.substring(0, pos));
        if (!trigger) return;
        const replacement = linkTagWrite(this.app, item, this.linkSource());
        // A link is written whole; the closers pairing left after the caret
        // are taken over (LinkTagCandidates.replacedRange).
        const { from, to } = replacedRange(value, pos, trigger.start);
        const newValue = value.substring(0, from) + replacement + value.substring(to);
        this.setValue(newValue);

        const newPos = from + replacement.length;
        this.inputEl.setSelectionRange(newPos, newPos);
        this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));

        this.close();
    }

    /** Position popup at trigger and inject hint footer */
    open(): void {
        super.open();
        this.repositionAtTrigger();
        this.addHintFooter();
    }

    private addHintFooter(): void {
        // @ts-ignore - suggestEl is the popup container (internal but stable)
        const container: HTMLElement | undefined = this.suggestEl;
        if (!container) return;

        // Remove existing footer
        container.querySelector('.task-name-suggest__footer')?.remove();

        const hints = this.getHintText();
        if (!hints) return;

        const footer = container.createDiv({ cls: 'task-name-suggest__footer' });
        footer.setText(hints);
    }

    /**
     * Reposition the suggest popup so its left edge aligns with the trigger character
     * position ([[  or #) inside the input. Uses a temporary mirror span to measure
     * the pixel offset of the trigger within the input text.
     */
    private repositionAtTrigger(): void {
        // @ts-ignore - suggestEl is the popup container
        const popup: HTMLElement | undefined = this.suggestEl;
        if (!popup) return;

        const value = this.inputEl.value;
        const pos = this.inputEl.selectionStart ?? value.length;
        const trigger = linkTagTrigger(value.substring(0, pos));
        if (!trigger) return;
        const triggerIdx = trigger.start;

        // Measure pixel offset of triggerIdx within the input using a mirror span
        // In the input's own document: the field may stand in a popout window.
        const doc = this.inputEl.ownerDocument;
        const textBefore = value.substring(0, triggerIdx);
        const mirror = doc.createElement('span');
        const style = (doc.defaultView ?? window).getComputedStyle(this.inputEl);
        mirror.style.font = style.font;
        mirror.style.letterSpacing = style.letterSpacing;
        mirror.style.visibility = 'hidden';
        mirror.style.position = 'absolute';
        mirror.style.whiteSpace = 'pre';
        mirror.textContent = textBefore;
        doc.body.appendChild(mirror);
        const textWidth = mirror.offsetWidth;
        doc.body.removeChild(mirror);

        // Calculate left position relative to input
        const inputRect = this.inputEl.getBoundingClientRect();
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const scrollLeft = this.inputEl.scrollLeft;
        const triggerX = inputRect.left + paddingLeft + textWidth - scrollLeft;

        popup.style.left = `${triggerX}px`;
    }

    private getHintText(): string | null {
        switch (this.currentMode) {
            case 'file':
                return t('modal.taskNameHint.file');
            case 'heading':
                return t('modal.taskNameHint.heading');
            default:
                return null;
        }
    }
}
