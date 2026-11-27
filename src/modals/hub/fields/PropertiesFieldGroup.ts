import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { Properties, PropertyScalar, PropertyValue } from '../../../types';
import { PropertyKey } from '../../../services/parsing/utils/PropertyKey';
import { PropertyValues } from '../../../services/parsing/utils/PropertyValues';
import { FilterValueCollector } from '../../../services/filter/FilterValueCollector';
import { PropertyKeyInput } from '../../../services/parsing/utils/PropertyKeyInput';
import { PropertyValueInput, type PropertyLineValue } from '../../../services/parsing/utils/PropertyItemInput';
import type { Read } from '../../../utils/values/Read';
import { CascadeSource, type CascadeSourceKind } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { ClearButton } from '../../form/ClearButton';
import { createFormRow } from '../../form/formRow';
import { onFormEnter } from '../../form/formEnter';
import { bindField, type BoundField, type Written } from '../../form/bindField';
import { ownCommit, pressKey } from '../../../views/sharedUI/PressCommit';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { ValueSuggest, type ValueSuggestOptions } from '../../../suggest/ValueSuggest';
import type { ClosingPart, FieldGroupContext, HubField, UnsavedField } from './FieldGroupContext';
import { PropertyListField, type ListFocus } from './PropertyListField';
import {
    PropertyRows,
    type PropertyMenu,
    type PropertyMenuAction,
    type PropertyMenuItem,
    type PropertyRow,
    type PropertyRowField,
    type PropertyRowMark,
} from './PropertyRows';

/**
 * カスタムプロパティ行。どの行があり、各行が何を出すか（欄、キーの横の印、
 * … のメニューの項目）は `PropertyRows` が決め、ここはそれを描く。行は
 * 「キー、値の欄、…」で、行を消す操作と継承元の行を開く操作は … のメニューにある。
 * - own キー: value 編集可。値を空にして確定するか、欄の中の × を押すと、行を
 *   残して値のないプロパティ（`- key::`）を書く。× はすぐ書き、フォーカスを
 *   欄へ置かない。行を消すのはメニューだけである
 * - 継承しただけのキー: 破線の枠と `link-2` の印。value を編集し確定すると own
 *   上書きに昇格。空にするか × を押すと、継承した値を隠す値のないプロパティを書く。
 *   隠している行は `link-2off`（lucide の link-2-off）の印で、隠している値を欄の薄い字に打ち消し線で出す
 * - リストの値: 項目ごとの欄（`PropertyListField`）。項目の × は項目を消し、
 *   最後の項目を消すと値なしになる。継承しただけのリストはチップで出し、
 *   メニューの「このタスクの値にする」で項目を写した下書きになり、最初の確定で書く
 * - 所見のあるキー: 編集できない行（`FieldGroupContext.locked`）。メニューは無い
 * - メニュー: 先頭に灰色で押せない属性の行（型、継承元）と区切り線を出す。自分の
 *   文字の値は「リストに変換する」で 1 項目のリストに、項目が 1 つの自分のリストか
 *   下書きは「文字の値に変換する」でその項目の文字の値になる。書く値は `menuOf` が返す
 *
 * 行はキーを大文字と小文字を区別せずに1つずつ出し（`PropertyKey`）、キーは
 * 効いている値を書いた層の綴りで出す。
 *
 * 追加行は、まだ行の無いキーだけを足す。キーは `PropertyKeyInput` で読み、
 * 空のキー、`:`、`[`、`]`、`` ` ``、箇条書きの記号、`#`、`>`、`~~~` で始まるキー、
 * 予約されたキー、行のあるキー（`PropertyRows.takenBy`。キーの候補が除くのと
 * 同じ答え）を拒む。読めないキーは欄の下に理由を出して足さない。確定の
 * 3 つの道（blur、Enter、閉じるときの保存）は同じ読みを通り、閉じるときは
 * 読めないキーを保存できない値として出す（`unsaved`）。理由は打ち直すと
 * 消え、ほかの欄の確定では消えない。行の増減で組み直しても、追加行の
 * 打ちかけの字は残す。足す書き込みが拒まれ、ホストが打った字を欄に残して
 * よいと答えたら（`HubHost.put`）、打った字を追加行に戻す。
 *
 * 値は、値の欄も追加行も `PropertyValueInput` で読む（前後の空白を落とし、
 * 行が読むとおりに読む）。リストの項目は `PropertyItemInput` が同じく読む。
 *
 * 行の見た目（破線の枠、キーの横の印、薄い字と打ち消し線、×）と … のメニューは、
 * 描く時、確定した時、メニューを開く時の行（`rowNow`）から決める。フォーカスが
 * 節の中にある間は要素を作り直さず、行の見た目だけを当て直す（`restyle`）。
 * 行の増減や欄の種類の変化は、フォーカスが節から出た時に組み直す。それまで
 * 残る、消えた行と形の変わった行の欄は、何も書かない（`writeField`）。
 *
 * 行は組み立てごとに1つの `AbortSignal`（`built`）を持ち、その組み立てで
 * 付けた listener、候補の一覧、リストの欄はすべてそれに掛ける。組み直す前に
 * それを abort するので、前の組み立ての listener は走らない。focus のある
 * 入力欄を外すと Chromium は blur を同期で送るが、その blur は何も確定しない
 * （確定がもう一度走ると、外している最中の行を内側の組み直しが先に外す）。
 */
