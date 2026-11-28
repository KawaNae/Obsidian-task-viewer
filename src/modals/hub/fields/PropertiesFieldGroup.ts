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
import { FieldMenuButton, type FieldMenu, type FieldMenuHead, type FieldMenuItem } from '../../form/FieldMenuButton';
import { createFormRow } from '../../form/formRow';
import { onFormEnter } from '../../form/formEnter';
import { bindField, type BoundField, type Written } from '../../form/bindField';
import { ownCommit } from '../../../views/sharedUI/PressCommit';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { ValueSuggest, type ValueSuggestOptions } from '../../../suggest/ValueSuggest';
import type { ClosingPart, FieldGroupContext, HubField, UnsavedField } from './FieldGroupContext';
import { PropertyListField, type ListFocus, type RowMenu } from './PropertyListField';
import { FieldLookView } from './FieldLookView';
import { FieldMenus } from './FieldMenus';
import type { FieldAction } from './FieldState';
import {
    PropertyRows,
    type PropertyConversion,
    type PropertyMenu,
    type PropertyRow,
    type PropertyRowField,
} from './PropertyRows';

/**
 * カスタムプロパティ行。どの行があり、各行の欄が何か（`PropertyRows`）、欄の
 * 見た目と … のメニューの項目、空にしたときの書き込み（欄の状態の表、
 * `FieldStates`）は決まった所が決め、ここはそれを描く。行は「キー、値の欄」で、
 * … は値の欄の右端に重なる（`FieldMenuButton`）。
 * - 自分の値: 実線の枠の字。値を空にして確定すると、上の層がキーを渡していれば
 *   自分の行を消して継承した値を出し、渡していなければ行を残して値のない
 *   プロパティ（`- key::`）を書く
 * - 継承しただけのキー: 欄は空で、継承した値を破線の枠の薄い字に出す。打った値は
 *   自分の値として書く（継承した値と同じ字でも書く）。空のまま確定しても何も書かない
 * - 値なし: 薄い字で「値なし」。上の層の値を隠していれば、隠した値に線を引いて出す
 * - リストの値: 項目ごとの欄（`PropertyListField`）。項目の × は項目を消し、
 *   最後の項目を消すと、値を空にしたときと同じく書く。継承しただけのリストはチップで出す
 * - 所見のあるキー: 編集できない行（`FieldGroupContext.locked`）。メニューは無い
 * - メニュー: 先頭に灰色で押せない属性の行（型、継承元）と区切り線を出す。自分の
 *   文字の値は「リストに変換する」で 1 項目のリストに、項目が 1 つの自分のリストは
 *   「単一の値に変換する」でその項目の値になる。「継承した値をこのタスクに書く」は
 *   選んだ時点で、継承した値をその綴りのまま書く
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
 * 消え、ほかの欄の確定では消えない。追加行にフォーカスがあるまま足すと
 * （Enter、値の候補を選ぶ）、組み直した追加行のキーの欄にフォーカスを置く。行の増減で組み直しても、追加行の
 * 打ちかけの字は残す。足す書き込みが拒まれ、ホストが打った字を欄に残して
 * よいと答えたら（`HubHost.put`）、打った字を追加行に戻す。
 *
 * 値は、値の欄も追加行も `PropertyValueInput` で読む（前後の空白を落とし、
 * 行が読むとおりに読む）。リストの項目は `PropertyItemInput` が同じく読む。
 *
 * 行の見た目（破線の枠、薄い字と隠した値の線、… の有無）と … のメニューは、
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

        const shut = this.ctx.isShut();

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
         * Added with the focus in the row (its Enter, a value picked), the
         * focus goes to the key field of the row built anew, for the next
         * property; a blur's commit leaves it where it went.
         */
        const commitAdd = (): boolean => {
            const key = readKey();
            if (!key) return true;
            if (!key.ok) return false;
            const value = PropertyValueInput.read(valueInput.value);
            if (!value.ok) return false;
            const typed = { key: keyInput.value, value: valueInput.value };
            const active = keyInput.ownerDocument.activeElement;
            const inRow = active === keyInput || active === valueInput;
            const write = this.setValue(key.value, value.value, 'propKey');
            this.draft = { key: '', value: '' };
            this.render(true);
            if (inRow) this.addRow?.keyInput.focus();
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
    }

    /** The rows as the task and its findings are now (`PropertyRows`). */
    private rows(): PropertyRow[] {
        return PropertyRows.of({
            task: this.ctx.task(),
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
     * and a list's items. A row whose shape stays is drawn as it is now by
     * putting its look on it again (its menu button shown or hidden with
     * it); one whose shape changes is built anew.
     */
    private shapeOf(row: PropertyRow): string {
        const field = PropertyRows.fieldOf(row);
        const shape: unknown[] = [field.kind, this.ctx.isShut() || row.locked];
        if (field.kind === 'list') shape.push(field.editsOwn, field.items);
        return JSON.stringify(shape);
    }

    /**
     * Each row's look put on it again from the row as it is now, no element
     * built anew: its key, its frame, its field's faint text and its menu
     * button, a text field given the value as {@link BoundField.set}
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
     * A property's row, drawn as `PropertyRows` says it is: the key, and the
     * field, with the button of the row's menu over its end.
     */
    private renderRow(prop: PropertyRow): void {
        const { folded, key } = prop;
        const field = PropertyRows.fieldOf(prop);
        const shut = this.ctx.isShut();
        const disabled = shut || prop.locked;

        // An own list stands an item a line: its key keeps to the first.
        const ownList = field.kind === 'list' && field.editsOwn;
        const { row, labelEl, says } = createFormRow(this.sectionEl, '', ownList ? { alignStart: true } : undefined);
        labelEl.addClass('task-hub__prop-label');
        const keyEl = labelEl.createSpan({ cls: 'task-hub__prop-key' });
        if (field.kind === 'list') row.addClass('task-hub__row--list');
        if (prop.locked) row.addClass('task-hub__row--locked');
        this.valueSays.set(folded, says);

        const buttons: FieldMenuButton[] = [];
        /** The row's menu button, put in `box` (`inline` in a line of chips), over the row's `fields`. */
        const menu: RowMenu = (box, inline, fields) => { buttons.push(this.menuButton(box, folded, key, inline, fields)); };
        let restyleField = (_now: PropertyRow) => { /* a list's or a blank field's look is its shape's */ };
        if (field.kind === 'text') restyleField = this.textField(row, folded, key, disabled, menu);
        else if (field.kind === 'list') this.listField(row, folded, key, field, disabled, menu);
        else {
            const valueInput = row.createEl('input', { type: 'text', cls: `${VALUE_INPUT_CLS} tv-form__control` });
            valueInput.disabled = true;
            this.valueInputs.set(folded, valueInput);
        }

        const restyle = (now: PropertyRow) => {
            keyEl.setText(now.key);
            restyleField(now);
            for (const button of buttons) button.sync();
        };
        restyle(prop);
        this.drawn.set(folded, { shape: this.shapeOf(prop), restyle });
    }

    /**
     * The row's menu button (…) in `box`, which shows the row's menu under
     * it as the hub's other menus are shown (`menuPresenter`): the
     * attributes' lines greyed, as the card's menu shows a line that only
     * tells, a separator, then the items. The menu is the row's as it is
     * when the button is pressed (`rowNow`), what is typed in the field
     * written first. An item done builds the rows anew, and puts the focus
     * in no field: a tap brings up no keyboard.
     */
    private menuButton(box: HTMLElement, folded: string, key: string, inline: boolean, fields: () => readonly HTMLElement[]): FieldMenuButton {
        return new FieldMenuButton(box, {
            label: t('modal.hub.fieldMenu', { field: key }),
            key: `${propField(key)}:menu`,
            fields,
            menu: () => {
                const prop = this.rowNow(folded);
                return prop ? this.drawnMenu(prop) : { heads: [], items: [] };
            },
            presenter: this.ctx.plugin.menuPresenter,
            disabled: () => this.ctx.isShut(),
            inline,
            signal: this.built.signal,
        });
    }

    /** The row's menu as its button draws it. */
    private drawnMenu(prop: PropertyRow): FieldMenu {
        const { type, menu } = this.menuOf(prop);
        const heads: FieldMenuHead[] = [];
        if (type) {
            const [title, icon] = TYPE_LINES[type];
            heads.push({ title: t(title), icon });
        }
        heads.push(...FieldMenus.heads(menu.head));
        const items = menu.items.map((entry): FieldMenuItem => {
            const run = () => this.runMenu(prop, entry);
            if ('writes' in entry) {
                const [title, icon] = CONVERSION_LINES[entry.action];
                return { title: t(title), icon, run };
            }
            return FieldMenus.item(entry, run);
        });
        return { heads, items };
    }

    /** Do what the menu item `entry` of the row `prop` does. */
    private runMenu(prop: PropertyRow, entry: FieldAction | PropertyConversion): void {
        if (this.ctx.isShut()) return;
        const { key, state } = prop;
        switch (entry.action) {
            case 'openSource':
                this.ctx.openSource?.(copy => CascadeSource.lineOfProperty(copy, key));
                return;
            case 'toList':
            case 'toSingleValue':
                void this.setValue(key, entry.writes);
                break;
            case 'writeInherited':
                // Written as the layer above spells it: `"123"` stays a text.
                if (state.inherited.kind === 'value') void this.setValue(key, state.inherited.value);
                break;
            case 'noValue':
                void this.setValue(key, NO_VALUE);
                break;
            case 'dropOwn':
                void this.remove(key);
                break;
        }
        this.render(true);
    }

    /**
     * The field of a property whose value is one text (a value, or no
     * value): the row's own value edited in place. A row with none of its
     * own has the field empty, what it is given shown faintly
     * (`PropertyRows.lookOf`), and what is typed is written as the row's
     * own.
     *
     * @returns how the field's look is put on it again from the row as it is now
     */
    private textField(row: HTMLElement, folded: string, key: string, disabled: boolean, menu: RowMenu): (now: PropertyRow) => void {
        const box = row.createDiv({ cls: 'tv-form__control task-hub__value-box' });
        const valueInput = box.createEl('input', { type: 'text', cls: VALUE_INPUT_CLS });
        valueInput.disabled = disabled;
        this.valueInputs.set(folded, valueInput);
        const look = new FieldLookView(box, valueInput);

        /** The row's own value as it is now: what the field stands for. */
        const ownNow = () => {
            const now = this.rowNow(folded);
            return now ? valueOf(PropertyRows.fieldOf(now)) : undefined;
        };
        // The field is given its text before it is bound: what it holds then is what it was given.
        valueInput.value = PropertyValueInput.show(lineValueOf(ownNow()));
        const suggest = this.offer(valueInput, {
            candidates: (q) => this.candidates(key).filter(v => !q || v.toLowerCase().includes(q.toLowerCase())),
            pick: (val) => { valueInput.value = val; valueInput.dispatchEvent(new Event('input')); value.commit(); },
        });
        // What is typed reads as a line reads it (`PropertyValueInput`); the
        // field emptied writes what the row's state says (`writeField`). Once
        // written, the row is drawn as it is now, the field kept with the focus.
        const value = bindField(valueInput, {
            codec: PropertyValueInput,
            current: () => lineValueOf(ownNow()),
            // An own line keeps its key as written; a value of a key the row
            // inherits is written under the key it is inherited by.
            commit: (typed) => {
                const written = this.writeField(folded, typed);
                if (written === false) return false;
                this.restyle();
                return written;
            },
            issues: () => { /* any text is a value */ },
            takesEnter: () => suggest.listShown,
            signal: this.built.signal,
        });
        this.valueBound.set(folded, value);
        if (!disabled) menu(box, false, () => [valueInput]);

        return (now) => {
            value.set(lineValueOf(valueOf(PropertyRows.fieldOf(now))));
            look.show(PropertyRows.lookOf(now));
        };
    }

    /**
     * The field of a property whose value is a list: the row's own items
     * edited item by item, or the inherited items shown
     * (`PropertyListField`).
     */
    private listField(row: HTMLElement, folded: string, key: string, field: PropertyRowField & { kind: 'list' }, disabled: boolean, menu: RowMenu): void {
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
            menu: disabled ? undefined : menu,
        }));
    }

    /** The values offered for the property `key`, as spelled. */
    private candidates(key: string): string[] {
        return FilterValueCollector.collectPropertySpellingsForKey(this.ctx.index.getTasks(), key);
    }

    /**
     * Write `items` as the row's own list of the property `folded` (none is
     * the field emptied: `writeField`), and build the rows anew with the
     * focus at `focus` in the list. With the focus in
     * a field of the rows out of the list (another row's value, another
     * list, the add row), as a press on the list's item × leaves it, that
     * field built anew takes it back, its caret where it was: the on-screen
     * keyboard stays up. Nothing, the rows left as they are, from a list
     * that no longer stands for its row (`writeField`).
     */
    private writeList(folded: string, items: PropertyScalar[], focus?: ListFocus): void {
        if (this.writeField(folded, items.length === 0 ? NO_VALUE : { type: 'list', items }) === false) return;
        const after = focus !== undefined
            ? () => this.lists.get(folded)?.focusTarget(focus)?.focus()
            : this.focusBack(folded);
        this.render(true);
        after?.();
    }

    /**
     * How to give the focus back to the field of the rows it is in, once
     * they are built anew, out of the list `folded`: the field standing for
     * the same thing in the rows built anew, its caret as it was. Null while
     * the focus is in no field of the rows, or in that list (which says
     * where its focus goes).
     */
    private focusBack(folded: string): (() => void) | null {
        const active = this.sectionEl.ownerDocument.activeElement as HTMLInputElement | null;
        if (!active || !this.sectionEl.contains(active)) return null;
        let find: (() => HTMLInputElement | null | undefined) | null = null;
        for (const [key, input] of this.valueInputs) {
            if (input === active) find = () => this.valueInputs.get(key);
        }
        if (this.addRow?.keyInput === active) find = () => this.addRow?.keyInput;
        if (this.addRow?.valueInput === active) find = () => this.addRow?.valueInput;
        for (const [key, list] of this.lists) {
            const at = list.focusOf(active);
            if (at === null) continue;
            if (key === folded) return null;
            find = () => this.lists.get(key)?.focusTarget(at);
        }
        if (!find) return null;
        const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = active;
        return () => {
            const to = find?.();
            if (!to) return;
            to.focus();
            if (start !== null && end !== null) to.setSelectionRange(start, end, direction ?? undefined);
        };
    }

    /**
     * Write `value` from the field of the row `folded`, under the key the row
     * has now: what each value field and each list writes through, from a
     * commit, an item's ×, or a close's save. A no value spelled as
     * nothing is the field emptied (or the list's last item taken out),
     * which writes what the row's state says (`PropertyRows.emptiedOf`): the
     * row's own line taken out where a layer above gives its key, else no
     * value written, the key kept; nothing for a row with no value of its
     * own. A field built for the row as it no
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
        // A no value typed (`null`, `~`) is written as typed.
        if (value.type !== 'null' || value.spelling !== '') return this.setValue(now.key, value);
        switch (PropertyRows.emptiedOf(now)) {
            case 'dropOwn': return this.remove(now.key);
            case 'noValue': return this.setValue(now.key, NO_VALUE);
            case 'nothing': return undefined;
        }
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
     * lists' show the values again, and the add row is emptied. The rows are
     * built anew from the value.
     */
    discardTyped(): void {
        for (const bound of this.valueBound.values()) bound.discard();
        for (const list of this.lists.values()) list.discardTyped();
        this.draft = { key: '', value: '' };
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

/** A conversion of a row's menu: its title, and its icon. */
const CONVERSION_LINES: Record<PropertyConversion['action'], readonly [title: string, icon: string]> = {
    toList: ['modal.hub.toList', 'list'],
    toSingleValue: ['modal.hub.toSingleValue', 'type'],
};

/** A menu's line of the type of the value a row shows: its title, and its icon, as the card's menu marks a property's type. */
const TYPE_LINES: Record<Exclude<PropertyValue['type'], 'null'>, readonly [title: string, icon: string]> = {
    text: ['modal.hub.typeText', 'type'],
    number: ['modal.hub.typeNumber', 'hash'],
    boolean: ['modal.hub.typeBoolean', 'toggle-left'],
    list: ['modal.hub.typeList', 'list'],
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

/** The row's own value a text field stands for: none for a list's field, or a blank one. */
function valueOf(field: PropertyRowField): PropertyValue | undefined {
    return field.kind === 'text' ? field.value : undefined;
}

/** A row as built: what it was built as (`shapeOf`), and how its look is put on it again from the row as it is now. */
interface DrawnRow {
    readonly shape: string;
    restyle(now: PropertyRow): void;
}
