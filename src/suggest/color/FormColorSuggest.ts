import { App, AbstractInputSuggest } from 'obsidian';
import { filterColors, renderColorSuggestion } from './colorUtils';

/**
 * フォーム入力用の CSS 色名サジェスト。
 * PropertyColorSuggest（Properties View 用、frontmatter 直書き）と違い、
 * 値の反映は input.value + onSelect callback に留める — 書き込み先を
 * 呼び出し側（フォームのコミット機構）が所有するため。
 */
export class FormColorSuggest extends AbstractInputSuggest<string> {
    constructor(
        app: App,
        private textInput: HTMLInputElement,
        private onPick: (value: string) => void,
    ) {
        super(app, textInput);
    }

    protected getSuggestions(query: string): string[] {
        if (query.trim() === '') return filterColors('', 20);
        return filterColors(query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        renderColorSuggestion(value, el);
    }

    selectSuggestion(value: string): void {
        this.textInput.value = value;
        this.onPick(value);
        this.close();
    }
}
