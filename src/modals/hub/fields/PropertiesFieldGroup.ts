import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { Properties, PropertyScalar, PropertyValue } from '../../../types';
import { PropertyKey } from '../../../services/parsing/utils/PropertyKey';
import { PropertyValues } from '../../../services/parsing/utils/PropertyValues';
import { FilterValueCollector } from '../../../services/filter/FilterValueCollector';
import { PropertyKeyInput } from '../../../services/parsing/utils/PropertyKeyInput';
import { PropertyValueInput, type PropertyLineValue } from '../../../services/parsing/utils/PropertyItemInput';
import type { Read } from '../../../utils/values/Read';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { ClearButton } from '../../form/ClearButton';
import { createFormRow } from '../../form/formRow';
import { onFormEnter } from '../../form/formEnter';
import { bindField, type BoundField, type Written } from '../../form/bindField';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { ValueSuggest, type ValueSuggestOptions } from '../../../suggest/ValueSuggest';
import type { ClosingPart, FieldGroupContext, HubField, UnsavedField } from './FieldGroupContext';
import { PropertyListField, type ListFocus } from './PropertyListField';
import {
    PropertyRows,
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
 *
 * 行はキーを大文字と小文字を区別せずに1つずつ出し（`PropertyKey`）、キーは
 * 効いている値を書いた層の綴りで出す。
 *
 * 追加行は、まだ行の無いキーだけを足す。キーは `PropertyKeyInput` で読み、
 * 空のキー、`:`、`[`、`]`、`` ` ``、箇条書きの記号か `#` で始まるキー、
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
    private addRow: { keyInput: HTMLInputElement; valueInput: HTMLInputElement; readKey(): Read<string> | null; commit(): void } | null = null;
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

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        this.sectionEl = container.createDiv({ cls: 'task-hub__props' });
        this.render(true);
    }

    render(force = false): void {
        if (!force && this.sectionEl.contains(this.sectionEl.ownerDocument.activeElement)) return;
        this.built.abort();
        this.built = new AbortController();
        const signal = this.built.signal;
        this.lists.clear();
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

        // The rows as the task is now. What a row shows is read once here; a
        // commit reads `ctx.task().properties` as it fires, since a write
        // echoed while the focus keeps the rows from being built anew leaves
        // what was read here behind.
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

        const commitAdd = () => {
            const key = readKey();
            if (!key?.ok) return;
            const value = PropertyValueInput.read(valueInput.value);
            if (!value.ok) return;
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
        };
        this.addRow = { keyInput, valueInput, readKey, commit: commitAdd };
        for (const [input, suggest] of [[keyInput, keySuggest], [valueInput, valueSuggest]] as const) {
            onFormEnter(input, commitAdd, { takesEnter: () => suggest.listShown, signal });
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

    /**
     * A property's row, drawn as `PropertyRows` says it is: the key (and its
     * mark), the field, and the button of the row's menu at its end.
     */
    private renderRow(prop: PropertyRow): void {
        const { folded, key } = prop;
        const form = PropertyRows.formOf(prop);
        const { field } = form;
        const shut = this.ctx.isShut();
        const disabled = shut || prop.locked;

        // An own list stands an item a line: its key and its menu button keep to the first.
        const ownList = field.kind === 'list' && field.editsOwn;
        const { row, labelEl, says } = createFormRow(this.sectionEl, '', ownList ? { alignStart: true } : undefined);
        labelEl.addClass('task-hub__prop-label');
        labelEl.createSpan({ cls: 'task-hub__prop-key', text: key });
        if (form.mark) {
            const [icon, label] = MARKS[form.mark];
            const mark = labelEl.createSpan({ cls: `task-hub__prop-mark task-hub__prop-mark--${form.mark}`, attr: { 'aria-label': t(label) } });
            setIcon(mark, icon);
        }
        if (field.kind === 'list') row.addClass('task-hub__row--list');
        if (form.inheritedLook) row.addClass('task-hub__row--inherited');
        if (prop.locked) row.addClass('task-hub__row--locked');
        this.valueSays.set(folded, says);

        if (field.kind === 'text') this.textField(row, folded, key, field, disabled);
        else if (field.kind === 'list') this.listField(row, folded, key, field, disabled);
        else {
            const valueInput = row.createEl('input', { type: 'text', cls: `${VALUE_INPUT_CLS} tv-form__control` });
            valueInput.disabled = true;
            this.valueInputs.set(folded, valueInput);
        }

        const menu = PropertyRows.menuOf(prop, { opensSource: this.ctx.openSource !== null });
        if (menu.length > 0) this.menuButton(row, prop, menu, shut);
        // A row with no menu keeps the button's room, so that its field ends where the others' do.
        else row.createSpan({ cls: 'task-hub__prop-more-room' });
    }

    /**
     * The row's menu button (…), which shows its items under it as the hub's
     * other menus are shown (`menuPresenter`). An item done builds the rows
     * anew, and puts the focus in no field: a tap brings up no keyboard.
     */
    private menuButton(row: HTMLElement, prop: PropertyRow, items: readonly PropertyMenuItem[], shut: boolean): void {
        const button = row.createEl('button', {
            cls: 'tv-icon-btn task-hub__prop-more',
            attr: { type: 'button', 'aria-label': t('modal.hub.propertyMenu', { key: prop.key }) },
        });
        setIcon(button.createSpan(), 'more-horizontal');
        button.disabled = shut;
        button.addEventListener('click', () => {
            if (this.ctx.isShut()) return;
            this.ctx.plugin.menuPresenter.present((menu) => {
                for (const { action, disabled } of items) {
                    const [title, icon] = MENU_ITEMS[action];
                    menu.addItem((item) => {
                        item.setTitle(t(title)).setIcon(icon).setDisabled(disabled);
                        if (!disabled) item.onClick(() => this.runMenu(prop, action));
                    });
                }
            }, { kind: 'belowRect', rect: button.getBoundingClientRect() });
        }, { signal: this.built.signal });
    }

    /** Do what the menu item `action` of the row `prop` does. */
    private runMenu(prop: PropertyRow, action: PropertyMenuAction): void {
        if (this.ctx.isShut()) return;
        const { folded, key, own, inherited } = prop;
        switch (action) {
            case 'openSource':
                this.ctx.openSource?.(copy => CascadeSource.lineOfProperty(copy, key));
                return;
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
     */
    private textField(row: HTMLElement, folded: string, key: string, field: PropertyRowField & { kind: 'text' }, disabled: boolean): void {
        const { shown, editsOwn } = field;
        const box = row.createDiv({ cls: 'tv-form__control task-hub__value-box' });
        const valueInput = box.createEl('input', { type: 'text', cls: VALUE_INPUT_CLS });
        valueInput.value = PropertyValueInput.show(lineValueOf(shown));
        // No value (`- key::`): the field is empty, and says so, or shows the value it hides struck through.
        valueInput.placeholder = field.placeholder;
        if (field.struck) valueInput.addClass('task-hub__value--struck');
        valueInput.disabled = disabled;
        this.valueInputs.set(folded, valueInput);

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
        // inherited value, it hides it.
        const value = bindField(valueInput, {
            codec: PropertyValueInput,
            current: () => lineValueOf(editsOwn ? PropertyKey.get(this.ctx.task().properties, key)?.value : shown),
            // An own line keeps its key as written; an inherited value made
            // the task's own is written under the key it was inherited by.
            commit: (typed) => this.setValue(key, typed),
            issues: () => { /* any text is a value */ },
            takesEnter: () => suggest.listShown,
            takesSame: () => !editsOwn,
            signal: this.built.signal,
        });
        this.valueBound.set(folded, value);
        // As a date's × does: the field emptied is written at once, and the focus is not put in it.
        if (!disabled) {
            new ClearButton(box, valueInput, {
                clear: () => {
                    valueInput.value = '';
                    valueInput.dispatchEvent(new Event('input'));
                    value.commit();
                    this.render(true);
                },
                focusesField: false,
            });
        }
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
            write: (next, focus) => this.writeList(folded, key, next, focus),
            say: (source, issues) => this.ctx.issues.set(source, issues),
            signal: this.built.signal,
        }));
    }

    /** The values offered for the property `key`, as spelled. */
    private candidates(key: string): string[] {
        return FilterValueCollector.collectPropertySpellingsForKey(this.ctx.index.getTasks(), key);
    }

    /**
     * Write `items` as the row's own list of the property `key` (none is no
     * value, the line kept and its items' lines taken out: over an inherited
     * value, it hides it), the draft written so let go, and build the rows
     * anew with the focus at `focus` in the list.
     */
    private writeList(folded: string, key: string, items: PropertyScalar[], focus?: ListFocus): void {
        this.drafts.delete(folded);
        void this.setValue(key, items.length === 0 ? NO_VALUE : { type: 'list', items });
        if (focus !== undefined) this.focusAfter = { folded, focus };
        this.render(true);
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
    makeOwn: ['modal.hub.makeOwn', 'copy'],
    noValue: ['modal.hub.setNoValue', 'ban'],
    remove: ['modal.hub.deleteProperty', 'trash'],
    revert: ['modal.hub.revertToInherited', 'undo-2'],
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
