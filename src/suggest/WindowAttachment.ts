import { type App, setIcon, type Plugin } from 'obsidian';
import type { TaskViewerSettings } from '../types';
import type { EventRegistrar, PluginContext } from '../PluginContext';
import { PropertyColorSuggest } from './color/PropertyColorSuggest';
import { PropertyLineStyleSuggest } from './line/PropertyLineStyleSuggest';
import { normalizeColor, cssColorToHex } from '../utils/ColorUtils';

export interface AttachmentContext {
    app: App;
    getSettings: () => TaskViewerSettings;
    suggestHost: PluginContext & EventRegistrar;
    // moveLeafToPopout で valueDiv が window 間を移動しても多重 attach を防ぐため、
    // attach 済み要素は全 WindowAttachment で共有する。
    attachedInputs: WeakSet<HTMLElement>;
}

/**
 * 1 つの Window (メインまたはポップアウト) に対する Properties View サジェスト attach の状態。
 * MutationObserver / ネイティブ抑制 style を window スコープで保持する。
 * attach 済み要素の追跡 (attachedInputs) は ctx 経由で共有。
 */
/**
 * 色ピッカーの `input` は掴んで動かしている間ずっと流れてくる。書き込みを 1 手
 * ごとに出すとファイルへの往復がその回数だけ起きるので、末尾だけを書く。
 * ピッカーを閉じた時点（`change`）と attach の破棄時に取りこぼしを流し切る。
 */
const COLOR_WRITE_DEBOUNCE_MS = 300;

export class WindowAttachment {
    private observer: MutationObserver | null = null;
    private nativeSuggestStyles: Map<string, HTMLStyleElement> = new Map();
    private colorWriteTimer: number | null = null;
    private pendingColorWrite: (() => Promise<void>) | null = null;

    constructor(
        private win: Window,
        private doc: Document,
        private ctx: AttachmentContext
    ) {}

