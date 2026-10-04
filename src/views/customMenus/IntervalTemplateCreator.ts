/**
 * IntervalTemplateCreator
 *
 * Popover UI for creating interval timer templates. Uses PopoverStack so the
 * root popover and the child icon-picker behave correctly across popout
 * windows (host doc/win resolved from the anchor) and follow window resize.
 */

import { type App, setIcon, getIconIds } from 'obsidian';
import { t } from '../../i18n';
import { IntervalTemplateWriter } from '../../timer/IntervalTemplateWriter';
import type { IntervalGroup, IntervalSegment } from '../../timer/IntervalMath';
import type { IntervalTemplate } from '../../timer/IntervalTemplateLoader';
import { defaultSegmentLabel } from '../../timer/IntervalMath';
import { PopoverStack } from '../sharedUI/PopoverStack';
import type { PopoverShell } from '../sharedUI/PopoverShell';
import { OverlayShell } from '../sharedUI/OverlayShell';
import type { TemplateNoteSaver } from '../../services/template/TemplateNote';
import { refusalText } from '../../services/operations/WriteAnswer';
import { bindField, type BoundField } from '../../modals/form/bindField';
import { IssueBoard, readIssue, type FormIssue, type IssueSlot } from '../../modals/form/FormIssue';
import { IntInput, type NumberRange } from '../../utils/values/NumberValues';

export interface TemplateCreatorCallbacks {
    onSaved: (filePath: string) => void;
}

interface FormSegment {
    label: string;
    hours: number;
    minutes: number;
    seconds: number;
    type: IntervalSegment['type'];
}

/** The type a segment's type button turns to. */
const NEXT_SEGMENT_TYPE: Record<IntervalSegment['type'], IntervalSegment['type']> = {
    work: 'break',
    break: 'prepare',
    prepare: 'work',
};

interface FormGroup {
    repeatCount: number;
    segments: FormSegment[];
}

interface FormState {
    name: string;
    icon: string;
    groups: FormGroup[];
}

/**
 * The parts of the form an issue is of: the name, a group (its repeat), a
 * segment (its length), and each number of a segment's length. A segment's
 * issues and its numbers' are said under its row.
 */
type SegmentPart = 'hours' | 'minutes' | 'seconds';
type CreatorField = 'name' | `group:${number}` | `segment:${number}:${number}` | `segment:${number}:${number}:${SegmentPart}`;

/** The numbers of the form, each a whole number in its range; not moved to the range's end. */
const REPEAT: NumberRange = { min: 0 };
const HOURS: NumberRange = { min: 0 };
const MINUTES: NumberRange = { min: 0, max: 59 };
const SECONDS: NumberRange = { min: 0, max: 59 };

export class IntervalTemplateCreator {
    private overlay = new OverlayShell();
    private stack = new PopoverStack();
    private rootEl: HTMLElement | null = null;
    private iconShell: PopoverShell | null = null;
    private state: FormState = this.createDefaultState();
    private callbacks: TemplateCreatorCallbacks | null = null;
    private folderPath = '';
    private editingFilePath: string | null = null;
    /** What the form says, as drawn now; drawn anew with the form. */
    private issues: IssueBoard<CreatorField> | null = null;
    /** Where each part of the form as drawn now says its issues. */
    private slots = new Map<CreatorField, IssueSlot>();
    /** The number fields as drawn now: a save commits what they hold, and does not go while one does not read. */
    private numbers: BoundField<number>[] = [];

    constructor(
        private app: App,
        private notes: TemplateNoteSaver,
    ) {}

    isOpen(): boolean {
        return this.overlay.isOpen();
    }

    show(anchorEl: HTMLElement, folderPath: string, callbacks: TemplateCreatorCallbacks): void {
        this.folderPath = folderPath;
        this.callbacks = callbacks;
        this.editingFilePath = null;
        this.state = this.createDefaultState();
        this.openPopover(anchorEl);
    }

