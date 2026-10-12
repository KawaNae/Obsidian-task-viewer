import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { Properties, PropertyScalar, PropertyValue, Task } from '../../../types';
import { getEffectiveProperties } from '../../../services/data/EffectiveProperties';
import { PropertyKey } from '../../../services/parsing/utils/PropertyKey';
import { PropertyValues } from '../../../services/parsing/utils/PropertyValues';
import { FilterValueCollector } from '../../../services/filter/FilterValueCollector';
import { PropertyKeyInput } from '../../../services/parsing/utils/PropertyKeyInput';
import { FreeText } from '../../../utils/values/TextValues';
import type { Read } from '../../../utils/values/Read';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { createFormRow } from '../../form/formRow';
import { onFormEnter } from '../../form/formEnter';
import { bindField, type BoundField } from '../../form/bindField';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { ValueSuggest, type ValueSuggestOptions } from '../../../suggest/ValueSuggest';
import type { ClosingPart, FieldGroupContext, HubField, UnsavedField } from './FieldGroupContext';
import { PropertyListField, type ListFocus } from './PropertyListField';

/**
 * カスタムプロパティ行。
 * - own キー: value 編集可 + 行削除ボタン
 * - cascade 由来のみのキー: グレー行。value を編集し確定すると own 上書きに昇格
 * - リストの値: 項目ごとの欄（`PropertyListField`）。自分のリストには行削除ボタンを
 *   出さず、最後の項目を消すと行も消える。受け継いだリストは読むだけで、
 *   「このタスクの値にする」で項目を写した下書きになり、最初の確定で書く
 * - 所見のあるキー: 編集できない行（`FieldGroupContext.locked`）
 *
 * 行はキーを大文字と小文字を区別せずに1つずつ出し（`PropertyKey`）、キーは
 * 効いている値を書いた層の綴りで出す。
 *
 * 追加行のキーは `PropertyKeyInput` で読み（空のキー、`:`、`[`、`]`、`` ` `` と予約されたキーを
 * 拒む）、読めないキーは欄の下に理由を出して足さない。理由は打ち直すと
 * 消え、ほかの欄の確定では消えない。行の増減で組み直しても、追加行の
 * 打ちかけの字は残す。足す書き込みが拒まれたら、打った字を追加行に戻す。
 */
export class PropertiesFieldGroup implements ClosingPart {
    private sectionEl: HTMLElement;
    private addKeyInput: HTMLInputElement | null = null;
    private addSays: HTMLElement | null = null;
    /** custom プロパティ行の value input（focus('<key>') 用）と、その行の文の枠。キーは折りたたんだ形 */
    private valueInputs = new Map<string, HTMLInputElement>();
    private valueSays = new Map<string, HTMLElement>();
    /** Each property's value field, bound: what a close saves. */
    private valueBound = new Map<string, BoundField<string>>();
    /** The add row as last built: its fields, what its key reads, and its commit. */
    private addRow: { keyInput: HTMLInputElement; valueInput: HTMLInputElement; readKey(): Read<string> | null; commit(): void } | null = null;
    /** What is typed in the add row and not yet added: kept across a rebuild. */
    private draft = { key: '', value: '' };
    /** The lists under the fields as last built: closed before the rows are built anew. */
    private suggests: ValueSuggest[] = [];
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
        for (const suggest of this.suggests) suggest.close();
        this.suggests = [];
        for (const list of this.lists.values()) list.dispose();
        this.lists.clear();
        this.sectionEl.empty();
        this.valueInputs.clear();
        this.valueSays.clear();
        this.valueBound.clear();

        const task = this.ctx.getTask();
        const shut = this.ctx.isShut();

        // A draft goes once the row has a value of its own (written, or from outside).
        for (const folded of [...this.drafts.keys()]) {
            if (task.properties?.[folded] !== undefined) this.drafts.delete(folded);
        }

        // render 時スナップショット。表示判定（isOwn / pv）専用 — commit の
        // merge base には使わない。focus ガードで rebuild がスキップされる間に
        // 他行の commit が echo されると陳腐化するため、各 closure は
        // ctx.getTask().properties を発火時に読む（tags と同じ規則）。
        const own = task.properties ?? {};
        const effective = getEffectiveProperties(task);