export class PropertiesFieldGroup implements ClosingPart {
    private sectionEl: HTMLElement;
    private addKeyInput: HTMLInputElement | null = null;
    private addSays: HTMLElement | null = null;
    /** custom プロパティ行の value input（focus('<key>') 用）と、その行の文の枠。キーは折りたたんだ形 */
    private valueInputs = new Map<string, HTMLInputElement>();
    private valueSays = new Map<string, HTMLElement>();
    /** Each property's value field, bound: what a close saves. */
    private valueBound = new Map<string, BoundField<PropertyLineValue>>();
    /** The add row as last built: its fields, what its key reads, and its commit. */
    private addRow: { keyInput: HTMLInputElement; valueInput: HTMLInputElement; readKey(): Read<string> | null; commit(): boolean } | null = null;
    /** What is typed in the add row and not yet added: kept across a rebuild. */
    private draft = { key: '', value: '' };
    /**
     * The rows as last built: what they put on (listeners, the lists under
     * the fields, the list fields) is let go when it aborts, before the rows
     * are built anew.
     */
    private built = new AbortController();
    /** Each list property's field as last built, by key folded. */
    private lists = new Map<string, PropertyListField>();
    /**
     * An inherited list made the row's own and not yet written, by key
     * folded: its items, which the first edit writes. Kept across a rebuild,
     * let go once the row has its own value.
     */
    private drafts = new Map<string, PropertyScalar[]>();
    /** Where the focus goes once the rows are built anew: a list's item or add field. */
    private focusAfter: { folded: string; focus: ListFocus } | null = null;
    /** Each row as last built, by key folded, in order: what it was built as (`shapeOf`), and how its look is put on it again. */
    private drawn = new Map<string, DrawnRow>();
    /** The rows as built no longer stand for the rows as they are, and are built anew once the focus leaves them. */
    private stale = false;

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        this.sectionEl = container.createDiv({ cls: 'task-hub__props' });
        // Built anew once the blur is done with: the field left commits first.
        this.sectionEl.addEventListener('blur', (e) => {
            const to = (e as FocusEvent).relatedTarget as Node | null;
            if (this.stale && !this.sectionEl.contains(to)) queueMicrotask(() => { if (this.stale) this.render(true); });
        }, true);
        this.render(true);
    }

    /**
     * Draw the rows as they are now. With the focus in them, no element is
     * built anew, so that the field in focus keeps its caret, what is typed
     * and an IME's composition: each row's look is put on it again
     * (`restyle`). `force` builds them anew all the same.
     */
    render(force = false): void {
        if (!force && this.sectionEl.contains(this.sectionEl.ownerDocument.activeElement)) {
            this.restyle();
            return;
        }
        this.built.abort();
        this.built = new AbortController();
        const signal = this.built.signal;
        this.stale = false;
        this.lists.clear();
        this.drawn.clear();
        this.sectionEl.empty();
        this.valueInputs.clear();
        this.valueSays.clear();
        this.valueBound.clear();

        const task = this.ctx.task();
        const shut = this.ctx.isShut();

        // A draft goes once the row has a value of its own (written, or from outside).
        for (const folded of [...this.drafts.keys()]) {
            if (task.properties?.[folded] !== undefined) this.drafts.delete(folded);
        }

        // The rows as the task is now. What a row shows, what its field
        // stands for and what its menu offers are read of the row as it is
        // when they are drawn, committed or opened (`rowNow`), not of the row
        // it was built as: a row is not built anew while the focus is in the
        // rows.
        for (const row of this.rows()) this.renderRow(row);

        // 追加行 — キーはラベル列に収め、値 input の左端を上の行と揃える
        const { row: addRow, labelEl: addLabelEl, says: addSays } = createFormRow(this.sectionEl, '');
        addRow.addClass('task-hub__prop-add');
        this.addSays = addSays;
        addLabelEl.addClass('tv-form__label--input');
        const keyInput = addLabelEl.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyKey'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        const valueInput = addRow.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyValue'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
        });
        // The room of the rows' menu button, so that the value field ends where theirs do.
        addRow.createSpan({ cls: 'task-hub__prop-more-room' });
        keyInput.disabled = shut;
        valueInput.disabled = shut;
        this.addKeyInput = keyInput;
        keyInput.value = this.draft.key;
        valueInput.value = this.draft.value;
        // A row is asked of as the key is read: one added or gone since the
        // rows were built is told.
        const keyCodec = PropertyKeyInput.of(
            this.ctx.plugin.settings.scopeKeys,
            (key) => PropertyRows.takenBy(this.rows(), key)?.key ?? null,
        );
        /** The key typed, read; null while none is typed. Its issue is said as it is typed. */
        const readKey = () => {
            const read = keyInput.value.trim() === '' ? null : keyCodec.read(keyInput.value);
            this.ctx.issues.set('propKey', readIssue('propKey', read && !read.ok ? read.issue : null));
            return read;
        };
        keyInput.addEventListener('input', (e) => {
            this.draft.key = keyInput.value;
            if (!(e as InputEvent).isComposing) readKey();
        }, { signal });
        keyInput.addEventListener('compositionend', () => readKey(), { signal });
        valueInput.addEventListener('input', () => { this.draft.value = valueInput.value; }, { signal });

        // 候補: 既存キー（vault 全体）から未使用のもの / 値はキーに応じて。
        // キーを選ぶと値の欄へ移り、値を選ぶと行を足す。
        const keySuggest = this.offer(keyInput, {
            candidates: (q) => {
                const rows = this.rows();
                return FilterValueCollector.collectPropertyKeys(this.ctx.index.getTasks())
                    .filter(k => !PropertyRows.takenBy(rows, k))
                    .filter(k => !q || k.toLowerCase().includes(q.toLowerCase()));
            },
            pick: (val) => {
                keyInput.value = val;
                this.draft.key = val;
                readKey();
                valueInput.focus();
            },
        });
        const valueSuggest = this.offer(valueInput, {
            candidates: (q) => {
                const key = keyInput.value.trim();
                if (!key) return [];
                return FilterValueCollector
                    .collectPropertySpellingsForKey(this.ctx.index.getTasks(), key)
                    .filter(v => !q || v.toLowerCase().includes(q.toLowerCase()));
            },
            pick: (val) => { valueInput.value = val; commitAdd(); },
        });

        /**
         * Add what the row holds: false when its key does not read (said
         * under it), true once added, or with no key typed (nothing to add).
         */
        const commitAdd = (): boolean => {
            const key = readKey();
            if (!key) return true;
            if (!key.ok) return false;
            const value = PropertyValueInput.read(valueInput.value);
            if (!value.ok) return false;
            const typed = { key: keyInput.value, value: valueInput.value };
            const write = this.setValue(key.value, value.value, 'propKey');
            this.draft = { key: '', value: '' };
            this.render(true);
            void write?.then((written) => {
                // Refused where it may be taken once added again: what was
                // typed is the add row's again, unless something was typed
                // since. A change the draft of a move refuses is refused for
                // its own lines, and a key whose lines it refuses has a row
                // (`PropertyRows`): the key is refused as it is read.
                if (written !== false || this.draft.key !== '' || this.draft.value !== '') return;
                this.draft = typed;
                const row = this.addRow;
                if (row && row.keyInput.value === '' && row.valueInput.value === '') {
                    row.keyInput.value = typed.key;
                    row.valueInput.value = typed.value;
                }
            });
            return true;
        };
        this.addRow = { keyInput, valueInput, readKey, commit: commitAdd };
        // Both fields commit the row as one, as its Enter does: a press elsewhere commits it first.
        const addCommit = {
            typed: () => keyInput.value.trim() !== '' || valueInput.value.trim() !== '',
            commit: commitAdd,
        };
        for (const [input, suggest] of [[keyInput, keySuggest], [valueInput, valueSuggest]] as const) {
            onFormEnter(input, commitAdd, { takesEnter: () => suggest.listShown, signal });
            ownCommit(input, addCommit, signal);
        }
        // blur 確定ルール: key があれば value 空でも確定。値のないプロパティ
        // （`- key::`）として書き、上の層の値を隠す。
        // value だけでは書き込み先がないので確定しない。
        // ただし key⇔value 間のフォーカス移動は入力継続中なので確定を保留する。
        const blurCommit = (e: FocusEvent) => {
            const to = e.relatedTarget;
            if (to === keyInput || to === valueInput) return;
            if (keyInput.value.trim()) commitAdd();
        };
        keyInput.addEventListener('blur', blurCommit, { signal });
        valueInput.addEventListener('blur', blurCommit, { signal });

        this.ctx.issues.redraw();

        const focus = this.focusAfter;
        this.focusAfter = null;
        if (focus) this.lists.get(focus.folded)?.focusTarget(focus.focus)?.focus();
    }

    /** The rows as the task, its drafts and its findings are now (`PropertyRows`). */
    private rows(): PropertyRow[] {
        return PropertyRows.of({
            task: this.ctx.task(),
            drafts: this.drafts,
            findings: this.ctx.findings(),
            locked: (field) => this.ctx.locked(field),
        });
    }

    /** The row of the property `folded` as it is now; undefined once it has none. */
    private rowNow(folded: string): PropertyRow | undefined {
        return this.rows().find(row => row.folded === folded);
    }

    private menuOf(row: PropertyRow): PropertyMenu {
        return PropertyRows.menuOf(row, { opensSource: this.ctx.openSource !== null });
    }

    /**
     * What a row is built as: the kind of its field, whether it takes input,
     * whether it has a menu, and a list's items. A row whose shape stays is
     * drawn as it is now by putting its look on it again; one whose shape
     * changes is built anew.
     */
    private shapeOf(row: PropertyRow): string {
        const { field } = PropertyRows.formOf(row);
        const shape: unknown[] = [field.kind, this.ctx.isShut() || row.locked, this.menuOf(row).items.length > 0];
        if (field.kind === 'list') shape.push(field.editsOwn, field.items);
        return JSON.stringify(shape);
    }

    /**
     * Each row's look put on it again from the row as it is now, no element
     * built anew: its key, its mark, its frame, and its field's faint text,
     * strike and ×, a text field given the value as {@link BoundField.set}
     * gives it (what is typed in it kept). A row added, gone, or now of
     * another shape is left as it is, its field writing nothing
     * (`writeField`), and the rows are built anew once the focus leaves them.
     */
    private restyle(): void {
        const rows = this.rows();
        const drawn = [...this.drawn.keys()];
        if (rows.length !== drawn.length || rows.some((row, i) => row.folded !== drawn[i])) this.stale = true;
        for (const row of rows) {
            const was = this.drawn.get(row.folded);
            if (was?.shape === this.shapeOf(row)) was.restyle(row);
            else this.stale = true;
        }
    }

    /**
     * A property's row, drawn as `PropertyRows` says it is: the key (and its
     * mark), the field, and the button of the row's menu at its end.
     */
    private renderRow(prop: PropertyRow): void {
        const { folded, key } = prop;
        const { field } = PropertyRows.formOf(prop);
        const shut = this.ctx.isShut();
        const disabled = shut || prop.locked;

        // An own list stands an item a line: its key and its menu button keep to the first.
        const ownList = field.kind === 'list' && field.editsOwn;
        const { row, labelEl, says } = createFormRow(this.sectionEl, '', ownList ? { alignStart: true } : undefined);
        labelEl.addClass('task-hub__prop-label');
        const keyEl = labelEl.createSpan({ cls: 'task-hub__prop-key' });
        let markEl: HTMLElement | null = null;
        if (field.kind === 'list') row.addClass('task-hub__row--list');
        if (prop.locked) row.addClass('task-hub__row--locked');
        this.valueSays.set(folded, says);

        let restyleField = (_field: PropertyRowField) => { /* a list's or a blank field's look is its shape's */ };
        if (field.kind === 'text') restyleField = this.textField(row, folded, key, field, disabled);
        else if (field.kind === 'list') this.listField(row, folded, key, field, disabled);
        else {
            const valueInput = row.createEl('input', { type: 'text', cls: `${VALUE_INPUT_CLS} tv-form__control` });
            valueInput.disabled = true;
            this.valueInputs.set(folded, valueInput);
        }

        if (this.menuOf(prop).items.length > 0) this.menuButton(row, folded, key, shut);
        // A row with no menu keeps the button's room, so that its field ends where the others' do.
        else row.createSpan({ cls: 'task-hub__prop-more-room' });

        const restyle = (now: PropertyRow) => {
            const form = PropertyRows.formOf(now);
            keyEl.setText(now.key);
            markEl?.detach();
            markEl = null;
            if (form.mark) {
                const [icon, label] = MARKS[form.mark];
                markEl = labelEl.createSpan({ cls: `task-hub__prop-mark task-hub__prop-mark--${form.mark}`, attr: { 'aria-label': t(label) } });
                setIcon(markEl, icon);
            }
            row.toggleClass('task-hub__row--inherited', form.inheritedLook);
            restyleField(form.field);
        };
        restyle(prop);
        this.drawn.set(folded, { shape: this.shapeOf(prop), restyle });
    }

    /**
     * The row's menu button (…), which shows its menu under it as the hub's
     * other menus are shown (`menuPresenter`): the attributes' lines greyed,
     * as the card's menu shows a line that only tells, a separator, then
     * the items. The menu is the row's as it is when the button is pressed
     * (`rowNow`). An item done builds the rows anew, and puts the focus in no
     * field: a tap brings up no keyboard.
     */
    private menuButton(row: HTMLElement, folded: string, key: string, shut: boolean): void {
        const button = row.createEl('button', {
            cls: 'tv-icon-btn task-hub__prop-more',
            attr: { type: 'button', 'aria-label': t('modal.hub.propertyMenu', { key }) },
        });
        setIcon(button.createSpan(), 'more-horizontal');
        pressKey(button, `${propField(key)}:menu`);
        button.disabled = shut;
        button.addEventListener('click', () => {
            if (this.ctx.isShut()) return;
            const prop = this.rowNow(folded);
            if (!prop) return;
            const { attributes, items } = this.menuOf(prop);
            if (items.length === 0) return;
            this.ctx.plugin.menuPresenter.present((menu) => {
                for (const attribute of attributes) {
                    const [title, icon] = attribute.kind === 'type' ? TYPE_LINES[attribute.type] : SOURCE_LINES[attribute.source];
                    menu.addItem(item => item.setTitle(t(title)).setIcon(icon).setDisabled(true));
                }
                if (attributes.length > 0) menu.addSeparator();
                for (const entry of items) {
                    const [title, icon] = MENU_ITEMS[entry.action];
                    menu.addItem((item) => {
                        item.setTitle(t(title)).setIcon(icon).setDisabled(entry.disabled);
                        if (!entry.disabled) item.onClick(() => this.runMenu(prop, entry));
                    });
                }
            }, { kind: 'belowRect', rect: button.getBoundingClientRect() });
        }, { signal: this.built.signal });
    }

    /** Do what the menu item `entry` of the row `prop` does. */
    private runMenu(prop: PropertyRow, entry: PropertyMenuItem): void {
        if (this.ctx.isShut()) return;
        const { folded, key, own, inherited } = prop;
        switch (entry.action) {
            case 'openSource':
                this.ctx.openSource?.(copy => CascadeSource.lineOfProperty(copy, key));
                return;
            case 'toList':
            case 'toText':
                // A draft converted is written as the value, and so let go.
                this.drafts.delete(folded);
                void this.setValue(key, entry.writes);
                break;
            case 'makeOwn':
                if (inherited.kind === 'value' && inherited.value.type === 'list') this.drafts.set(folded, [...inherited.value.items]);
                break;
            case 'noValue':
                this.drafts.delete(folded);
                void this.setValue(key, NO_VALUE);
                break;
            case 'remove':
                void this.remove(key);
                break;
            case 'revert':
                // A draft is not written yet: it is thrown away, and the inherited list shows again.
                if (own.kind === 'draft') this.drafts.delete(folded);
                else void this.remove(key);
                break;
        }
        this.render(true);
    }

    /**
     * The field of a property whose value is one text (a value, or no
     * value): its own value edited in place, or the inherited one shown,
     * which typed again is made the row's own. The × in its end empties it
     * and writes no value at once (`- key::`), the row kept: over an
     * inherited value, it hides it.
     *
     * @returns how the field's look is put on it again from the row's field as it is now
     */
    private textField(row: HTMLElement, folded: string, key: string, field: PropertyRowField & { kind: 'text' }, disabled: boolean): (now: PropertyRowField) => void {
        const box = row.createDiv({ cls: 'tv-form__control task-hub__value-box' });
        const valueInput = box.createEl('input', { type: 'text', cls: VALUE_INPUT_CLS });
        valueInput.value = PropertyValueInput.show(lineValueOf(field.shown));
        valueInput.disabled = disabled;
        this.valueInputs.set(folded, valueInput);

        /** The row's field as it is now: what the text stands for, and whether it edits the row's own value. */
        const fieldNow = () => {
            const now = this.rowNow(folded);
            return now ? PropertyRows.formOf(now).field : null;
        };
        const suggest = this.offer(valueInput, {
            candidates: (q) => this.candidates(key).filter(v => !q || v.toLowerCase().includes(q.toLowerCase())),
            // A value picked is one typed: the inherited value picked is made the row's own.
            pick: (val) => { valueInput.value = val; valueInput.dispatchEvent(new Event('input')); value.commit(); },
        });
        // The value the row shows, as a line spells it: its own, or the
        // inherited one. Left as it is, no own value is made; typed again,
        // the inherited value is written as the row's own (`takesSame`).
        // What is typed reads as a line reads it (`PropertyValueInput`);
        // nothing typed is no value (`- key::`), the row kept: over an
        // inherited value, it hides it. Once written, the row is drawn as it
        // is now, the field kept with the focus.
        const value = bindField(valueInput, {
            codec: PropertyValueInput,
            current: () => lineValueOf(shownOf(fieldNow())),
            // An own line keeps its key as written; an inherited value made
            // the task's own is written under the key it was inherited by.
            commit: (typed) => {
                const written = this.writeField(folded, typed);
                if (written === false) return false;
                this.restyle();
                return written;
            },
            issues: () => { /* any text is a value */ },
            takesEnter: () => suggest.listShown,
            takesSame: () => {
                const now = fieldNow();
                return now !== null && now.kind !== 'blank' && !now.editsOwn;
            },
            signal: this.built.signal,
        });
        this.valueBound.set(folded, value);
        // As a date's × does: the field emptied is written at once, and the focus is not put in it.
        const clear = disabled ? null : new ClearButton(box, valueInput, {
            clear: () => {
                valueInput.value = '';
                valueInput.dispatchEvent(new Event('input'));
                value.commit();
            },
            focusesField: false,
            key: `${propField(key)}:clear`,
        });

        return (now) => {
            // No value (`- key::`): the field is empty, and says so, or shows the value it hides struck through.
            valueInput.placeholder = now.kind === 'text' ? now.placeholder : '';
            valueInput.toggleClass('task-hub__value--struck', now.kind === 'text' && now.struck);
            value.set(lineValueOf(shownOf(now)));
            clear?.sync();
        };
    }

    /**
     * The field of a property whose value is a list: the row's own items (its
     * list, or a draft made of the inherited ones, written by its first
     * edit) edited item by item, or the inherited items shown
     * (`PropertyListField`).
     */
    private listField(row: HTMLElement, folded: string, key: string, field: PropertyRowField & { kind: 'list' }, disabled: boolean): void {
        this.lists.set(folded, new PropertyListField(row, {
            app: this.ctx.app,
            key,
            at: `prop:${folded}`,
            own: field.editsOwn,
            items: field.items,
            disabled,
            candidates: () => this.candidates(key),
            write: (next, focus) => this.writeList(folded, next, focus),
            say: (source, issues) => this.ctx.issues.set(source, issues),
            signal: this.built.signal,
        }));
    }

    /** The values offered for the property `key`, as spelled. */
    private candidates(key: string): string[] {
        return FilterValueCollector.collectPropertySpellingsForKey(this.ctx.index.getTasks(), key);
    }

    /**
     * Write `items` as the row's own list of the property `folded` (none is
     * no value, the line kept and its items' lines taken out: over an
     * inherited value, it hides it), the draft written so let go, and build
     * the rows anew with the focus at `focus` in the list. Nothing, the rows
     * left as they are, from a list that no longer stands for its row
     * (`writeField`).
     */
    private writeList(folded: string, items: PropertyScalar[], focus?: ListFocus): void {
        if (this.writeField(folded, items.length === 0 ? NO_VALUE : { type: 'list', items }) === false) return;
        this.drafts.delete(folded);
        if (focus !== undefined) this.focusAfter = { folded, focus };
        this.render(true);
    }

    /**
     * Write `value` from the field of the row `folded`, under the key the row
     * has now: what each value field and each list writes through, from a
     * commit, a ×, or a close's save. A field built for the row as it no
     * longer is writes nothing (`false`), typed over or not: its row gone,
     * or now of another shape (`shapeOf`), as a write from outside makes it
     * while the focus is in the rows and they are not built anew. Its text
     * or its items stand for no value of the row now, and written they would
     * put back what the write from outside changed. The rows are built anew,
     * as they are, once the focus leaves them.
     */
    private writeField(folded: string, value: PropertyValue): Promise<Written> | undefined | false {
        const now = this.rowNow(folded);
        if (!now || this.drawn.get(folded)?.shape !== this.shapeOf(now)) return false;
        return this.setValue(now.key, value);
    }

    /** A list of values under `input`, closed when the rows are built anew. */
    private offer(input: HTMLInputElement, opts: ValueSuggestOptions): ValueSuggest {
        const suggest = new ValueSuggest(this.ctx.app, input, opts);
        this.built.signal.addEventListener('abort', () => suggest.close());
        return suggest;
    }

    /**
     * Write `value` as the task's own value of the property `key`, its case
     * aside: a line the task has keeps its key as written, and a new line
     * takes `key`.
     */
    private setValue(key: string, value: PropertyValue, at: HubField = propField(key)): Promise<Written> | undefined {
        const own = this.ctx.task().properties ?? {};
        const written = PropertyKey.get(own, key)?.key ?? key;
        return this.commit({ ...own, [PropertyKey.fold(key)]: { key: written, value } }, at);
    }

    /** Take the task's own line of the property `key` out, its case aside: the value above comes through. */
    private remove(key: string): Promise<Written> | undefined {
        const next = { ...(this.ctx.task().properties ?? {}) };
        delete next[PropertyKey.fold(key)];
        return this.commit(next, propField(key));
    }

    /** Hand the task's own properties on as `props`, from the field `at`: a property's row, or the add row's key. */
    private commit(props: Properties, at: HubField): Promise<Written> | undefined {
        if (this.ctx.isShut()) return undefined;
        return this.ctx.put(TaskUpdateBuilder.customProperties(this.ctx.task(), props), at);
    }

    /**
     * The add row, when what is typed in it cannot be added: a key that does
     * not read, or a value with no key to write it under. A property's value
     * is any text, so it is always saved.
     */
    unsaved(): UnsavedField[] {
        const row = this.addRow;
        if (!row) return [];
        const typedKey = row.keyInput.value.trim() !== '';
        const unsaved = typedKey ? row.readKey()?.ok === false : row.valueInput.value.trim() !== '';
        const lists = [...this.lists.values()].flatMap(list => list.unsaved());
        return [...lists, ...(unsaved ? [{ label: t('modal.hub.propertyKeyField'), input: row.keyInput }] : [])];
    }

    discardUnsaved(): void {
        for (const list of this.lists.values()) list.discardUnsaved();
        if (this.unsaved().length === 0) return;
        this.draft = { key: '', value: '' };
        if (this.addRow) {
            this.addRow.keyInput.value = '';
            this.addRow.valueInput.value = '';
        }
        this.ctx.issues.set('propKey', []);
    }

    /**
     * Throw away all that is typed, read or not: the values' fields and the
     * lists' show the values again, the add row is emptied, and an inherited
     * list made the row's own and not written yet is let go. The rows are
     * built anew from the value.
     */
    discardTyped(): void {
        for (const bound of this.valueBound.values()) bound.discard();
        for (const list of this.lists.values()) list.discardTyped();
        this.draft = { key: '', value: '' };
        this.drafts.clear();
        this.ctx.issues.set('propKey', []);
        this.render(true);
    }

    /**
     * Save what is typed and reads. The lists are taken first: a write
     * builds the rows anew, and each list saves what its own inputs hold, in
     * one write of its own (`PropertyListField.save`).
     */
    save(): void {
        const lists = [...this.lists.values()];
        for (const bound of this.valueBound.values()) if (bound.pending()?.ok) bound.commit();
        const row = this.addRow;
        if (row && row.keyInput.value.trim() !== '' && row.readKey()?.ok) row.commit();
        for (const list of lists) list.save();
    }

    /** 外部変更（echo）の取り込み。focus 中はスキップする既存の render ガードに乗る。 */
    refresh(): void {
        this.render();
    }

    setEnabled(_enabled: boolean): void {
        this.render(true);
    }

    /** Where the add row's key (`propKey`) or a property's value (`prop:<key>`) says its issues. */
    slot(at: HubField): IssueSlot | null {
        if (at === 'propKey') return this.addKeyInput && this.addSays ? { input: this.addKeyInput, message: this.addSays } : null;
        const key = PropertyKey.fold(at.slice('prop:'.length));
        const message = this.valueSays.get(key);
        // A list marks the input that is wrong itself: its slot marks none.
        return message ? { input: this.valueInputs.get(key) ?? null, message } : null;
    }

    /**
     * The value field of the property `key` (a list's field to add an item);
     * the new property's key field when there is none, or no key is named.
     */
    fieldElement(key?: string): HTMLElement | null {
        const folded = key ? PropertyKey.fold(key) : undefined;
        const field = folded ? this.valueInputs.get(folded) ?? this.lists.get(folded)?.focusTarget('add') : undefined;
        return field ?? this.addKeyInput ?? null;
    }
}

