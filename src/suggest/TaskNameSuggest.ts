/**
 * TaskNameSuggest - AbstractInputSuggest for task name input.
 * Provides [[wikilink]], [[file#heading]], and #tag suggestions on a plain <input>.
 */

import { App, AbstractInputSuggest } from 'obsidian';

interface SuggestionItem {
    label: string;
    replacement: string;
    detail?: string;
    folder?: string;
}

type SuggestMode = 'file' | 'heading' | 'tag';

export class TaskNameSuggest extends AbstractInputSuggest<SuggestionItem> {
    private inputEl: HTMLInputElement;
    private currentMode: SuggestMode | null = null;

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.inputEl = inputEl;
        this.limit = 30;
    }

    protected getSuggestions(query: string): SuggestionItem[] {
        const pos = this.inputEl.selectionStart ?? query.length;
        const before = query.substring(0, pos);

        // --- [[wikilink]] / [[file#heading]] ---
        const wikiIdx = before.lastIndexOf('[[');
        if (wikiIdx !== -1) {
            const afterBrackets = before.substring(wikiIdx + 2);
            if (!afterBrackets.includes(']]')) {
                return this.getWikiLinkSuggestions(afterBrackets);
            }
        }

        // --- #tag ---
        const hashIdx = before.lastIndexOf('#');
        if (hashIdx !== -1) {
            if (hashIdx === 0 || /\s/.test(before[hashIdx - 1])) {
                const lastOpen = before.lastIndexOf('[[');
                const lastClose = before.lastIndexOf(']]');
                if (lastOpen === -1 || lastClose > lastOpen) {
                    const tagQuery = before.substring(hashIdx + 1).toLowerCase();
                    return this.getTagSuggestions(tagQuery);
                }
            }
        }

        this.currentMode = null;
        return [];
    }

    private getWikiLinkSuggestions(after: string): SuggestionItem[] {
        const hashPos = after.indexOf('#');

        if (hashPos !== -1) {
            // Heading mode: [[filename#query
            this.currentMode = 'heading';
            const fileQuery = after.substring(0, hashPos);
            const headingQuery = after.substring(hashPos + 1).toLowerCase();

            const file = this.app.metadataCache.getFirstLinkpathDest(fileQuery, '');
            if (!file) return [];

            const cache = this.app.metadataCache.getFileCache(file);
            const headings = cache?.headings ?? [];
            return headings
                .filter(h => headingQuery === '' || h.heading.toLowerCase().includes(headingQuery))
                .sort((a, b) => {
                    const aP = a.heading.toLowerCase().startsWith(headingQuery) ? 0 : 1;
                    const bP = b.heading.toLowerCase().startsWith(headingQuery) ? 0 : 1;
                    if (aP !== bP) return aP - bP;
                    return a.position.start.line - b.position.start.line;
                })
                .slice(0, 30)
                .map(h => ({
                    label: h.heading,
                    replacement: `[[${file.basename}#${h.heading}]]`,
                    detail: 'H' + h.level,
                }));
        }

        // File mode: [[query
        this.currentMode = 'file';
        const query = after.toLowerCase();
        return this.app.vault.getMarkdownFiles()
            .filter(f => query === '' || f.basename.toLowerCase().includes(query))
            .sort((a, b) => {
                const aP = a.basename.toLowerCase().startsWith(query) ? 0 : 1;
                const bP = b.basename.toLowerCase().startsWith(query) ? 0 : 1;
                if (aP !== bP) return aP - bP;
                return a.basename.localeCompare(b.basename);
            })
            .slice(0, 30)
            .map(f => ({
                label: f.basename,
                replacement: `[[${f.basename}]]`,
                folder: f.parent?.path || undefined,
            }));
    }

    private getTagSuggestions(query: string): SuggestionItem[] {
        this.currentMode = 'tag';
        // @ts-ignore - getTags() is not in the public API typings
        const tagMap: Record<string, number> = this.app.metadataCache.getTags?.() ?? {};
        return Object.keys(tagMap)
            .map(t => t.startsWith('#') ? t.substring(1) : t)
            .filter(t => query === '' || t.toLowerCase().includes(query))
            .sort((a, b) => {
                const aP = a.toLowerCase().startsWith(query) ? 0 : 1;
                const bP = b.toLowerCase().startsWith(query) ? 0 : 1;
                if (aP !== bP) return aP - bP;
                return a.localeCompare(b);
            })
            .slice(0, 30)
            .map(t => ({
                label: t,
                replacement: `#${t}`,
            }));
    }

    renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
        const titleEl = el.createDiv({ cls: 'suggestion-title' });
        titleEl.createSpan({ text: item.label });
        if (item.detail) {
            titleEl.createSpan({ text: `  ${item.detail}`, cls: 'suggestion-flair' });
        }
        if (item.folder) {
            el.createDiv({ text: item.folder, cls: 'suggestion-note' });
        }
    }

    selectSuggestion(item: SuggestionItem, evt: MouseEvent | KeyboardEvent): void {
        const value = this.inputEl.value;
        const pos = this.inputEl.selectionStart ?? value.length;
        const before = value.substring(0, pos);
        let afterCursor = value.substring(pos);

        // Find the trigger start position
        let triggerStart: number;
        if (item.replacement.startsWith('[[')) {
            triggerStart = before.lastIndexOf('[[');
            // Consume auto-paired ]] after cursor if present
            if (afterCursor.startsWith(']]')) {
                afterCursor = afterCursor.substring(2);
            }
        } else {
            triggerStart = before.lastIndexOf('#');
        }

        const newValue = value.substring(0, triggerStart) + item.replacement + afterCursor;
        this.setValue(newValue);

        const newPos = triggerStart + item.replacement.length;
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
        const before = value.substring(0, pos);

        // Determine trigger start index
        let triggerIdx: number;
        const wikiIdx = before.lastIndexOf('[[');
        if (wikiIdx !== -1 && !before.substring(wikiIdx + 2).includes(']]')) {
            triggerIdx = wikiIdx;
        } else {
            const hashIdx = before.lastIndexOf('#');
            if (hashIdx !== -1 && (hashIdx === 0 || /\s/.test(before[hashIdx - 1]))) {
                triggerIdx = hashIdx;
            } else {
                return;
            }
        }

        // Measure pixel offset of triggerIdx within the input using a mirror span
        const textBefore = value.substring(0, triggerIdx);
        const mirror = document.createElement('span');
        const style = getComputedStyle(this.inputEl);
        mirror.style.font = style.font;
        mirror.style.letterSpacing = style.letterSpacing;
        mirror.style.visibility = 'hidden';
        mirror.style.position = 'absolute';
        mirror.style.whiteSpace = 'pre';
        mirror.textContent = textBefore;
        document.body.appendChild(mirror);
        const textWidth = mirror.offsetWidth;
        document.body.removeChild(mirror);

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
                return '#を入力すると 見出しにリンクできます　^を入力すると ブロックにリンクできます';
            case 'heading':
                return '↵ で確定';
            default:
                return null;
        }
    }
}
