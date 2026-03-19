/**
 * IntervalTemplateCreator
 *
 * Popover UI for creating interval timer templates.
 * Follows the FilterMenuComponent popover pattern: position: fixed,
 * appended to document.body, outside-click to close.
 */

import { App, Notice, setIcon, getIconIds } from 'obsidian';
import { t } from '../../i18n';
import { IntervalTemplateWriter } from '../../timer/IntervalTemplateWriter';
import type { IntervalGroup } from '../../timer/TimerInstance';
import type { IntervalTemplate } from '../../timer/IntervalTemplateLoader';

export interface TemplateCreatorCallbacks {
    onSaved: (filePath: string) => void;
}

interface FormSegment {
    label: string;
    hours: number;
    minutes: number;
    seconds: number;
    type: 'work' | 'break' | 'prepare';
}

interface FormGroup {
    repeatCount: number;
    segments: FormSegment[];
}

interface FormState {
    name: string;
    icon: string;
    groups: FormGroup[];
}

export class IntervalTemplateCreator {
    private popoverEl: HTMLElement | null = null;
    private iconPopoverEl: HTMLElement | null = null;
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private iconOutsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private state: FormState = this.createDefaultState();
    private callbacks: TemplateCreatorCallbacks | null = null;
    private folderPath = '';
    private editingFilePath: string | null = null;

    constructor(private app: App) {}

    show(anchorEl: HTMLElement, folderPath: string, callbacks: TemplateCreatorCallbacks): void {
        this.close();
        this.folderPath = folderPath;
        this.callbacks = callbacks;
        this.editingFilePath = null;
        this.state = this.createDefaultState();
        this.openPopover(anchorEl);
    }

    showEdit(anchorEl: HTMLElement, folderPath: string, template: IntervalTemplate, callbacks: TemplateCreatorCallbacks): void {
        this.close();
        this.folderPath = folderPath;
        this.callbacks = callbacks;
        this.editingFilePath = template.filePath;
        this.state = this.templateToFormState(template);
        this.openPopover(anchorEl);
    }

