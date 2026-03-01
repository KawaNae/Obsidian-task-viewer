/**
 * IntervalTemplateCreator
 *
 * Popover UI for creating interval timer templates.
 * Follows the FilterMenuComponent popover pattern: position: fixed,
 * appended to document.body, outside-click to close.
 */

import { App, Notice, setIcon } from 'obsidian';
import { IntervalTemplateWriter } from '../../timer/IntervalTemplateWriter';
import type { IntervalGroup } from '../../timer/TimerInstance';

export interface TemplateCreatorCallbacks {
    onCreated: (filePath: string) => void;
}

interface FormSegment {
    label: string;
    hours: number;
    minutes: number;
    seconds: number;
    type: 'work' | 'break';
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
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private state: FormState = this.createDefaultState();
    private callbacks: TemplateCreatorCallbacks | null = null;
    private folderPath = '';

    constructor(private app: App) {}

    show(anchorEl: HTMLElement, folderPath: string, callbacks: TemplateCreatorCallbacks): void {
        this.close();
        this.folderPath = folderPath;
        this.callbacks = callbacks;
        this.state = this.createDefaultState();

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
                this.close();
            };
            document.addEventListener('pointerdown', this.outsideClickHandler, true);
        }, 0);
    }

    close(): void {
        if (this.popoverEl) {
            this.popoverEl.remove();
            this.popoverEl = null;
        }
        if (this.outsideClickHandler) {
            document.removeEventListener('pointerdown', this.outsideClickHandler, true);
            this.outsideClickHandler = null;
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
        header.createSpan({ cls: 'template-creator__title', text: 'New Template' });

        const closeBtn = header.createEl('button', { cls: 'template-creator__close-btn' });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => this.close());
    }

    private renderNameField(parent: HTMLElement): void {
        const field = parent.createDiv('template-creator__field');
        field.createEl('label', { cls: 'template-creator__label', text: 'Name' });
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
        field.createEl('label', { cls: 'template-creator__label', text: 'Icon' });
        const input = field.createEl('input', {
            cls: 'template-creator__input',
            type: 'text',
            placeholder: 'rotate-cw',
        });
        input.value = this.state.icon;
        input.addEventListener('input', () => { this.state.icon = input.value; });
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
        const repeatInput = repeatWrap.createEl('input', {
            cls: 'template-creator__repeat-input',
            type: 'number',
        });
        repeatInput.value = String(group.repeatCount);
        repeatInput.min = '0';
        repeatInput.addEventListener('change', () => {
            const val = parseInt(repeatInput.value, 10);
            group.repeatCount = isNaN(val) ? 1 : Math.max(0, val);
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

        const hInput = durWrap.createEl('input', {
            cls: 'template-creator__dur-input',
            type: 'number',
        });
        hInput.value = String(seg.hours);
        hInput.min = '0';
        hInput.placeholder = 'h';
        hInput.addEventListener('change', () => {
            seg.hours = Math.max(0, parseInt(hInput.value, 10) || 0);
        });

        durWrap.createSpan({ cls: 'template-creator__dur-sep', text: ':' });

        const mInput = durWrap.createEl('input', {
            cls: 'template-creator__dur-input',
            type: 'number',
        });
        mInput.value = String(seg.minutes);
        mInput.min = '0';
        mInput.max = '59';
        mInput.placeholder = 'm';
        mInput.addEventListener('change', () => {
            seg.minutes = Math.max(0, Math.min(59, parseInt(mInput.value, 10) || 0));
        });

        durWrap.createSpan({ cls: 'template-creator__dur-sep', text: ':' });

        const sInput = durWrap.createEl('input', {
            cls: 'template-creator__dur-input',
            type: 'number',
        });
        sInput.value = String(seg.seconds);
        sInput.min = '0';
        sInput.max = '59';
        sInput.placeholder = 's';
        sInput.addEventListener('change', () => {
            seg.seconds = Math.max(0, Math.min(59, parseInt(sInput.value, 10) || 0));
        });

        // Type select
        const typeSelect = row.createEl('select', { cls: 'template-creator__type-select' });
        const workOpt = typeSelect.createEl('option', { text: 'Work', value: 'work' });
        const breakOpt = typeSelect.createEl('option', { text: 'Break', value: 'break' });
        if (seg.type === 'break') breakOpt.selected = true;
        else workOpt.selected = true;
        typeSelect.addEventListener('change', () => {
            seg.type = typeSelect.value as 'work' | 'break';
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

        const saveBtn = footer.createEl('button', {
            cls: 'template-creator__save-btn',
            text: 'Create',
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

            try {
                const file = await writer.saveTemplate(this.folderPath, {
                    name: this.state.name.trim(),
                    icon: this.state.icon.trim() || 'rotate-cw',
                    groups,
                });
                this.close();
                this.callbacks?.onCreated(file.path);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`Failed to create template: ${msg}`);
                errorEl.setText(msg);
            }
        });
    }

    // ── Helpers ──

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