    showEdit(anchorEl: HTMLElement, folderPath: string, template: IntervalTemplate, callbacks: TemplateCreatorCallbacks): void {
        this.folderPath = folderPath;
        this.callbacks = callbacks;
        this.editingFilePath = template.filePath;
        this.state = this.templateToFormState(template);
        this.openPopover(anchorEl);
    }

    private openPopover(anchorEl: HTMLElement): void {
        this.overlay.open({
            mode: 'anchored',
            anchor: { kind: 'element', element: anchorEl },
            panelClass: 'template-creator',
            childStack: this.stack,
            keymap: this.app.keymap,
            build: (bodyEl) => {
                this.rootEl = bodyEl;
                this.renderContent();
            },
            onClose: () => {
                this.stack.closeAll();
                this.rootEl = null;
                this.iconShell = null;
                this.issues = null;
                this.slots.clear();
                this.numbers = [];
            },
        });
    }

    close(): void {
        this.overlay.close();
    }

    // ── Render ──

    /**
     * Draw the form from its state. What it said is not kept: a field drawn
     * anew shows its value, and the next save says again what keeps it.
     */
    private renderContent(): void {
        if (!this.rootEl) return;
        this.rootEl.empty();
        this.slots.clear();
        this.numbers = [];

        this.renderHeader(this.rootEl);
        const body = this.rootEl.createDiv('template-creator__body');
        this.renderNameField(body);
        this.renderIconField(body);
        this.renderGroups(body);
        this.renderFooter(this.rootEl);
    }

    private refreshContent(): void {
        if (!this.rootEl) return;
        this.renderContent();
    }

