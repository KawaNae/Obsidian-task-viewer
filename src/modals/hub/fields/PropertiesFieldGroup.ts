import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import { isTvFile, type PropertyValue } from '../../../types';
import { getEffectiveProperties } from '../../../services/data/EffectiveProperties';
import { ChildLineClassifier } from '../../../services/parsing/utils/ChildLineClassifier';
import { FilterValueCollector } from '../../../services/filter/FilterValueCollector';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { createFormRow } from '../../form/formRow';
import type { FieldGroupContext } from './FieldGroupContext';

/**
 * カスタムプロパティ行。
 * - own キー: value 編集可 + 行削除ボタン
 * - cascade 由来のみのキー: グレー行。value を編集し確定すると own 上書きに昇格
 * - tvFile の array 型 own キー: readonly（join 平坦化の round-trip 破壊防止）
 */
export class PropertiesFieldGroup {
    private sectionEl: HTMLElement;
    private addKeyInput: HTMLInputElement | null = null;
    /** custom プロパティ行の value input（focus('<key>') 用） */
    private valueInputs = new Map<string, HTMLInputElement>();

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        this.sectionEl = container.createDiv({ cls: 'task-hub__props' });
        this.render(true);
    }

    render(force = false): void {
        if (!force && this.sectionEl.contains(document.activeElement)) return;
        this.sectionEl.empty();
        this.valueInputs.clear();

        const task = this.ctx.getTask();
        const missing = this.ctx.isMissing();

        // render 時スナップショット。表示判定（isOwn / pv）専用 — commit の
        // merge base には使わない。focus ガードで rebuild がスキップされる間に
        // 他行の commit が echo されると陳腐化するため、各 closure は
        // ctx.getTask().properties を発火時に読む（tags と同じ規則）。
        const own = task.properties ?? {};
        const effective = getEffectiveProperties(task);
        const keys = this.ctx.plugin.settings.tvFileKeys;

        for (const [key, pv] of Object.entries(effective)) {
            const isOwn = key in own;
            const arrayReadOnly = isOwn && isTvFile(task) && pv.type === 'array';

            const { row } = createFormRow(this.sectionEl, key);
            if (!isOwn) row.addClass('task-hub__row--cascade');

            const valueInput = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
            valueInput.value = pv.value;
            valueInput.disabled = missing || arrayReadOnly;
            this.valueInputs.set(key, valueInput);
            if (arrayReadOnly) valueInput.setAttribute('aria-label', t('modal.hub.arrayReadOnly'));

            const commitValue = () => {
                const raw = valueInput.value;
                const live = this.ctx.getTask().properties ?? {};
                if (isOwn && raw === live[key]?.value) return;
                if (!isOwn && raw === pv.value) return; // cascade 値のまま → 上書きを作らない
                this.commit({ ...live, [key]: { value: raw, type: ChildLineClassifier.inferType(raw) } });
            };
            if (!arrayReadOnly) {
                this.ctx.attachSuggest(valueInput, valueInput, {
                    getCandidates: (q) => FilterValueCollector
                        .collectPropertyValuesForKey(this.ctx.readService.getTasks(), key)
                        .filter(v => !q || v.toLowerCase().includes(q.toLowerCase())),
                    onPick: (val) => { valueInput.value = val; commitValue(); },
                });
            }
            valueInput.addEventListener('blur', commitValue);
            valueInput.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) commitValue();
            });

            if (isOwn && !arrayReadOnly) {
                const removeBtn = row.createEl('button', { cls: 'tv-ctrl__pill-remove' });
                setIcon(removeBtn.createSpan(), 'x');
                removeBtn.setAttribute('aria-label', t('modal.hub.removeProperty', { key }));
                removeBtn.disabled = missing;
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
        const { row: addRow, labelEl: addLabelEl } = createFormRow(this.sectionEl, '');
        addRow.addClass('task-hub__prop-add');
        addLabelEl.addClass('tv-form__label--input');
        const keyInput = addLabelEl.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyKey'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        const valueInput = addRow.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyValue'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
        });
        keyInput.disabled = missing;
        valueInput.disabled = missing;
        this.addKeyInput = keyInput;

        // 候補: 既存キー（vault 全体）から未使用のもの / 値はキーに応じて
        this.ctx.attachSuggest(keyInput, keyInput, {
            getCandidates: (q) => {
                const used = new Set(Object.keys(effective));
                return FilterValueCollector.collectPropertyKeys(this.ctx.readService.getTasks())
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
                    .collectPropertyValuesForKey(this.ctx.readService.getTasks(), key)
                    .filter(v => !q || v.toLowerCase().includes(q.toLowerCase()));
            },
            onPick: (val) => { valueInput.value = val; commitAdd(); },
        });

        const commitAdd = () => {
            const key = keyInput.value.trim();
            if (!key) return;
            const reserved = new Set<string>(Object.values(this.ctx.plugin.settings.tvFileKeys));
            reserved.add('tags');
            reserved.add('position');
            keyInput.classList.remove('tv-ctrl__text-input--invalid');
            if (reserved.has(key)) {
                keyInput.classList.add('tv-ctrl__text-input--invalid');
                this.ctx.showFormError(t('modal.hub.reservedKey', { key }));
                return;
            }
            const raw = valueInput.value;
            this.commit({ ...(this.ctx.getTask().properties ?? {}), [key]: { value: raw, type: ChildLineClassifier.inferType(raw) } });
            keyInput.value = '';
            valueInput.value = '';
            this.ctx.stack.closeAll();
            this.render(true);
        };
        for (const input of [keyInput, valueInput]) {
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) commitAdd();
            });
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
    }

    private commit(props: Record<string, PropertyValue>): void {
        if (this.ctx.isMissing()) return;
        this.ctx.queue(TaskUpdateBuilder.customProperties(this.ctx.getTask(), props));
    }

    /** 外部変更（echo）の取り込み。focus 中はスキップする既存の render ガードに乗る。 */
    refresh(): void {
        this.render();
    }

    setEnabled(_enabled: boolean): void {
        this.render(true);
    }

    focus(key?: string): void {
        const target = key ? (this.valueInputs.get(key) ?? this.addKeyInput) : this.addKeyInput;
        target?.focus();
    }
}
