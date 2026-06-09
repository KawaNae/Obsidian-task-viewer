import type { PopoverStack } from '../sharedUI/PopoverStack';
import type { PopoverShell } from '../sharedUI/PopoverShell';

const ITEM_CLASS = 'filter-popover__tag-suggest-item';
const ACTIVE_CLASS = 'filter-popover__tag-suggest-item--active';

/**
 * filter-popover の suggest（候補ドロップダウン）共通機構。
 *
 * `renderSuggestInput`（単一値・自由入力）と `renderPillValueSelector`（複数値 Pill）
 * が同じ state 管理・ハイライト・PopoverStack 越しの開閉を別々に持っていたため、
 * その骨格をここへ一本化する。候補の取得・各 item の描画・確定時の挙動という
 * ビュー固有の差異だけを呼び出し側が `show()` のコールバックで注入する。
 *
 * PopoverShell / PopoverStack の上に立つ薄いコントローラで、DOM クラスは
 * filter-popover 専用（汎用化はしていない）。
 */
export class SuggestController {
    private shell: PopoverShell | null = null;
    private selectedIdx = -1;
    private items: { el: HTMLElement; value: string }[] = [];

    /**
     * @param stack            親 popover チェーン
     * @param inputWrap        アンカー（候補の幅基準・extraContains にも使う）
     * @param suggestClassName tag-suggest に追加するクラス（空可）
     * @param widthMode        'min' = minWidth、'exact' = width に inputWrap 幅を設定
     */
    constructor(
        private readonly stack: PopoverStack,
        private readonly inputWrap: HTMLElement,
        private readonly suggestClassName: string,
        private readonly widthMode: 'min' | 'exact',
    ) { }

    get isOpen(): boolean {
        return this.shell !== null;
    }

    /** ハイライト中の候補値。未選択なら null。 */
    get highlightedValue(): string | null {
        const sel = this.items[this.selectedIdx];
        return sel ? sel.value : null;
    }

    close(): void {
        if (this.shell) this.stack.close(this.shell);
        this.shell = null;
        this.items = [];
        this.selectedIdx = -1;
    }

    /** ハイライトを 1 つ進める/戻す（候補が無ければ無視、端で wrap）。 */
    moveHighlight(delta: 1 | -1): void {
        if (this.items.length === 0) return;
        if (delta > 0) {
            this.selectedIdx = (this.selectedIdx + 1) % this.items.length;
        } else {
            this.selectedIdx = this.selectedIdx <= 0 ? this.items.length - 1 : this.selectedIdx - 1;
        }
        this.updateHighlight();
    }

    private updateHighlight(): void {
        for (let i = 0; i < this.items.length; i++) {
            this.items[i].el.classList.toggle(ACTIVE_CLASS, i === this.selectedIdx);
        }
        const sel = this.items[this.selectedIdx];
        if (sel) sel.el.scrollIntoView({ block: 'nearest' });
    }

    /**
     * 候補リストでポップオーバーを開く（候補が空なら閉じる）。
     * @param values     表示する候補値
     * @param renderItem 各候補の中身を描画（テキスト/色見本/チェックボックス等）
     * @param onPick     候補がクリックされたとき
     */
    show(
        values: string[],
        renderItem: (itemEl: HTMLElement, value: string) => void,
        onPick: (value: string) => void,
    ): void {
        if (values.length === 0) {
            this.close();
            return;
        }

        const newItems: { el: HTMLElement; value: string }[] = [];
        this.shell = this.stack.openChild({
            anchor: { kind: 'element', element: this.inputWrap },
            className: `filter-popover__tag-suggest ${this.suggestClassName}`.trim(),
            extraContains: [this.inputWrap],
            build: (suggestEl) => {
                const w = `${this.inputWrap.getBoundingClientRect().width}px`;
                if (this.widthMode === 'min') suggestEl.style.minWidth = w;
                else suggestEl.style.width = w;
                for (const val of values) {
                    const item = suggestEl.createDiv(ITEM_CLASS);
                    renderItem(item, val);
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        onPick(val);
                    });
                    newItems.push({ el: item, value: val });
                }
            },
            onClose: () => {
                this.shell = null;
                this.items = [];
                this.selectedIdx = -1;
            },
        });
        this.items = newItems;
        this.selectedIdx = -1;
    }
}
