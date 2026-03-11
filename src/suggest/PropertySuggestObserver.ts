import { App, setIcon } from 'obsidian';
import type { TaskViewerSettings } from '../types';
import { PropertyColorSuggest } from './color/PropertyColorSuggest';
import { PropertyLineStyleSuggest } from './line/PropertyLineStyleSuggest';
import { PropertyTagSuggest } from './tags/PropertyTagSuggest';

/**
 * Observes the Properties View in the editor and attaches
 * color/linestyle suggest components + color picker icon to matching frontmatter fields.
 */
export class PropertySuggestObserver {
    private propertiesObserver: MutationObserver | null = null;
    private attachedInputs: WeakSet<HTMLElement> = new WeakSet();
    private nativeSuggestStyles: Map<string, HTMLStyleElement> = new Map();

    constructor(
        private app: App,
        private getSettings: () => TaskViewerSettings,
        private suggestHost: any // Plugin instance passed to PropertyColorSuggest
    ) {}

    start(): void {
        this.propertiesObserver = new MutationObserver(() => {
            this.attachPropertySuggests();
        });

        this.propertiesObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial scan
        this.attachPropertySuggests();
    }

    destroy(): void {
        if (this.propertiesObserver) {
            this.propertiesObserver.disconnect();
            this.propertiesObserver = null;
        }
        for (const style of this.nativeSuggestStyles.values()) {
            style.remove();
        }
        this.nativeSuggestStyles.clear();
    }

    private attachPropertySuggests(): void {
        const settings = this.getSettings();
        const colorKey = settings.frontmatterTaskKeys.color;
        const linestyleKey = settings.frontmatterTaskKeys.linestyle;
        const sharedtagsKey = settings.frontmatterTaskKeys.sharedtags;

        // ネイティブサジェスト抑制の同期（独自 OFF → 抑制解除）
        if (!settings.suggestColor) this.restoreNativePropertySuggest(colorKey);
        if (!settings.suggestLinestyle) this.restoreNativePropertySuggest(linestyleKey);
        if (!settings.suggestSharedtags) this.restoreNativePropertySuggest(sharedtagsKey);

        const keyInputs = document.querySelectorAll('.metadata-property-key-input');

        keyInputs.forEach((keyInput) => {
            const input = keyInput as HTMLInputElement;
            const isColorKey = input.value === colorKey;
            const isLineStyleKey = input.value === linestyleKey;
            const isSharedTagsKey = input.value === sharedtagsKey;
            if (!isColorKey && !isLineStyleKey && !isSharedTagsKey) {
                return;
            }

            const propertyContainer = input.closest('.metadata-property');
            if (!propertyContainer) {
                return;
            }

            if (isSharedTagsKey) {
                if (settings.suggestSharedtags) {
                    this.attachTagSuggests(propertyContainer as HTMLElement, sharedtagsKey);
                }
                return;
            }

            const valueDiv = propertyContainer.querySelector('.metadata-input-longtext[contenteditable="true"]') as HTMLDivElement;
            if (!valueDiv || this.attachedInputs.has(valueDiv)) {
                return;
            }

            if (isColorKey && settings.suggestColor) {
                new PropertyColorSuggest(this.app, valueDiv, this.suggestHost);
                this.addColorPickerIcon(propertyContainer as HTMLElement, valueDiv);
                this.suppressNativePropertySuggest(colorKey);
                this.attachedInputs.add(valueDiv);
            } else if (isLineStyleKey && settings.suggestLinestyle) {
                new PropertyLineStyleSuggest(this.app, valueDiv, this.suggestHost);
                this.suppressNativePropertySuggest(linestyleKey);
                this.attachedInputs.add(valueDiv);
            }
        });
    }

    /**
     * リスト型プロパティの各入力欄にタグサジェストをアタッチ。
     * MutationObserver により新規追加された項目にも対応。
     */
    private attachTagSuggests(container: HTMLElement, frontmatterKey: string): void {
        this.suppressNativePropertySuggest(frontmatterKey);

        // リスト型: 各項目の入力欄を探す（contenteditable div or input）
        const inputs = container.querySelectorAll(
            '.metadata-input-longtext[contenteditable="true"], .multi-select-input'
        );

        inputs.forEach((el) => {
            const inputEl = el as HTMLDivElement;
            if (this.attachedInputs.has(inputEl)) return;
            new PropertyTagSuggest(this.app, inputEl, this.suggestHost, frontmatterKey);
            this.attachedInputs.add(inputEl);
        });
    }

    /**
     * Obsidian ネイティブのプロパティ値サジェストを CSS で非表示にする。
     */
    private suppressNativePropertySuggest(propertyKey: string): void {
        if (this.nativeSuggestStyles.has(propertyKey)) return;
        const style = document.createElement('style');
        style.textContent =
            `div.suggestion-container.mod-property-value[data-property-key="${propertyKey}"] { display: none !important; }`;
        document.head.appendChild(style);
        this.nativeSuggestStyles.set(propertyKey, style);
    }

    /**
     * ネイティブサジェスト抑制を解除する。
     */
    private restoreNativePropertySuggest(propertyKey: string): void {
        const style = this.nativeSuggestStyles.get(propertyKey);
        if (!style) return;
        style.remove();
        this.nativeSuggestStyles.delete(propertyKey);
    }

    private addColorPickerIcon(container: HTMLElement, valueDiv: HTMLDivElement): void {
        if (container.querySelector('.task-viewer-color-picker-icon')) {
            return;
        }

        const iconBtn = container.createDiv({ cls: 'task-viewer-color-picker-icon clickable-icon' });
        iconBtn.setAttribute('aria-label', 'カラーピッカーを開く');
        iconBtn.style.position = 'relative';
        iconBtn.style.marginLeft = '4px';
        iconBtn.style.display = 'inline-flex';
        iconBtn.style.alignItems = 'center';
        iconBtn.style.cursor = 'pointer';
        setIcon(iconBtn, 'palette');

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.style.position = 'absolute';
        colorInput.style.top = '0';
        colorInput.style.left = '0';
        colorInput.style.width = '100%';
        colorInput.style.height = '100%';
        colorInput.style.opacity = '0';
        colorInput.style.cursor = 'pointer';
        iconBtn.appendChild(colorInput);

        const valueContainer = container.querySelector('.metadata-property-value');
        if (valueContainer) {
            valueContainer.after(iconBtn);
        }

        colorInput.addEventListener('input', async () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                return;
            }

            const settings = this.getSettings();
            const colorKey = settings.frontmatterTaskKeys.color;
            // @ts-ignore - processFrontMatter
            await this.app.fileManager.processFrontMatter(activeFile, (frontmatter: any) => {
                frontmatter[colorKey] = colorInput.value;
            });

            valueDiv.textContent = colorInput.value;
        });

        iconBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentValue = valueDiv.textContent?.trim() || '';

            let hexValue = currentValue;
            if (currentValue && !currentValue.startsWith('#')) {
                const tempEl = document.createElement('div');
                tempEl.style.color = currentValue;
                document.body.appendChild(tempEl);
                const computedColor = getComputedStyle(tempEl).color;
                document.body.removeChild(tempEl);

                const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (rgbMatch) {
                    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
                    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
                    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
                    hexValue = `#${r}${g}${b}`;
                }
            }

            colorInput.value = hexValue || '#000000';
        });
    }
}