const VALUE_INPUT_CLS = 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow task-hub__value';

/** The mark beside a row's key: its icon, and what it is called. */
const MARKS: Record<PropertyRowMark, readonly [icon: string, label: string]> = {
    inherited: ['link-2', 'modal.hub.markInherited'],
    // Lucide's link-2-off, which Obsidian's icons name `link-2off`: `link-2-off` draws nothing there.
    hiding: ['link-2off', 'modal.hub.markHiding'],
};

/** An item of a row's menu: its title, and its icon. */
const MENU_ITEMS: Record<PropertyMenuAction, readonly [title: string, icon: string]> = {
    openSource: ['modal.hub.openInheritedLine', 'external-link'],
    toList: ['modal.hub.toList', 'list'],
    toText: ['modal.hub.toText', 'type'],
    makeOwn: ['modal.hub.makeOwn', 'copy'],
    noValue: ['modal.hub.setNoValue', 'ban'],
    remove: ['modal.hub.deleteProperty', 'trash'],
    revert: ['modal.hub.revertToInherited', 'undo-2'],
};

/** A menu's line of the type of the value a row shows: its title, and its icon, as the card's menu marks a property's type. */
const TYPE_LINES: Record<Exclude<PropertyValue['type'], 'null'>, readonly [title: string, icon: string]> = {
    text: ['modal.hub.typeText', 'type'],
    number: ['modal.hub.typeNumber', 'hash'],
    boolean: ['modal.hub.typeBoolean', 'toggle-left'],
    list: ['modal.hub.typeList', 'list'],
};

