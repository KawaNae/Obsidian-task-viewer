import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import { getEffectiveTags } from '../../../services/data/EffectiveProperties';
import { TagExtractor } from '../../../services/parsing/utils/TagExtractor';
import { FilterValueCollector } from '../../../services/filter/FilterValueCollector';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { createFormRow } from '../../form/formRow';
import { bindField } from '../../form/bindField';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { TagInput } from '../../../services/parsing/utils/TagInput';
import { optional } from '../../../utils/values/Read';
import { PROPERTY_ICONS } from '../../../constants/propertyIcons';
import type { FieldGroupContext } from './FieldGroupContext';

const ADD_TAGS = optional(TagInput);

/**
 * タグ chips + 追加 input。effective 表示のうち:
 * - content 由来 #tag → ロック chip（編集は name フィールドの責務）
 * - own property 宣言 → ×付き chip（削除可）
 * - cascade 由来のみ → グレーロック chip + 出所（負の上書きは提供しない）
 *
 * 追加の欄は `TagInput` で読み（空白で区切った語、`#` は有っても無くても
 * よい）、1つのタグに読めない語は欄の下に理由を出して足さない。chip の増減で
 * 組み直しても、打ちかけの字は残す。
 */
export class TagsFieldGroup {
    private sectionEl: HTMLElement;
    private addInput: HTMLInputElement | null = null;
    private addWrap: HTMLElement | null = null;
    private says: HTMLElement | null = null;
    /** What is typed in the add field and not yet added: kept across a rebuild. */
    private draft = '';

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        this.sectionEl = container.createDiv({ cls: 'task-hub__tags' });
        this.render(true);
    }

    render(force = false): void {
        if (!force && this.sectionEl.contains(this.sectionEl.ownerDocument.activeElement)) return;
        this.sectionEl.empty();

        const task = this.ctx.getTask();
        const shut = this.ctx.isShut();
        const contentTags = new Set(TagExtractor.fromContent(task.content ?? ''));
        const ownTags = new Set(task.tags);
        const keys = this.ctx.plugin.settings.scopeKeys;

        // pills（フル幅、行の外）
        const effectiveTags = getEffectiveTags(task);
        if (effectiveTags.length > 0) {
            const chipsEl = this.sectionEl.createDiv({ cls: 'tv-ctrl__pills task-hub__tag-pills' });
            for (const tag of effectiveTags) {
                const chip = chipsEl.createSpan({ cls: 'tv-ctrl__pill task-hub__tag-chip' });
                chip.createSpan({ text: `#${tag}` });
                if (contentTags.has(tag)) {
                    chip.addClass('task-hub__tag-chip--locked');
                    chip.setAttribute('aria-label', t('modal.hub.contentTagLocked'));
                } else if (ownTags.has(tag)) {
                    const removeBtn = chip.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove' });
                    setIcon(removeBtn.createSpan(), 'x');
                    removeBtn.setAttribute('aria-label', t('modal.hub.removeTag', { tag }));
                    removeBtn.disabled = shut;
                    removeBtn.addEventListener('click', () => this.commit(task.tags.filter(x => x !== tag)));
                } else {
                    const source = CascadeSource.forTag(this.ctx.app, task, keys, tag);
                    chip.addClass('task-hub__tag-chip--locked');
                    chip.addClass('task-hub__tag-chip--cascade');
                    chip.setAttribute('aria-label', t('modal.hub.cascadeTagLocked', { source: this.ctx.sourceLabel(source) }));
                }
            }
        }

        // label + input の行（中央揃え — 他フィールドと同じ）
        const { row, says } = createFormRow(this.sectionEl, t('modal.hub.tags'), { icon: PROPERTY_ICONS.tags });
        this.says = says;
        const inputWrap = row.createDiv({ cls: 'tv-ctrl__input-wrap tv-ctrl__input-wrap--glow task-hub__tag-add-wrap tv-form__control' });
        this.addWrap = inputWrap;
        const input = inputWrap.createEl('input', {
            type: 'text',
            placeholder: t('modal.hub.addTag'),
            cls: 'tv-ctrl__input',
        });
        this.addInput = input;
        input.disabled = shut;
        input.value = this.draft;
        input.addEventListener('input', () => { this.draft = input.value; });

        const addTags = (added: readonly string[]) => {
            this.draft = '';
            input.value = '';
            this.commit([...this.ctx.getTask().tags, ...added]);
        };

        this.ctx.attachSuggest(input, inputWrap, {
            getCandidates: (query) => {
                const q = query.toLowerCase().replace(/^#/, '');
                const selected = new Set(getEffectiveTags(this.ctx.getTask()));
                return FilterValueCollector.collectTags(this.ctx.index.getTasks())
                    .filter(v => !selected.has(v))
                    .filter(v => !q || v.toLowerCase().includes(q));
            },
            renderItem: (item, val) => { item.createSpan().setText(`#${val}`); },
            onPick: (val) => addTags([val]),
        });
        // The field stands for nothing: what it reads is added, and it empties.
        bindField(input, {
            codec: ADD_TAGS,
            current: () => undefined,
            commit: (added) => { if (added) addTags(added); },
            issues: (issue) => this.ctx.issues.set('tags', readIssue('tags', issue)),
        });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Backspace' && !input.value) {
                // 空入力での Backspace は末尾の削除可能タグ（own 宣言かつ
                // content 由来でない）を除去する — filter pill と同じ操作感
                const current = this.ctx.getTask();
                const removable = current.tags.filter(x => !contentTags.has(x));
                const last = removable[removable.length - 1];
                if (last) this.commit(current.tags.filter(x => x !== last));
            }
        });
        this.ctx.issues.redraw();
    }

    private commit(tags: string[]): void {
        if (this.ctx.isShut()) return;
        this.ctx.queue(TaskUpdateBuilder.tags(this.ctx.getTask(), tags));
        // 構造コミット（chip の増減）は楽観 model から即時再描画する。
        // echo 待ちだと focus がセクション内にある間 chip が現れ/消えない。
        const restoreFocus = !!this.addInput && this.addInput.ownerDocument.activeElement === this.addInput;
        this.ctx.stack.closeAll();
        this.render(true);
        if (restoreFocus) this.addInput?.focus();
    }

    /** 外部変更（echo）の取り込み。focus 中はスキップする既存の render ガードに乗る。 */
    refresh(): void {
        this.render();
    }

    setEnabled(_enabled: boolean): void {
        // shut は ctx.isShut() 経由で反映されるため、
        // disabled の見た目更新は force rebuild だけで足りる。
        this.render(true);
    }

    /** Where the add field says its issues: its box and the line under its row. */
    slot(): IssueSlot | null {
        return this.addWrap && this.says ? { input: this.addWrap, message: this.says } : null;
    }

    /** The field that adds a tag. */
    fieldElement(): HTMLElement | null {
        return this.addInput ?? null;
    }
}