        for (const [folded, { key, value: pv }] of Object.entries(effective)) {
            const ownValue = PropertyKey.get(own, key)?.value;
            const draft = ownValue === undefined ? this.drafts.get(folded) : undefined;
            if (ownValue?.type === 'list') this.renderListRow(folded, key, ownValue.items, 'own');
            else if (draft) this.renderListRow(folded, key, draft, 'draft');
            else if (ownValue === undefined && pv.type === 'list') this.renderListRow(folded, key, pv.items, 'inherited');
            else this.renderValueRow(folded, key, pv, ownValue !== undefined);
        }

        // A property whose block has a finding and that has no value to show
        // (a key written twice, and nothing inherited): a locked row of its
        // own, so that what is wrong is said where the property would be.
        for (const finding of this.ctx.findings()) {
            if (!finding.field.startsWith('prop:')) continue;
            const folded = finding.field.slice('prop:'.length);
            if (this.valueSays.has(folded)) continue;
            const { row, says } = createFormRow(this.sectionEl, finding.key);
            row.addClass('task-hub__row--locked');
            this.valueSays.set(folded, says);
            const valueInput = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
            valueInput.disabled = true;
            this.valueInputs.set(folded, valueInput);
        }

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
        const keyCodec = PropertyKeyInput.of(this.ctx.plugin.settings.scopeKeys);
        /** The key typed, read; null while none is typed. Its issue is said as it is typed. */
        const readKey = () => {
            const read = keyInput.value.trim() === '' ? null : keyCodec.read(keyInput.value);
            this.ctx.issues.set('propKey', readIssue('propKey', read && !read.ok ? read.issue : null));
            return read;
        };
        keyInput.addEventListener('input', (e) => {
            this.draft.key = keyInput.value;
            if (!(e as InputEvent).isComposing) readKey();
        });
        keyInput.addEventListener('compositionend', () => readKey());
        valueInput.addEventListener('input', () => { this.draft.value = valueInput.value; });

