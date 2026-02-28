import { App, setIcon } from 'obsidian';
import type { TaskViewerSettings } from '../types';
import { PropertyColorSuggest } from './color/PropertyColorSuggest';
import { PropertyLineStyleSuggest } from './line/PropertyLineStyleSuggest';

/**
 * Observes the Properties View in the editor and attaches
 * color/linestyle suggest components + color picker icon to matching frontmatter fields.
 */
export class PropertySuggestObserver {
    private propertiesObserver: MutationObserver | null = null;
    private attachedInputs: WeakSet<HTMLElement> = new WeakSet();

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
    }

    private attachPropertySuggests(): void {
        const settings = this.getSettings();
        const colorKey = settings.frontmatterTaskKeys.color;
        const linestyleKey = settings.frontmatterTaskKeys.linestyle;

        const keyInputs = document.querySelectorAll('.metadata-property-key-input');

        keyInputs.forEach((keyInput) => {
            const input = keyInput as HTMLInputElement;
            const isColorKey = input.value === colorKey;
            const isLineStyleKey = input.value === linestyleKey;
            if (!isColorKey && !isLineStyleKey) {
                return;
            }

            const propertyContainer = input.closest('.metadata-property');
            if (!propertyContainer) {
                return;
            }

            const valueDiv = propertyContainer.querySelector('.metadata-input-longtext[contenteditable="true"]') as HTMLDivElement;
            if (!valueDiv || this.attachedInputs.has(valueDiv)) {
                return;
            }

            if (isColorKey) {
                new PropertyColorSuggest(this.app, valueDiv, this.suggestHost);
                this.addColorPickerIcon(propertyContainer as HTMLElement, valueDiv);
            } else {
                new PropertyLineStyleSuggest(this.app, valueDiv, this.suggestHost);
            }

            this.attachedInputs.add(valueDiv);
        });
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