    attach(): void {
        const MutationObserverCtor = (this.win as Window & typeof globalThis).MutationObserver;
        this.observer = new MutationObserverCtor(() => this.syncAttach());
        // characterData: contenteditable の文字編集も拾い、colorInput の不変条件を維持する。
        this.observer.observe(this.doc.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        this.syncAttach();
    }

    dispose(): void {
        void this.flushColorWrite();
        this.observer?.disconnect();
        this.observer = null;
        for (const style of this.nativeSuggestStyles.values()) {
            style.remove();
        }
        this.nativeSuggestStyles.clear();
    }

    /** 最後の色だけを書くよう予約し直す（前の予約は破棄する）。 */
    private queueColorWrite(write: () => Promise<void>): void {
        this.pendingColorWrite = write;
        if (this.colorWriteTimer !== null) this.win.clearTimeout(this.colorWriteTimer);
        this.colorWriteTimer = this.win.setTimeout(() => {
            this.colorWriteTimer = null;
            void this.flushColorWrite();
        }, COLOR_WRITE_DEBOUNCE_MS);
    }

    /** 予約が残っていれば今すぐ書く。予約が無ければ何もしない。 */
    private async flushColorWrite(): Promise<void> {
        if (this.colorWriteTimer !== null) {
            this.win.clearTimeout(this.colorWriteTimer);
            this.colorWriteTimer = null;
        }
        const write = this.pendingColorWrite;
        this.pendingColorWrite = null;
        if (write) await write();
    }

    private syncAttach(): void {
        const settings = this.ctx.getSettings();
        const colorKey = settings.tvFileKeys.color;
        const linestyleKey = settings.tvFileKeys.linestyle;

        if (!settings.suggestColor) this.restoreNativePropertySuggest(colorKey);
        if (!settings.suggestLinestyle) this.restoreNativePropertySuggest(linestyleKey);

        const keyInputs = this.doc.querySelectorAll('.metadata-property-key-input');

        keyInputs.forEach((keyInput) => {
            const input = keyInput as HTMLInputElement;
            const isColorKey = input.value === colorKey;
            const isLineStyleKey = input.value === linestyleKey;
            if (!isColorKey && !isLineStyleKey) return;

            const propertyContainer = input.closest('.metadata-property');
            if (!propertyContainer) return;

            const valueDiv = propertyContainer.querySelector(
                '.metadata-input-longtext[contenteditable="true"]'
            ) as HTMLDivElement | null;
            if (!valueDiv) return;

            if (isColorKey && settings.suggestColor) {
                if (!this.ctx.attachedInputs.has(valueDiv)) {
                    new PropertyColorSuggest(this.ctx.app, valueDiv, this.ctx.suggestHost);
                    this.addColorPickerIcon(propertyContainer as HTMLElement);
                    this.suppressNativePropertySuggest(colorKey);
                    this.ctx.attachedInputs.add(valueDiv);
                }
                // valueDiv は Obsidian の再描画で別要素に置き換わりうる。
                // closure に閉じ込めず毎 sync で fresh な textContent を反映する。
                this.syncColorInputValue(propertyContainer as HTMLElement, valueDiv);
            } else if (isLineStyleKey && settings.suggestLinestyle) {
                if (this.ctx.attachedInputs.has(valueDiv)) return;
                new PropertyLineStyleSuggest(this.ctx.app, valueDiv, this.ctx.suggestHost);
                this.suppressNativePropertySuggest(linestyleKey);
                this.ctx.attachedInputs.add(valueDiv);
            }
        });
    }

    private syncColorInputValue(container: HTMLElement, valueDiv: HTMLDivElement): void {
        const colorInput = container.querySelector(
            '.task-viewer-color-picker-icon input[type="color"]'
        ) as HTMLInputElement | null;
        if (!colorInput) return;
        const next = cssColorToHex(valueDiv.textContent?.trim() ?? '', this.doc);
        if (colorInput.value !== next) colorInput.value = next;
    }

    private suppressNativePropertySuggest(propertyKey: string): void {
        if (this.nativeSuggestStyles.has(propertyKey)) return;
        // Obsidian の moveLeafToPopout がメイン head の style を popout に複製するため、
        // 既存マーカーを doc.head に対して走査し、重複注入を防ぐ。
        const selector = `style[data-tv-suppress="${propertyKey}"]`;
        const existing = this.doc.head.querySelector(selector) as HTMLStyleElement | null;
        if (existing) {
            this.nativeSuggestStyles.set(propertyKey, existing);
            return;
        }
        const style = this.doc.createElement('style');
        style.dataset.tvSuppress = propertyKey;
        style.textContent =
            `div.suggestion-container.mod-property-value[data-property-key="${propertyKey}"] { display: none !important; }`;
        this.doc.head.appendChild(style);
        this.nativeSuggestStyles.set(propertyKey, style);
    }

    private restoreNativePropertySuggest(propertyKey: string): void {
        const style = this.nativeSuggestStyles.get(propertyKey);
        if (!style) return;
        style.remove();
        // moveLeafToPopout で複製された他コピーも併せて除去する。
        const selector = `style[data-tv-suppress="${propertyKey}"]`;
        this.doc.head.querySelectorAll(selector).forEach((el) => el.remove());
        this.nativeSuggestStyles.delete(propertyKey);
    }

    private addColorPickerIcon(container: HTMLElement): void {
        if (container.querySelector('.task-viewer-color-picker-icon')) return;

        const iconBtn = container.createDiv({ cls: 'task-viewer-color-picker-icon clickable-icon' });
        iconBtn.setAttribute('aria-label', 'カラーピッカーを開く');
        iconBtn.style.position = 'relative';
        iconBtn.style.marginLeft = '4px';
        iconBtn.style.display = 'inline-flex';
        iconBtn.style.alignItems = 'center';
        iconBtn.style.cursor = 'pointer';
        setIcon(iconBtn, 'palette');

        const colorInput = this.doc.createElement('input');
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

        colorInput.addEventListener('input', () => {
            const activeFile = this.ctx.app.workspace.getActiveFile();
            if (!activeFile) return;

            const hex = normalizeColor(colorInput.value);
            const colorKey = this.ctx.getSettings().tvFileKeys.color;

            // 見た目は 1 手ごとに追随させ、ファイルへの書き込みだけ末尾に寄せる。
            // valueDiv は再描画で別要素に置き換わりうるので closure ではなく都度解決する。
            const currentValueDiv = container.querySelector(
                '.metadata-input-longtext'
            ) as HTMLDivElement | null;
            if (currentValueDiv) currentValueDiv.textContent = hex;

            this.queueColorWrite(() => this.ctx.suggestHost.getTaskWriteService()
                .setFrontmatterKeys(activeFile.path, { [colorKey]: hex }));
        });

        // ピッカーを閉じた時点で確定させる（debounce の満了を待たない）。
        colorInput.addEventListener('change', () => { void this.flushColorWrite(); });
    }
}