    private openPopover(anchorEl: HTMLElement): void {
        this.popoverEl = document.createElement('div');
        this.popoverEl.className = 'template-creator';

        this.renderContent();
        document.body.appendChild(this.popoverEl);
        this.positionPopover(anchorEl);

        setTimeout(() => {
            this.outsideClickHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (!this.popoverEl) return;
                if (this.popoverEl.contains(target)) return;
                if (this.iconPopoverEl?.contains(target)) return;
                this.close();
            };
            document.addEventListener('pointerdown', this.outsideClickHandler, true);
        }, 0);
    }

    close(): void {
        this.closeIconPopover();
        if (this.popoverEl) {
            this.popoverEl.remove();
            this.popoverEl = null;
        }
        if (this.outsideClickHandler) {
            document.removeEventListener('pointerdown', this.outsideClickHandler, true);
            this.outsideClickHandler = null;
        }
    }

    private closeIconPopover(): void {
        if (this.iconPopoverEl) {
            this.iconPopoverEl.remove();
            this.iconPopoverEl = null;
        }
        if (this.iconOutsideClickHandler) {
            document.removeEventListener('pointerdown', this.iconOutsideClickHandler, true);
            this.iconOutsideClickHandler = null;
        }
    }

    // ── Render ──

    private renderContent(): void {
        if (!this.popoverEl) return;
        this.popoverEl.empty();

        this.renderHeader(this.popoverEl);
        const body = this.popoverEl.createDiv('template-creator__body');
        this.renderNameField(body);
        this.renderIconField(body);
        this.renderGroups(body);
        this.renderFooter(this.popoverEl);
    }

    private refreshContent(): void {
        if (!this.popoverEl) return;
        this.renderContent();
    }

    private renderHeader(parent: HTMLElement): void {
        const header = parent.createDiv('template-creator__header');
        header.createSpan({
            cls: 'template-creator__title',
            text: this.editingFilePath ? t('timer.editTemplate') : t('timer.newTemplate'),
        });

        const closeBtn = header.createEl('button', { cls: 'template-creator__close-btn' });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => this.close());
    }

    private renderNameField(parent: HTMLElement): void {
        const field = parent.createDiv('template-creator__field');
        field.createEl('label', { cls: 'template-creator__label', text: t('timer.templateName') });
        const input = field.createEl('input', {
            cls: 'template-creator__input',
            type: 'text',
            placeholder: 'Template name',
        });
        input.value = this.state.name;
        input.addEventListener('input', () => { this.state.name = input.value; });
    }

    private renderIconField(parent: HTMLElement): void {
        const field = parent.createDiv('template-creator__field');
        field.createEl('label', { cls: 'template-creator__label', text: t('timer.templateIcon') });

        const row = field.createDiv('template-creator__icon-row');

        const input = row.createEl('input', {
            cls: 'template-creator__input',
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
            text: 'Browse',
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
        this.closeIconPopover();

        const allIcons = getIconIds()
            .filter(id => id.startsWith('lucide-'))
            .map(id => id.slice(7)); // remove 'lucide-' prefix

        this.iconPopoverEl = document.createElement('div');
        this.iconPopoverEl.className = 'template-creator__icon-popover';

        // Search input
        const searchInput = this.iconPopoverEl.createEl('input', {
            cls: 'template-creator__icon-search',
            type: 'text',
            placeholder: 'Search icons...',
        });

        // Icon grid
        const grid = this.iconPopoverEl.createDiv('template-creator__icon-grid');

        const renderIcons = (filter: string) => {
            grid.empty();
            const filtered = filter
                ? allIcons.filter(name => name.includes(filter.toLowerCase()))
                : allIcons;
            const limited = filtered.slice(0, 200); // limit for performance

            for (const name of limited) {
                const btn = grid.createEl('button', { cls: 'template-creator__icon-option' });
                btn.setAttribute('aria-label', name);
                setIcon(btn.createSpan(), name);
                btn.addEventListener('click', () => {
                    onSelect(name);
                    this.closeIconPopover();
                });
            }
        };

        renderIcons('');
        searchInput.addEventListener('input', () => renderIcons(searchInput.value));

        document.body.appendChild(this.iconPopoverEl);

        // Position below anchor
        const anchorRect = anchorEl.getBoundingClientRect();
        const popRect = this.iconPopoverEl.getBoundingClientRect();
        let x = anchorRect.left;
        let y = anchorRect.bottom + 4;
        if (x + popRect.width > window.innerWidth) {
            x = window.innerWidth - popRect.width - 8;
        }
        if (y + popRect.height > window.innerHeight) {
            y = anchorRect.top - popRect.height - 4;
        }
        this.iconPopoverEl.style.left = `${Math.max(8, x)}px`;
        this.iconPopoverEl.style.top = `${Math.max(8, y)}px`;

        // Outside click closes icon popover only
        setTimeout(() => {
            this.iconOutsideClickHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (this.iconPopoverEl?.contains(target)) return;
                this.closeIconPopover();
            };
            document.addEventListener('pointerdown', this.iconOutsideClickHandler, true);
        }, 0);
    }

    private renderGroups(parent: HTMLElement): void {
        const groupsContainer = parent.createDiv('template-creator__groups');

        this.state.groups.forEach((group, gi) => {
            this.renderGroup(groupsContainer, group, gi);
        });

        const addBtn = groupsContainer.createEl('button', { cls: 'template-creator__add-btn' });
        const addIcon = addBtn.createSpan('template-creator__add-btn-icon');
        setIcon(addIcon, 'plus');
        addBtn.createSpan({ text: 'Add Group' });
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
        header.createSpan({ cls: 'template-creator__group-label', text: `Group ${groupIndex + 1}` });

        const repeatWrap = header.createSpan('template-creator__repeat-wrap');
        repeatWrap.createSpan({ cls: 'template-creator__repeat-label', text: 'Repeat' });
        const repeatInput = this.createNumericInput(repeatWrap, {
            value: group.repeatCount, min: 0, placeholder: '1',
            cls: 'template-creator__repeat-input',
            onChange: (v) => { group.repeatCount = v; },
        });

        if (this.state.groups.length > 1) {
            const removeBtn = header.createEl('button', { cls: 'template-creator__remove-btn' });
            setIcon(removeBtn, 'trash-2');
            removeBtn.addEventListener('click', () => {
                this.state.groups.splice(groupIndex, 1);
                this.refreshContent();
            });
        }

        // Segments
        const segmentsEl = groupEl.createDiv('template-creator__segments');

        group.segments.forEach((seg, si) => {
            this.renderSegment(segmentsEl, seg, group, si);
        });

        const addSegBtn = segmentsEl.createEl('button', { cls: 'template-creator__add-btn template-creator__add-btn--inline' });
        const addIcon = addSegBtn.createSpan('template-creator__add-btn-icon');
        setIcon(addIcon, 'plus');
        addSegBtn.createSpan({ text: 'Add Segment' });
        addSegBtn.addEventListener('click', () => {
            group.segments.push({ label: 'Work', hours: 0, minutes: 5, seconds: 0, type: 'work' });
            this.refreshContent();
        });
    }

    private renderSegment(parent: HTMLElement, seg: FormSegment, group: FormGroup, segIndex: number): void {
        const row = parent.createDiv('template-creator__segment');

        // Label
        const labelInput = row.createEl('input', {
            cls: 'template-creator__input template-creator__seg-label',
            type: 'text',
            placeholder: 'Label',
        });
        labelInput.value = seg.label;
        labelInput.addEventListener('input', () => { seg.label = labelInput.value; });

        // Duration: hh : mm : ss
        const durWrap = row.createDiv('template-creator__duration');

        const hInput = this.createNumericInput(durWrap, {
            value: seg.hours, min: 0, placeholder: 'h',
            onChange: (v) => { seg.hours = v; },
        });

        durWrap.createSpan({ cls: 'template-creator__dur-sep', text: ':' });

        const mInput = this.createNumericInput(durWrap, {
            value: seg.minutes, min: 0, max: 59, placeholder: 'm',
            onChange: (v) => { seg.minutes = v; },
        });

        durWrap.createSpan({ cls: 'template-creator__dur-sep', text: ':' });

        const sInput = this.createNumericInput(durWrap, {
            value: seg.seconds, min: 0, max: 59, placeholder: 's',
            onChange: (v) => { seg.seconds = v; },
        });

        // Type toggle button (cycles work → break → work)
        const typeLabel = seg.type === 'work' ? 'Work' : seg.type === 'break' ? 'Break' : 'Prep';
        const typeBtn = row.createEl('button', {
            cls: `template-creator__type-btn template-creator__type-btn--${seg.type}`,
            text: typeLabel,
        });
        typeBtn.addEventListener('click', () => {
            seg.type = seg.type === 'work' ? 'break' : 'work';
            this.refreshContent();
        });

        // Remove segment
        if (group.segments.length > 1) {
            const removeBtn = row.createEl('button', { cls: 'template-creator__remove-btn' });
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', () => {
                group.segments.splice(segIndex, 1);
                this.refreshContent();
            });
        }
    }

    private renderFooter(parent: HTMLElement): void {
        const footer = parent.createDiv('template-creator__footer');

        const errorEl = footer.createSpan('template-creator__error');

        const isEditing = !!this.editingFilePath;
        const saveBtn = footer.createEl('button', {
            cls: 'template-creator__save-btn',
            text: isEditing ? 'Save' : 'Create',
        });
        saveBtn.addEventListener('click', async () => {
            const error = this.validate();
            if (error) {
                errorEl.setText(error);
                return;
            }
            errorEl.setText('');

            const groups = this.buildGroups();
            const writer = new IntervalTemplateWriter(this.app);
            const data = {
                name: this.state.name.trim(),
                icon: this.state.icon.trim() || 'rotate-cw',
                groups,
            };

            try {
                const file = isEditing
                    ? await writer.updateTemplate(this.editingFilePath!, data)
                    : await writer.saveTemplate(this.folderPath, data);
                this.close();
                this.callbacks?.onSaved(file.path);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`Failed to ${isEditing ? 'save' : 'create'} template: ${msg}`);
                errorEl.setText(msg);
            }
        });
    }

    // ── Helpers ──

    private createNumericInput(
        parent: HTMLElement,
        opts: { value: number; min?: number; max?: number; placeholder?: string; cls?: string; onChange: (v: number) => void },
    ): HTMLInputElement {
        const input = parent.createEl('input', {
            cls: opts.cls ?? 'template-creator__dur-input',
            type: 'number',
        });
        input.value = String(opts.value);
        if (opts.min != null) input.min = String(opts.min);
        if (opts.max != null) input.max = String(opts.max);
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
        input.addEventListener('focus', () => input.select());
        input.addEventListener('change', () => {
            let val = parseInt(input.value, 10);
            if (isNaN(val)) val = 0;
            if (opts.min != null) val = Math.max(opts.min, val);
            if (opts.max != null) val = Math.min(opts.max, val);
            opts.onChange(val);
        });
        return input;
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
                label: s.label.trim() || (s.type === 'work' ? 'Work' : 'Break'),
                durationSeconds: s.hours * 3600 + s.minutes * 60 + s.seconds,
                type: s.type,
            })),
        }));
    }

    private validate(): string | null {
        if (!this.state.name.trim()) return 'Template name is required.';
        for (const group of this.state.groups) {
            if (group.segments.length === 0) return 'Each group must have at least one segment.';
            for (const seg of group.segments) {
                const total = seg.hours * 3600 + seg.minutes * 60 + seg.seconds;
                if (total <= 0) return 'Duration must be greater than 0.';
            }
        }
        return null;
    }

    private positionPopover(anchorEl: HTMLElement): void {
        if (!this.popoverEl) return;
        const anchorRect = anchorEl.getBoundingClientRect();
        const popRect = this.popoverEl.getBoundingClientRect();

        let x = anchorRect.left;
        let y = anchorRect.bottom + 4;

        if (x + popRect.width > window.innerWidth) {
            x = window.innerWidth - popRect.width - 8;
        }
        if (y + popRect.height > window.innerHeight) {
            y = anchorRect.top - popRect.height - 4;
        }

        this.popoverEl.style.left = `${Math.max(8, x)}px`;
        this.popoverEl.style.top = `${Math.max(8, y)}px`;
    }
}