        // 候補: 既存キー（vault 全体）から未使用のもの / 値はキーに応じて。
        // キーを選ぶと値の欄へ移り、値を選ぶと行を足す。
        const keySuggest = this.offer(keyInput, {
            candidates: (q) => {
                return FilterValueCollector.collectPropertyKeys(this.ctx.index.getTasks())
                    .filter(k => !PropertyKey.get(effective, k) && !this.ctx.locked(`prop:${PropertyKey.fold(k)}`))
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
            const raw = valueInput.value;
            const typed = { key: keyInput.value, value: raw };
            const write = this.set(key.value, raw);
            this.draft = { key: '', value: '' };
            this.render(true);
            // Refused: what was typed is the add row's again, unless something was typed since.
            void write?.then((written) => {
                if (written || this.draft.key !== '' || this.draft.value !== '') return;
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
            onFormEnter(input, commitAdd, { takesEnter: () => suggest.listShown });
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
        keyInput.addEventListener('blur', blurCommit);
        valueInput.addEventListener('blur', blurCommit);

        this.ctx.issues.redraw();

        const focus = this.focusAfter;
        this.focusAfter = null;
        if (focus) this.lists.get(focus.folded)?.focusTarget(focus.focus)?.focus();
    }

    /**
     * The row of a property whose value is one text (a value, or no value):
     * its own value edited in place, or the inherited one shown, which typed
     * again is made the row's own.
     */
    private renderValueRow(folded: string, key: string, pv: PropertyValue, isOwn: boolean): void {
        const task = this.ctx.getTask();
        const shut = this.ctx.isShut();
        const locked = this.ctx.locked(`prop:${folded}`);

        const { row, says } = createFormRow(this.sectionEl, key);
        if (!isOwn) row.addClass('task-hub__row--cascade');
        if (locked) row.addClass('task-hub__row--locked');
        this.valueSays.set(folded, says);

        const valueInput = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
        valueInput.value = shownText(pv);
        // No value written as none (`- key::`): the field is empty, and says so.
        if (pv.type === 'null') valueInput.placeholder = t('modal.hub.noValue');
        valueInput.disabled = shut || locked;
        this.valueInputs.set(folded, valueInput);

        const suggest = this.offer(valueInput, {
            candidates: (q) => this.candidates(key).filter(v => !q || v.toLowerCase().includes(q.toLowerCase())),
            // A value picked is one typed: the inherited value picked is made the row's own.
            pick: (val) => { valueInput.value = val; valueInput.dispatchEvent(new Event('input')); value.commit(); },
        });
        // The value the row shows, as a line spells it: its own, or the
        // inherited one. Left as it is, no own value is made; typed again,
        // the inherited value is written as the row's own (`takesSame`).
        // What is typed is written as typed, and reads as a line reads it
        // (`PropertyValues.fromText`); nothing typed takes the row's own line
        // out, and the value above comes through.
        const value = bindField(valueInput, {
            codec: FreeText,
            current: () => {
                const shown = isOwn ? PropertyKey.get(this.ctx.getTask().properties, key)?.value : pv;
                return shown ? shownText(shown) : '';
            },
            // An own line keeps its key as written; an inherited value made
            // the task's own is written under the key it was inherited by.
            commit: (raw) => raw.trim() === '' ? this.remove(key) : this.set(key, raw),
            issues: () => { /* any text is a value */ },
            takesEnter: () => suggest.listShown,
            takesSame: () => !isOwn,
        });
        this.valueBound.set(folded, value);

        if (isOwn) {
            this.removeButton(row, key, shut || locked, () => { this.remove(key); });
            return;
        }
        this.sourceLabel(row, task, key);
        if (pv.type !== 'null') this.hideButton(row, key, shut || locked);
    }

    /**
     * The button that hides an inherited value: the row's own line with no
     * value (`- key::`), which the value above does not come through. Its
     * × takes the line out again.
     */
    private hideButton(row: HTMLElement, key: string, disabled: boolean): void {
        const hide = row.createEl('button', { cls: 'tv-icon-btn task-hub__hide', attr: { type: 'button' } });
        setIcon(hide.createSpan(), 'ban');
        hide.setAttribute('aria-label', t('modal.hub.hideInherited', { key }));
        hide.disabled = disabled;
        hide.addEventListener('click', () => {
            void this.setValue(key, { type: 'null', spelling: '' });
            this.render(true);
        });
    }

    /**
     * The row of a property whose value is a list: the row's own items
     * (`own`, or a `draft` made of the inherited ones, written by its first
     * edit) edited item by item, or the inherited items shown, with the
     * line they are written on to open and the row made its own from a copy
     * of them (`PropertyListField`). An own list has no × that takes its
     * whole line out; a draft's × throws the draft away.
     */
    private renderListRow(folded: string, key: string, items: readonly PropertyScalar[], kind: 'own' | 'draft' | 'inherited'): void {
        const task = this.ctx.getTask();
        const shut = this.ctx.isShut();
        const locked = this.ctx.locked(`prop:${folded}`);
        const at: HubField = `prop:${folded}`;

        const { row, says } = createFormRow(this.sectionEl, key, { alignStart: true });
        row.addClass('task-hub__row--list');
        if (kind === 'inherited') row.addClass('task-hub__row--cascade');
        if (locked) row.addClass('task-hub__row--locked');
        this.valueSays.set(folded, says);

        const field = new PropertyListField(row, {
            app: this.ctx.app,
            key,
            at,
            own: kind !== 'inherited',
            items,
            disabled: shut || locked,
            candidates: () => this.candidates(key),
            write: (next, focus) => this.writeList(folded, key, next, focus),
            say: (source, issues) => this.ctx.issues.set(source, issues),
        });
        this.lists.set(folded, field);

        // The row's own list has no × of its own: it would stand beside the
        // items' ×s and look as theirs do. Its items taken out, the last
        // takes the line out with it.
        if (kind === 'own') return;
        if (kind === 'draft') {
            // The draft is not written yet: its × throws it away, and the inherited list shows again.
            this.removeButton(row, key, shut || locked, () => { this.drafts.delete(folded); });
            return;
        }
        this.sourceLabel(row, task, key);
        this.hideButton(row, key, shut || locked);
        if (shut || locked) return;
        const makeOwn = row.createEl('button', { cls: 'task-hub__make-own', text: t('modal.hub.makeOwnList'), attr: { type: 'button' } });
        // The focus is not put in the draft: a tap on the button brings up no keyboard.
        makeOwn.addEventListener('click', () => {
            this.drafts.set(folded, [...items]);
            this.render(true);
        });
    }

    /** The × that takes the row's own property out (or throws a draft away), and builds the rows anew. */
    private removeButton(row: HTMLElement, key: string, disabled: boolean, remove: () => void): void {
        const removeBtn = row.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove task-hub__prop-remove' });
        setIcon(removeBtn.createSpan(), 'x');
        removeBtn.setAttribute('aria-label', t('modal.hub.removeProperty', { key }));
        removeBtn.disabled = disabled;
        removeBtn.addEventListener('click', () => {
            remove();
            // 構造コミット: 楽観 model から行を即時再構築
            this.render(true);
        });
    }

    /** Where an inherited value is written, opened from the row. */
    private sourceLabel(row: HTMLElement, task: Task, key: string): void {
        const source = CascadeSource.forProperty(task, key);
        const sourceEl = row.createSpan({ cls: 'task-hub__source', text: this.ctx.sourceLabel(source) });
        sourceEl.addEventListener('click', () => this.ctx.openSource(copy => CascadeSource.lineOfProperty(copy, key)));
    }

    /** The values offered for the property `key`, as spelled. */
    private candidates(key: string): string[] {
        return FilterValueCollector.collectPropertySpellingsForKey(this.ctx.index.getTasks(), key);
    }

    /**
     * Write `items` as the row's own list of the property `key` (none takes
     * its line out), the draft written so let go, and build the rows anew
     * with the focus at `focus` in the list.
     */
    private writeList(folded: string, key: string, items: PropertyScalar[], focus?: ListFocus): void {
        this.drafts.delete(folded);
        if (items.length === 0) void this.remove(key);
        else void this.setValue(key, { type: 'list', items });
        if (focus !== undefined) this.focusAfter = { folded, focus };
        this.render(true);
    }

    /** A list of values under `input`, closed when the rows are built anew. */
    private offer(input: HTMLInputElement, opts: ValueSuggestOptions): ValueSuggest {
        const suggest = new ValueSuggest(this.ctx.app, input, opts);
        this.suggests.push(suggest);
        return suggest;
    }

    /**
     * Write `raw` as the task's own value of the property `key`, its case
     * aside: a line the task has keeps its key as written, and a new line
     * takes `key`.
     */
    private set(key: string, raw: string): Promise<boolean> | undefined {
        return this.setValue(key, PropertyValues.fromText(raw));
    }

    /** Write `value` as the task's own value of the property `key`, its key kept as {@link set} keeps it. */
    private setValue(key: string, value: PropertyValue): Promise<boolean> | undefined {
        const own = this.ctx.getTask().properties ?? {};
        const written = PropertyKey.get(own, key)?.key ?? key;
        return this.commit({ ...own, [PropertyKey.fold(key)]: { key: written, value } });
    }

    /** Take the task's own line of the property `key` out, its case aside: the value above comes through. */
    private remove(key: string): Promise<boolean> | undefined {
        const next = { ...(this.ctx.getTask().properties ?? {}) };
        delete next[PropertyKey.fold(key)];
        return this.commit(next);
    }

    private commit(props: Properties): Promise<boolean> | undefined {
        if (this.ctx.isShut()) return undefined;
        return this.ctx.queue(TaskUpdateBuilder.customProperties(this.ctx.getTask(), props));
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

/**
 * A value as its field shows it: as the line spells it (`"123"` a text,
 * `123` a number), since what the field holds is what is written. A list
 * has a field of its own (`PropertyListField`), and never shows here.
 */
function shownText(value: PropertyValue): string {
    return value.type === 'list' ? PropertyValues.display(value) : PropertyValues.spelling(value);
}