    private renderHeader(parent: HTMLElement): void {
        const header = parent.createDiv('template-creator__header');
        header.createSpan({
            cls: 'template-creator__title',
            text: this.editingFilePath ? t('timer.editTemplate') : t('timer.newTemplate'),
        });

        const closeBtn = header.createEl('button', { cls: 'tv-icon-btn template-creator__close-btn' });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => this.close());
    }

    private renderNameField(parent: HTMLElement): void {
        const field = parent.createDiv('template-creator__field');
        field.createEl('label', { cls: 'template-creator__label', text: t('timer.templateName') });
        const input = field.createEl('input', {
            cls: 'tv-ctrl__text-input',
            type: 'text',
            placeholder: t('timer.template.namePlaceholder'),
        });
        input.value = this.state.name;
        input.addEventListener('input', () => {
            this.state.name = input.value;
            this.edited();
        });
        this.slots.set('name', { input, message: field.createDiv({ cls: 'tv-form__says' }) });
    }

    private renderIconField(parent: HTMLElement): void {
        const field = parent.createDiv('template-creator__field');
        field.createEl('label', { cls: 'template-creator__label', text: t('timer.templateIcon') });

        const row = field.createDiv('template-creator__icon-row');

        const input = row.createEl('input', {
            cls: 'tv-ctrl__text-input',
            type: 'text',
            placeholder: 'rotate-cw',
        });
        input.value = this.state.icon;

        const preview = row.createSpan('template-creator__icon-preview');
        const updatePreview = () => {
            preview.empty();
            const iconName = this.state.icon.trim() || 'rotate-cw';
            setIcon(preview, iconName);
        };
        updatePreview();

        input.addEventListener('input', () => {
            this.state.icon = input.value;
            updatePreview();
        });

        const browseBtn = row.createEl('button', {
            cls: 'template-creator__browse-btn',
            text: t('timer.template.browse'),
        });
        browseBtn.addEventListener('click', () => {
            this.showIconPopover(browseBtn, (iconName) => {
                this.state.icon = iconName;
                input.value = iconName;
                updatePreview();
            });
        });
    }

    private showIconPopover(anchorEl: HTMLElement, onSelect: (iconName: string) => void): void {
        const allIcons = getIconIds()
            .filter(id => id.startsWith('lucide-'))
            .map(id => id.slice(7)); // remove 'lucide-' prefix

        this.iconShell = this.stack.openChild({
            anchor: { kind: 'element', element: anchorEl },
            className: 'template-creator__icon-popover',
            build: (popover) => {
                const searchInput = popover.createEl('input', {
                    cls: 'template-creator__icon-search',
                    type: 'text',
                    placeholder: t('timer.template.searchIcons'),
                });

                const grid = popover.createDiv('template-creator__icon-grid');

                const renderIcons = (filter: string) => {
                    grid.empty();
                    const filtered = filter
                        ? allIcons.filter(name => name.includes(filter.toLowerCase()))
                        : allIcons;
                    const limited = filtered.slice(0, 200); // limit for performance

                    for (const name of limited) {
                        const btn = grid.createEl('button', { cls: 'tv-icon-btn template-creator__icon-option' });
                        btn.setAttribute('aria-label', name);
                        setIcon(btn.createSpan(), name);
                        btn.addEventListener('click', () => {
                            onSelect(name);
                            if (this.iconShell) this.stack.close(this.iconShell);
                        });
                    }
                };

                renderIcons('');
                searchInput.addEventListener('input', () => renderIcons(searchInput.value));
            },
            onClose: () => {
                this.iconShell = null;
            },
        });
    }

    private renderGroups(parent: HTMLElement): void {
        const groupsContainer = parent.createDiv('template-creator__groups');

        this.state.groups.forEach((group, gi) => {
            this.renderGroup(groupsContainer, group, gi);
        });

        const addBtn = groupsContainer.createEl('button', { cls: 'template-creator__add-btn' });
        const addIcon = addBtn.createSpan('template-creator__add-btn-icon');
        setIcon(addIcon, 'plus');
        addBtn.createSpan({ text: t('timer.template.addGroup') });
        addBtn.addEventListener('click', () => {
            this.state.groups.push({
                repeatCount: 1,
                segments: [{ label: 'Work', hours: 0, minutes: 25, seconds: 0, type: 'work' }],
            });
            this.refreshContent();
        });
    }

    private renderGroup(parent: HTMLElement, group: FormGroup, groupIndex: number): void {
        const groupEl = parent.createDiv('template-creator__group');

        // Group header
        const header = groupEl.createDiv('template-creator__group-header');
        header.createSpan({ cls: 'template-creator__group-label', text: t('timer.template.groupN', { n: groupIndex + 1 }) });

        const repeatWrap = header.createSpan('template-creator__repeat-wrap');
        repeatWrap.createSpan({ cls: 'template-creator__repeat-label', text: t('timer.template.repeat') });
        const groupSays = groupEl.createDiv({ cls: 'tv-form__says' });
        this.createNumericInput(repeatWrap, `group:${groupIndex}`, groupSays, {
            range: REPEAT, placeholder: '1',
            cls: 'tv-ctrl__text-input template-creator__repeat-input',
            get: () => group.repeatCount,
            set: (v) => { group.repeatCount = v; },
        });

        if (this.state.groups.length > 1) {
            const removeBtn = header.createEl('button', { cls: 'tv-icon-btn template-creator__remove-btn' });
            setIcon(removeBtn, 'trash-2');
            removeBtn.addEventListener('click', () => {
                this.state.groups.splice(groupIndex, 1);
                this.refreshContent();
            });
        }

        // Segments
        const segmentsEl = groupEl.createDiv('template-creator__segments');

        group.segments.forEach((seg, si) => {
            this.renderSegment(segmentsEl, seg, group, groupIndex, si);
        });

        const addSegBtn = segmentsEl.createEl('button', { cls: 'template-creator__add-btn template-creator__add-btn--inline' });
        const addIcon = addSegBtn.createSpan('template-creator__add-btn-icon');
        setIcon(addIcon, 'plus');
        addSegBtn.createSpan({ text: t('timer.template.addSegment') });
        addSegBtn.addEventListener('click', () => {
            group.segments.push({ label: 'Work', hours: 0, minutes: 5, seconds: 0, type: 'work' });
            this.refreshContent();
        });
    }

    private renderSegment(parent: HTMLElement, seg: FormSegment, group: FormGroup, groupIndex: number, segIndex: number): void {
        const row = parent.createDiv('template-creator__segment');
        const at = `segment:${groupIndex}:${segIndex}` as const;
        const says = parent.createDiv({ cls: 'tv-form__says' });
        this.slots.set(at, { input: null, message: says });

        // Label
        const labelInput = row.createEl('input', {
            cls: 'tv-ctrl__text-input template-creator__seg-label',
            type: 'text',
            placeholder: t('timer.template.labelPlaceholder'),
        });
        labelInput.value = seg.label;
        labelInput.addEventListener('input', () => { seg.label = labelInput.value; });

        // Duration: hh : mm : ss
        const durWrap = row.createDiv('template-creator__duration');

        this.createNumericInput(durWrap, `${at}:hours`, says, {
            range: HOURS, placeholder: t('timer.template.hoursAbbr'),
            get: () => seg.hours,
            set: (v) => { seg.hours = v; },
        });

        durWrap.createSpan({ cls: 'template-creator__dur-sep', text: ':' });

        this.createNumericInput(durWrap, `${at}:minutes`, says, {
            range: MINUTES, placeholder: t('timer.template.minutesAbbr'),
            get: () => seg.minutes,
            set: (v) => { seg.minutes = v; },
        });

        durWrap.createSpan({ cls: 'template-creator__dur-sep', text: ':' });

        this.createNumericInput(durWrap, `${at}:seconds`, says, {
            range: SECONDS, placeholder: t('timer.template.secondsAbbr'),
            get: () => seg.seconds,
            set: (v) => { seg.seconds = v; },
        });

        // Type button: cycles work → break → prepare → work
        const typeLabel = seg.type === 'work' ? t('timer.template.typeWork')
            : seg.type === 'break' ? t('timer.template.typeBreak')
            : t('timer.template.typePrepare');
        const typeBtn = row.createEl('button', {
            cls: `template-creator__type-btn template-creator__type-btn--${seg.type}`,
            text: typeLabel,
        });
        typeBtn.addEventListener('click', () => {
            seg.type = NEXT_SEGMENT_TYPE[seg.type];
            this.refreshContent();
        });

        // Remove segment
        if (group.segments.length > 1) {
            const removeBtn = row.createEl('button', { cls: 'tv-icon-btn template-creator__remove-btn' });
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', () => {
                group.segments.splice(segIndex, 1);
                this.refreshContent();
            });
        }
    }

    private renderFooter(parent: HTMLElement): void {
        const footer = parent.createDiv('template-creator__footer');
        // The form's issues (a write refused) beside the button; a part's under it.
        const formSays = footer.createDiv({ cls: 'tv-form__says template-creator__says' });
        this.issues = new IssueBoard<CreatorField>({ field: (at) => this.slots.get(at) ?? null, form: formSays });

        const isEditing = !!this.editingFilePath;
        const saveBtn = footer.createEl('button', {
            cls: 'template-creator__save-btn',
            text: isEditing ? t('modal.save') : t('modal.create'),
        });
        saveBtn.addEventListener('click', async () => {
            const issues = this.issues;
            if (!issues) return;
            // What is typed in a number is committed, as a blur does; one that
            // does not read keeps the form, said under its row.
            for (const field of this.numbers) field.commit();
            if (this.numbers.some(field => field.pending()?.ok === false)) return;
            const checked = this.validate();
            issues.set('check', checked);
            if (checked.length > 0) return;

            const groups = this.buildGroups();
            const writer = new IntervalTemplateWriter(this.app, this.notes);
            const data = {
                name: this.state.name.trim(),
                icon: this.state.icon.trim() || 'rotate-cw',
                groups,
            };

            // 書けなかったときは、開いたまま理由をボタンの横に1回だけ出し、
            // もう一度保存できるようにする（通知は出さない: tellRefusal false）。
            const refused = (text: string) => issues.set('write', [{ at: 'form', tone: 'error', text }]);
            try {
                const answer = isEditing
                    ? await writer.updateTemplate(this.editingFilePath!, data, { tellRefusal: false })
                    : await writer.saveTemplate(this.folderPath, data, { tellRefusal: false });
                if (!answer.written || !answer.file) {
                    refused(refusalText(answer.written ? null : answer.refused));
                    return;
                }
                this.close();
                this.callbacks?.onSaved(answer.file.path);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                refused(isEditing
                    ? t('timer.template.saveFailed', { error: msg })
                    : t('timer.template.createFailed', { error: msg }));
            }
        });
    }

    // ── Helpers ──

    /**
     * A whole number of the form in `range` (`IntInput`, bound by
     * `bindField`): what does not read (empty, `1.5`, out of range) is said
     * in `message` (under its row), the field marked, and kept as typed,
     * not moved to the range's end; a blur or the form's Enter puts a value
     * that reads in the state.
     */
    private createNumericInput(
        parent: HTMLElement,
        at: CreatorField,
        message: HTMLElement,
        opts: { range: NumberRange; placeholder?: string; cls?: string; get(): number; set(v: number): void },
    ): HTMLInputElement {
        const input = parent.createEl('input', {
            cls: opts.cls ?? 'tv-ctrl__text-input template-creator__dur-input',
            type: 'text',
        });
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.inputMode = 'numeric';
        input.value = String(opts.get());
        input.addEventListener('focus', () => input.select());
        this.slots.set(at, { input, message });
        this.numbers.push(bindField(input, {
            codec: IntInput.codec(opts.range),
            current: () => opts.get(),
            commit: (value) => {
                opts.set(value);
                this.edited();
            },
            issues: (issue) => this.issues?.set(`read:${at}`, readIssue(at, issue)),
        }));
        return input;
    }

    /** The form was changed: what a save said of it (the checks, a write refused) is taken back. */
    private edited(): void {
        this.issues?.set('check', []);
        this.issues?.set('write', []);
    }

    private templateToFormState(template: IntervalTemplate): FormState {
        return {
            name: template.name,
            icon: template.icon,
            groups: template.groups.map(g => ({
                repeatCount: g.repeatCount,
                segments: g.segments.map(s => ({
                    label: s.label,
                    hours: Math.floor(s.durationSeconds / 3600),
                    minutes: Math.floor((s.durationSeconds % 3600) / 60),
                    seconds: s.durationSeconds % 60,
                    type: s.type,
                })),
            })),
        };
    }

    private createDefaultState(): FormState {
        return {
            name: '',
            icon: 'rotate-cw',
            groups: [{
                repeatCount: 1,
                segments: [
                    { label: 'Work', hours: 0, minutes: 25, seconds: 0, type: 'work' },
                    { label: 'Break', hours: 0, minutes: 5, seconds: 0, type: 'break' },
                ],
            }],
        };
    }

    private buildGroups(): IntervalGroup[] {
        return this.state.groups.map(g => ({
            repeatCount: g.repeatCount,
            segments: g.segments.map(s => ({
                label: s.label.trim() || defaultSegmentLabel(s.type),
                durationSeconds: s.hours * 3600 + s.minutes * 60 + s.seconds,
                type: s.type,
            })),
        }));
    }

    /** What keeps the form from being saved, each said where it is: a name, a group with no segment, a segment of no length. */
    private validate(): FormIssue<CreatorField>[] {
        const issues: FormIssue<CreatorField>[] = [];
        if (!this.state.name.trim()) issues.push({ at: 'name', tone: 'error', text: t('timer.template.errNameRequired') });
        this.state.groups.forEach((group, gi) => {
            if (group.segments.length === 0) {
                issues.push({ at: `group:${gi}`, tone: 'error', text: t('timer.template.errGroupNeedsSegment') });
            }
            group.segments.forEach((seg, si) => {
                const total = seg.hours * 3600 + seg.minutes * 60 + seg.seconds;
                if (total <= 0) issues.push({ at: `segment:${gi}:${si}`, tone: 'error', text: t('timer.template.errDurationPositive') });
            });
        });
        return issues;
    }

}
