import { t } from '../../../i18n';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { COLOR_VALUES, LINE_STYLE_VALUES } from '../../../suggest/ScopeValues';
import { ChoiceInput } from '../../../utils/values/ChoiceValues';
import { ColorInput } from '../../../utils/values/ColorValues';
import { optional, type FieldCodec } from '../../../utils/values/Read';
import { TextInput } from '../../../utils/values/TextValues';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { createFormRow } from '../../form/formRow';
import { bindField, type BoundField, type Written } from '../../form/bindField';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { PickerTextField } from '../../form/PickerTextField';
import { FieldMenuButton, type FieldMenu } from '../../form/FieldMenuButton';
import { PROPERTY_ICONS } from '../../../constants/propertyIcons';
import { ValueSuggest } from '../../../suggest/ValueSuggest';
import { cssColorToHex } from '../../../utils/ColorUtils';
import type { ClosingPart, FieldGroupContext, UnsavedField } from './FieldGroupContext';
import { FieldLookView } from './FieldLookView';
import { FieldMenus } from './FieldMenus';
import { FieldKinds, FieldStates, type FieldAction, type FieldState, type StyleField } from './FieldState';

const FIELDS: readonly StyleField[] = ['color', 'linestyle', 'mask'];
const LABEL_KEYS: Record<StyleField, string> = { color: 'modal.hub.color', linestyle: 'modal.hub.linestyle', mask: 'modal.hub.mask' };

/**
 * How each field reads: a color (a hex value or a CSS name), one of the line
 * styles in any case, a mask as typed. Empty, each takes the row's own value
 * away, and the inherited one shows through.
 */
const CODECS: Record<StyleField, FieldCodec<string | undefined>> = {
    color: optional(ColorInput),
    linestyle: optional(ChoiceInput.of([...VALID_LINE_STYLES], { caseless: true })),
    mask: optional(TextInput),
};

/**
 * color / linestyle / mask の 3 フィールド。color は native picker + swatch +
 * suggest が絡み合っているため 3 分割せず 1 グループにまとめている。
 *
 * 各欄は `bindField` で値に結ぶ。読めない値（`zigzag` の線種、色でない色）は
 * 欄の下に理由を出して保存しない。欄の見た目（破線の枠、薄い字、隠した値の
 * 線）、… のメニューの項目、空にしたときの書き込みは、欄の状態の表
 * （`FieldStates`）が決め、ここはそれを描く。空にして確定すると、自分の行を
 * 消し、継承した値があればそれが出る。継承した値を隠すのも、継承した値を
 * 自分の値として書くのも、… のメニューである。所見で止まった欄には … を出さない。
 */
