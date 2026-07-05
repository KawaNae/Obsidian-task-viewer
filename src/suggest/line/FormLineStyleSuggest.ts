import { App, AbstractInputSuggest } from 'obsidian';
import { filterLineStyles, renderLineStyleSuggestion } from './lineStyleUtils';

/**
 * フォーム入力用の linestyle サジェスト。
 * PropertyLineStyleSuggest（Properties View 用、frontmatter 直書き）と違い、
 * 値の反映は input.value + onSelect callback に留める。
 */
export class FormLineStyleSuggest extends AbstractInputSuggest<string> {
    constructor(
        app: App,
        private textInput: HTMLInputElement,
        private onPick: (value: string) => void,
    ) {
        super(app, textInput);
    }

    protected getSuggestions(query: string): string[] {
        return filterLineStyles(query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        renderLineStyleSuggestion(value, el);
    }

    selectSuggestion(value: string): void {
        this.textInput.value = value;
        this.onPick(value);
        this.close();
    }
}