/** A menu's line of where a row's inherited value is written: its title, and its icon. */
const SOURCE_LINES: Record<CascadeSourceKind, readonly [title: string, icon: string]> = {
    section: ['modal.hub.fromSection', 'heading'],
    file: ['modal.hub.fromFile', 'file-text'],
};

/** The field of the property `key`'s row, as its issues are said of it. */
function propField(key: string): HubField {
    return `prop:${PropertyKey.fold(key)}`;
}

const NO_VALUE: PropertyLineValue = { type: 'null', spelling: '' };

/**
 * A value as a text field stands for it, shown as the line spells it
 * (`"123"` a text, `123` a number), since what the field holds is what is
 * written: none for no line. A list has a field of its own
 * (`PropertyListField`); one that comes in while the field holds the focus
 * is shown as its items read, as a text.
 */
function lineValueOf(value: PropertyValue | undefined): PropertyLineValue {
    if (value === undefined) return NO_VALUE;
    if (value.type !== 'list') return value;
    const text = PropertyValues.display(value);
    return { type: 'text', text, spelling: text };
}

/** The value a row's field shows: a text's, a list's items; none for a blank field, or no row. */
function shownOf(field: PropertyRowField | null): PropertyValue | undefined {
    if (field === null || field.kind === 'blank') return undefined;
    return field.kind === 'text' ? field.shown : { type: 'list', items: [...field.items] };
}

/** A row as built: what it was built as (`shapeOf`), and how its look is put on it again from the row as it is now. */
interface DrawnRow {
    readonly shape: string;
    restyle(now: PropertyRow): void;
}