export class StyleFieldGroup implements ClosingPart {
    private colorField!: PickerTextField;
    private colorSwatch!: HTMLElement;
    private nativeColorInput!: HTMLInputElement;
    private readonly inputs = {} as Record<StyleField, HTMLInputElement>;
    private readonly bound = {} as Record<StyleField, BoundField<string | undefined>>;
    private readonly says = {} as Record<StyleField, HTMLElement>;
    private readonly looks = {} as Record<StyleField, FieldLookView>;
    private readonly menus = {} as Record<StyleField, FieldMenuButton>;

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        for (const field of FIELDS) this.renderRow(container, field, LABEL_KEYS[field]);
        this.showEnabled();
    }

    private renderRow(container: HTMLElement, field: StyleField, labelKey: string): void {
        const { row, says } = createFormRow(container, t(labelKey), { icon: PROPERTY_ICONS[field] });
        this.says[field] = says;

        let input: HTMLInputElement;
        /** The field's box: where its frame is drawn, and its … stands over the end of. */
        let box: HTMLElement;
        let put: ((text: string) => void) | undefined;

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
            box = this.colorField.el;
            // 色見本はテキストの入力の中の左端に重ねる
            this.colorSwatch = this.colorField.el.createSpan({ cls: 'tv-ctrl__color-swatch task-hub__color-swatch' });
            this.colorField.el.insertBefore(this.colorSwatch, input);
            put = (text) => {
                this.colorField.setText(text);
                this.updateColorSwatch();
            };
        } else {
            box = row.createDiv({ cls: 'tv-form__control' });
            input = box.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow' });
        }
        this.inputs[field] = input;
        input.value = this.ctx.task()[field] ?? '';
        this.looks[field] = new FieldLookView(box, input);
        this.menus[field] = new FieldMenuButton(box, {
            label: t('modal.hub.fieldMenu', { field: t(labelKey) }),
            key: `${field}:menu`,
            fields: () => [input],
            menu: () => this.menuOf(field),
            presenter: this.ctx.plugin.menuPresenter,
            disabled: () => this.ctx.isShut() || this.ctx.locked(field),
        });

        // An item picked from the list is put in and committed; the field's
        // own Enter (bindField) commits what is typed when no list is open.
        let suggest: ValueSuggest | null = null;
        if (field === 'color') {
            const nci = this.nativeColorInput;
            nci.value = cssColorToHex(input.value, nci.ownerDocument);
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
                this.bound.color.commit();
            });
            suggest = new ValueSuggest(this.ctx.app, input, {
                candidates: COLOR_VALUES.candidates,
                render: COLOR_VALUES.render,
                pick: (val) => { this.colorField.setText(val); this.updateColorSwatch(); this.bound.color.commit(); },
            });
            input.addEventListener('input', () => this.updateColorSwatch());
        } else if (field === 'linestyle') {
            suggest = new ValueSuggest(this.ctx.app, input, {
                candidates: LINE_STYLE_VALUES.candidates,
                render: LINE_STYLE_VALUES.render,
                pick: (val) => { input.value = val; this.bound.linestyle.commit(); },
            });
        }

        this.bound[field] = bindField(input, {
            codec: CODECS[field],
            // A row's own no value (`- tv-color::`) shows as no value of its own.
            current: () => this.ctx.task()[field] ?? undefined,
            commit: (value) => this.commit(field, value),
            issues: (issue) => this.ctx.issues.set(field, readIssue(field, issue)),
            takesEnter: () => suggest?.listShown ?? false,
            put,
        });

        this.restyle(field);
    }

    private commit(field: StyleField, value: string | undefined): Promise<Written> | void {
        if (this.ctx.isShut() || this.ctx.locked(field)) return;
        return this.ctx.put(TaskUpdateBuilder.styleField(this.ctx.task(), field, value ?? ''), field);
    }

    /** The field as the task is now: what its own line says, and what the layers above give it. */
    private stateOf(field: StyleField): FieldState<string> {
        return FieldStates.ofStyle(this.ctx.task(), field);
    }

    /** The field's menu as the task is now (`FieldStates.menu`); none for a field a finding locks. */
    private menuOf(field: StyleField): FieldMenu {
        if (this.ctx.locked(field)) return { heads: [], items: [] };
        const state = this.stateOf(field);
        const { source, items } = FieldStates.menu(state, FieldKinds.style, { opensSource: this.ctx.openSource !== null });
        return {
            heads: source ? [FieldMenus.head(source)] : [],
            items: items.map(action => FieldMenus.item(action, () => this.runMenu(field, action))),
        };
    }

    /** Do what the menu item `action` of the field does, to the task as it is now. */
    private runMenu(field: StyleField, action: FieldAction): void {
        if (this.ctx.isShut() || this.ctx.locked(field)) return;
        const task = this.ctx.task();
        switch (action.action) {
            case 'openSource':
                this.ctx.openSource?.(row => CascadeSource.lineOfField(row, field, this.ctx.plugin.settings.scopeKeys[field]));
                return;
            case 'dropOwn':
                void this.ctx.put(TaskUpdateBuilder.styleField(task, field, ''), field);
                break;
            case 'noValue':
                void this.ctx.put(TaskUpdateBuilder.styleHidden(task, field), field);
                break;
            case 'writeInherited': {
                const { inherited } = this.stateOf(field);
                if (inherited.kind === 'value') void this.ctx.put(TaskUpdateBuilder.styleField(task, field, inherited.value), field);
                break;
            }
        }
        this.refresh();
    }

    unsaved(): UnsavedField[] {
        return FIELDS.filter(field => this.bound[field].pending()?.ok === false)
            .map(field => ({ label: t(LABEL_KEYS[field]), input: this.inputs[field] }));
    }

    discardUnsaved(): void {
        for (const field of FIELDS) if (this.bound[field].pending()?.ok === false) this.bound[field].discard();
    }

    discardTyped(): void {
        for (const field of FIELDS) this.bound[field].discard();
    }

    save(): void {
        for (const field of FIELDS) if (this.bound[field].pending()?.ok) this.bound[field].commit();
    }

    /** The field's look and its … from its state now, and the color's swatch. */
    private restyle(field: StyleField): void {
        this.looks[field].show(FieldStates.look(this.stateOf(field), FieldKinds.style, value => value));
        this.menus[field].sync();
        if (field === 'color') this.updateColorSwatch();
    }

    private updateColorSwatch(): void {
        if (!this.colorSwatch) return;
        // What is typed; an empty field, what the task shows once it is
        // committed: the inherited color, as emptying takes the row's own
        // out, and none where the row says it has none, which the field
        // shows empty.
        const task = this.ctx.task();
        const value = this.inputs.color.value.trim() || (task.color === null ? '' : task.cascadeContext?.color) || '';
        this.colorSwatch.style.backgroundColor = value
            ? (/^[0-9a-fA-F]{3,6}$/.test(value) ? `#${value}` : value)
            : 'transparent';
        this.nativeColorInput.value = cssColorToHex(value, this.nativeColorInput.ownerDocument);
    }

    /** 外部変更（echo）の取り込み。打ちかけの欄は `BoundField.set` が守る。 */
    refresh(): void {
        const task = this.ctx.task();
        for (const field of FIELDS) {
            this.bound[field].set(task[field] ?? undefined);
            this.restyle(field);
        }
        this.showEnabled();
    }

    setEnabled(_enabled: boolean): void {
        this.showEnabled();
    }

    /** Each field takes edits unless the form is shut or a finding locks it (`FieldGroupContext.locked`). */
    private showEnabled(): void {
        const shut = this.ctx.isShut();
        this.colorField?.setEnabled(!shut && !this.ctx.locked('color'));
        for (const field of ['linestyle', 'mask'] as const) {
            const input = this.inputs[field];
            if (input) input.disabled = shut || this.ctx.locked(field);
        }
        for (const field of FIELDS) this.menus[field]?.sync();
    }

    getInput(field: StyleField): HTMLInputElement {
        return this.inputs[field];
    }

    /** Where the field says its issues: its input and the line under its row. */
    slot(field: StyleField): IssueSlot {
        return { input: this.inputs[field], message: this.says[field] };
    }
}
