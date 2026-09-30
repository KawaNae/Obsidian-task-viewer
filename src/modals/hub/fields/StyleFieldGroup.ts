import { t } from '../../../i18n';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { filterColors, renderColorSuggestion } from '../../../suggest/color/colorUtils';
import { filterLineStyles, renderLineStyleSuggestion } from '../../../suggest/line/lineStyleUtils';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { createFormRow } from '../../form/formRow';
import { PickerTextField } from '../../form/PickerTextField';
import { PROPERTY_ICONS } from '../../../constants/propertyIcons';
import type { FieldGroupContext } from './FieldGroupContext';

type StyleField = 'color' | 'linestyle' | 'mask';

/**
 * color / linestyle / mask の 3 フィールド。color は native picker + swatch +
 * suggest が絡み合っているため 3 分割せず 1 グループにまとめている。
 */
export class StyleFieldGroup {
    private colorField!: PickerTextField;
    private colorInput!: HTMLInputElement;
    private colorSwatch!: HTMLElement;
    private nativeColorInput!: HTMLInputElement;
    private linestyleInput!: HTMLInputElement;
    private maskInput!: HTMLInputElement;
    private sourceEls: Partial<Record<StyleField, HTMLElement>> = {};

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        this.renderRow(container, 'color', 'modal.hub.color');
        this.renderRow(container, 'linestyle', 'modal.hub.linestyle');
        this.renderRow(container, 'mask', 'modal.hub.mask');
    }

    private inputFor(field: StyleField): HTMLInputElement {
        return field === 'color' ? this.colorInput : field === 'linestyle' ? this.linestyleInput : this.maskInput;
    }

    private renderRow(container: HTMLElement, field: StyleField, labelKey: string): void {
        const { row } = createFormRow(container, t(labelKey), { icon: PROPERTY_ICONS[field] });

        let input: HTMLInputElement;

        if (field === 'color') {
            // 日付/時刻の欄と同じ部品: 左端のピッカーのボタン + ネイティブの input + [色見本]テキスト
            this.colorField = new PickerTextField(row, {
                type: 'color',
                icon: 'palette',
                pickerLabel: t('modal.openColorPicker'),
                initialValue: '',
                clearable: false,
                cls: 'tv-form__input-with-picker--color tv-form__control',
            });
            this.nativeColorInput = this.colorField.picker;
            input = this.colorField.input;
            // 色見本はテキストの入力の中の左端に重ねる
            this.colorSwatch = this.colorField.el.createSpan({ cls: 'tv-ctrl__color-swatch task-hub__color-swatch' });
            this.colorField.el.insertBefore(this.colorSwatch, input);
        } else {
            input = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
        }
        input.value = this.ctx.getTask()[field] ?? '';

        const sourceEl = row.createSpan({ cls: 'task-hub__source' });
        sourceEl.addEventListener('click', () => this.ctx.jumpToFile());
        this.sourceEls[field] = sourceEl;

        const commit = () => this.commit(field);
        if (field === 'color') {
            this.colorInput = input;
            const nci = this.nativeColorInput;
            nci.value = this.resolveColorForPicker(input.value);
            // ドラッグ中は swatch とテキストだけ更新し、nci.value への
            // 書き戻し（updateColorSwatch 内）を避ける — 書き戻すと
            // ピッカーの内部状態が壊れるフィードバックループになる
            nci.addEventListener('input', () => {
                input.value = nci.value.replace(/^#/, '');
                if (this.colorSwatch) {
                    this.colorSwatch.style.backgroundColor = nci.value;
                }
            });
            nci.addEventListener('change', () => {
                this.updateColorSwatch();
                commit();
            });
            this.ctx.attachSuggest(input, input, {
                getCandidates: (q) => (q.trim() === '' ? filterColors('', 20) : filterColors(q)),
                renderItem: (item, val) => renderColorSuggestion(val, item),
                onPick: (val) => { input.value = val; this.updateColorSwatch(); commit(); },
            });
            input.addEventListener('input', () => this.updateColorSwatch());
        } else if (field === 'linestyle') {
            this.linestyleInput = input;
            this.ctx.attachSuggest(input, input, {
                getCandidates: (q) => filterLineStyles(q),
                renderItem: (item, val) => renderLineStyleSuggestion(val, item),
                onPick: (val) => { input.value = val; commit(); },
            });
        } else {
            this.maskInput = input;
        }

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) commit();
        });

        this.updateDecoration(field);
    }

    private commit(field: StyleField): void {
        if (this.ctx.isShut()) return;
        const input = this.inputFor(field);
        const value = input.value.trim();

        input.classList.remove('tv-ctrl__text-input--invalid');
        if (field === 'linestyle' && value && !VALID_LINE_STYLES.has(value.toLowerCase())) {
            input.classList.add('tv-ctrl__text-input--invalid');
            return;
        }

        this.ctx.queue(TaskUpdateBuilder.styleField(this.ctx.getTask(), field, value));
    }

    /** cascade placeholder + 出所ラベル + swatch の同期 */
    private updateDecoration(field: StyleField): void {
        const input = this.inputFor(field);
        const sourceEl = this.sourceEls[field];
        if (!input || !sourceEl) return;

        const task = this.ctx.getTask();
        const cascadeValue = task.cascadeContext?.[field];
        input.placeholder = (task[field] === undefined && cascadeValue) || '';

        const keys = this.ctx.plugin.settings.scopeKeys;
        const source = CascadeSource.forStyleField(this.ctx.app, task, keys, field);
        if (source) {
            sourceEl.setText(this.ctx.sourceLabel(source));
            sourceEl.style.display = '';
        } else {
            sourceEl.setText('');
            sourceEl.style.display = 'none';
        }

        if (field === 'color') this.updateColorSwatch();
    }

    private updateColorSwatch(): void {
        if (!this.colorSwatch) return;
        const value = this.colorInput.value.trim() || this.ctx.getTask().cascadeContext?.color || '';
        this.colorSwatch.style.backgroundColor = value
            ? (/^[0-9a-fA-F]{3,6}$/.test(value) ? `#${value}` : value)
            : 'transparent';
        this.nativeColorInput.value = this.resolveColorForPicker(value);
    }

    private resolveColorForPicker(raw: string): string {
        const v = raw.trim();
        if (!v) return '#000000';
        if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
        if (/^[0-9a-fA-F]{3}$/.test(v)) {
            return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
        }
        // CSS 色名 → canvas で正規化（'red' → '#ff0000'）
        const ctx = document.createElement('canvas').getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#000000';
            ctx.fillStyle = v;
            return ctx.fillStyle;
        }
        return '#000000';
    }

    /** 外部変更（echo）の取り込み。focus 中のフィールドは呼び出し側 setInputValue のガードで守られる。 */
    refresh(fresh: { color?: string; linestyle?: string; mask?: string }, setInputValue: (input: HTMLInputElement, value: string) => void): void {
        setInputValue(this.colorInput, fresh.color ?? '');
        setInputValue(this.linestyleInput, fresh.linestyle ?? '');
        setInputValue(this.maskInput, fresh.mask ?? '');
        this.updateDecoration('color');
        this.updateDecoration('linestyle');
        this.updateDecoration('mask');
    }

    setEnabled(enabled: boolean): void {
        this.colorField?.setEnabled(enabled);
        for (const input of [this.linestyleInput, this.maskInput]) {
            if (input) input.disabled = !enabled;
        }
    }

    focus(field: StyleField): void {
        this.inputFor(field)?.focus();
    }

    getInput(field: StyleField): HTMLInputElement {
        return this.inputFor(field);
    }
}
