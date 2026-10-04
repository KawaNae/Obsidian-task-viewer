import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { PropertyValue } from '../../../types';
import { getEffectiveProperties } from '../../../services/data/EffectiveProperties';
import { PropertyValues } from '../../../services/parsing/utils/PropertyValues';
import { FilterValueCollector } from '../../../services/filter/FilterValueCollector';
import { PropertyKeyInput } from '../../../services/parsing/utils/PropertyKeyInput';
import { FreeText } from '../../../utils/values/TextValues';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { createFormRow } from '../../form/formRow';
import { onFormEnter } from '../../form/formEnter';
import { bindField } from '../../form/bindField';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import type { FieldGroupContext, HubField } from './FieldGroupContext';

/**
 * カスタムプロパティ行。
 * - own キー: value 編集可 + 行削除ボタン
 * - cascade 由来のみのキー: グレー行。value を編集し確定すると own 上書きに昇格
 *
 * 追加行のキーは `PropertyKeyInput` で読み（`:`、`[`、`]` と予約されたキーを
 * 拒む）、読めないキーは欄の下に理由を出して足さない。理由は打ち直すと
 * 消え、ほかの欄の確定では消えない。行の増減で組み直しても、追加行の
 * 打ちかけの字は残す。
 */
export class PropertiesFieldGroup {
    private sectionEl: HTMLElement;
    private addKeyInput: HTMLInputElement | null = null;
    private addSays: HTMLElement | null = null;
    /** custom プロパティ行の value input（focus('<key>') 用）と、その行の文の枠 */
    private valueInputs = new Map<string, HTMLInputElement>();
    private valueSays = new Map<string, HTMLElement>();
    /** What is typed in the add row and not yet added: kept across a rebuild. */
    private draft = { key: '', value: '' };

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        this.sectionEl = container.createDiv({ cls: 'task-hub__props' });
        this.render(true);
    }

    render(force = false): void {
        if (!force && this.sectionEl.contains(this.sectionEl.ownerDocument.activeElement)) return;
        this.sectionEl.empty();
        this.valueInputs.clear();
        this.valueSays.clear();

        const task = this.ctx.getTask();
        const shut = this.ctx.isShut();

        // render 時スナップショット。表示判定（isOwn / pv）専用 — commit の
        // merge base には使わない。focus ガードで rebuild がスキップされる間に
        // 他行の commit が echo されると陳腐化するため、各 closure は
        // ctx.getTask().properties を発火時に読む（tags と同じ規則）。
        const own = task.properties ?? {};
        const effective = getEffectiveProperties(task);
        const keys = this.ctx.plugin.settings.scopeKeys;

        for (const [key, pv] of Object.entries(effective)) {
            const isOwn = key in own;

            const { row, says } = createFormRow(this.sectionEl, key);
            if (!isOwn) row.addClass('task-hub__row--cascade');
            this.valueSays.set(key, says);

            const valueInput = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
            valueInput.value = pv.value;
            valueInput.disabled = shut;
            this.valueInputs.set(key, valueInput);

            this.ctx.attachSuggest(valueInput, valueInput, {
                getCandidates: (q) => FilterValueCollector
                    .collectPropertyValuesForKey(this.ctx.index.getTasks(), key)
                    .filter(v => !q || v.toLowerCase().includes(q.toLowerCase())),
                onPick: (val) => { valueInput.value = val; value.commit(); },
            });
            // The value the row shows: its own, or the inherited one (left as it is, no own value is made).
            const value = bindField(valueInput, {
                codec: FreeText,
                current: () => (isOwn ? this.ctx.getTask().properties?.[key]?.value ?? '' : pv.value),
                commit: (raw) => this.commit({ ...(this.ctx.getTask().properties ?? {}), [key]: PropertyValues.fromText(raw) }),
                issues: () => { /* any text is a value */ },
            });

            if (isOwn) {
                const removeBtn = row.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove' });
                setIcon(removeBtn.createSpan(), 'x');
                removeBtn.setAttribute('aria-label', t('modal.hub.removeProperty', { key }));
                removeBtn.disabled = shut;
                removeBtn.addEventListener('click', () => {
                    const next = { ...(this.ctx.getTask().properties ?? {}) };
                    delete next[key];
                    this.commit(next);
                    // 構造コミット: 楽観 model から行を即時再構築
                    this.ctx.stack.closeAll();
                    this.render(true);
                });
            } else if (!isOwn) {
                const source = CascadeSource.forProperty(this.ctx.app, task, keys, key, pv.value);
                const sourceEl = row.createSpan({ cls: 'task-hub__source', text: this.ctx.sourceLabel(source) });
                sourceEl.addEventListener('click', () => this.ctx.jumpToFile());
            }
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

        // 候補: 既存キー（vault 全体）から未使用のもの / 値はキーに応じて
        this.ctx.attachSuggest(keyInput, keyInput, {
            getCandidates: (q) => {
                const used = new Set(Object.keys(effective));
                return FilterValueCollector.collectPropertyKeys(this.ctx.index.getTasks())
                    .filter(k => !used.has(k))
                    .filter(k => !q || k.toLowerCase().includes(q.toLowerCase()));
            },
            onPick: (val) => { keyInput.value = val; valueInput.focus(); },
        });
        this.ctx.attachSuggest(valueInput, valueInput, {
            getCandidates: (q) => {
                const key = keyInput.value.trim();
                if (!key) return [];
                return FilterValueCollector
                    .collectPropertyValuesForKey(this.ctx.index.getTasks(), key)
                    .filter(v => !q || v.toLowerCase().includes(q.toLowerCase()));
            },
            onPick: (val) => { valueInput.value = val; commitAdd(); },
        });

        const commitAdd = () => {
            const key = readKey();
            if (!key?.ok) return;
            const raw = valueInput.value;
            this.commit({ ...(this.ctx.getTask().properties ?? {}), [key.value]: PropertyValues.fromText(raw) });
            this.draft = { key: '', value: '' };
            this.ctx.stack.closeAll();
            this.render(true);
        };
        for (const input of [keyInput, valueInput]) {
            onFormEnter(input, commitAdd);
        }
        // blur 確定ルール: key があれば value 空でも確定（空値プロパティは有効）。
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
    }

    private commit(props: Record<string, PropertyValue>): void {
        if (this.ctx.isShut()) return;
        this.ctx.queue(TaskUpdateBuilder.customProperties(this.ctx.getTask(), props));
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
        const key = at.slice('prop:'.length);
        const input = this.valueInputs.get(key);
        const message = this.valueSays.get(key);
        return input && message ? { input, message } : null;
    }

    /** The value field of the property `key`; the new property's key field when there is none, or no key is named. */
    fieldElement(key?: string): HTMLElement | null {
        return (key ? this.valueInputs.get(key) : undefined) ?? this.addKeyInput ?? null;
    }
}
