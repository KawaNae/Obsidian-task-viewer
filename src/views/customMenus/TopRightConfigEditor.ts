import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { TopRightConfig } from '../../types';
import { SuggestController } from './SuggestController';
import { OverlayShell } from '../sharedUI/OverlayShell';
import { PopoverStack } from '../sharedUI/PopoverStack';
import { KNOWN_FIELDS } from '../taskcard/TopRightFieldResolver';

export interface TopRightConfigEditorOpts {
    config: TopRightConfig | undefined;
    propertyKeys: string[];
    onChange: (config: TopRightConfig | undefined) => void;
}

export class TopRightConfigEditor {
    private overlay = new OverlayShell();
    private stack = new PopoverStack();
    private bodyEl: HTMLElement | null = null;
    private opts: TopRightConfigEditorOpts | null = null;
    private fields: string[] = [];
    private separator: string = '';

    open(anchor: HTMLElement, opts: TopRightConfigEditorOpts): void {
        this.opts = opts;
        this.fields = opts.config ? [...opts.config.fields] : [];
        this.separator = opts.config?.separator ?? '';

        this.overlay.open({
            mode: 'anchored',
            anchor: { kind: 'element', element: anchor },
            panelClass: 'top-right-config-editor',
            childStack: this.stack,
            build: (bodyEl) => {
                this.bodyEl = bodyEl;
                this.renderContent();
            },
            onClose: () => {
                this.stack.closeAll();
                this.bodyEl = null;
                this.opts = null;
            },
        });
    }

    private renderContent(): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        this.bodyEl.addClass('tv-ctrl');

        const fieldsLabel = this.bodyEl.createDiv('top-right-config-editor__label');
        fieldsLabel.setText(t('pinnedList.topRightFields'));

        this.renderFieldsPills(this.bodyEl);
        this.renderFieldsInput(this.bodyEl);

        const sepLabel = this.bodyEl.createDiv('top-right-config-editor__label');
        sepLabel.setText(t('pinnedList.topRightSeparator'));

        const sepInput = this.bodyEl.createEl('input', {
            cls: 'tv-ctrl__text-input top-right-config-editor__sep-input',
            attr: { type: 'text', placeholder: '> , · ...' },
        });
        sepInput.value = this.separator;
        sepInput.addEventListener('input', () => {
            this.separator = sepInput.value;
            this.emitChange();
        });

    }

    private renderFieldsPills(container: HTMLElement): void {
        if (this.fields.length === 0) return;
        const pillsEl = container.createDiv('tv-ctrl__pills');
        for (const field of this.fields) {
            const pill = pillsEl.createDiv('tv-ctrl__pill');
            pill.createSpan().setText(field);
            const removeBtn = pill.createEl('button', { cls: 'tv-ctrl__pill-remove' });
            setIcon(removeBtn.createSpan(), 'x');
            removeBtn.addEventListener('click', () => {
                this.fields = this.fields.filter(f => f !== field);
                this.emitChange();
                this.renderContent();
            });
        }
    }

    private renderFieldsInput(container: HTMLElement): void {
        const inputWrap = container.createDiv('tv-ctrl__input-wrap');
        const input = inputWrap.createEl('input', {
            cls: 'tv-ctrl__input',
            attr: { type: 'text', placeholder: t('pinnedList.topRightFieldPlaceholder') },
        });

        const suggest = new SuggestController(this.stack, inputWrap, '', 'exact');

        const addField = (value: string) => {
            const v = value.trim();
            if (!v || this.fields.includes(v)) return;
            this.fields.push(v);
            this.emitChange();
            this.renderContent();
        };

        const showSuggest = () => {
            const candidates = this.getSuggestCandidates(input.value);
            if (candidates.length === 0) {
                suggest.close();
                return;
            }
            suggest.show(
                candidates,
                (el, value) => el.setText(value),
                (value) => addField(value),
            );
        };

        input.addEventListener('focus', () => showSuggest());
        input.addEventListener('input', () => showSuggest());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                suggest.moveHighlight(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const val = suggest.highlightedValue ?? input.value;
                if (val) addField(val);
            } else if (e.key === 'Escape') {
                suggest.close();
            } else if (e.key === 'Backspace' && !input.value && this.fields.length > 0) {
                this.fields.pop();
                this.emitChange();
                this.renderContent();
            }
        });
    }

    private getSuggestCandidates(query: string): string[] {
        const propFields = (this.opts?.propertyKeys ?? []).map(k => `prop.${k}`);
        const all = [...KNOWN_FIELDS, ...propFields];
        const available = all.filter(f => !this.fields.includes(f));
        if (!query) return available;
        const q = query.toLowerCase();
        return available.filter(f => f.toLowerCase().includes(q));
    }

    private emitChange(): void {
        if (!this.opts) return;
        if (this.fields.length === 0) {
            this.opts.onChange(undefined);
        } else {
            this.opts.onChange({ fields: [...this.fields], separator: this.separator });
        }
    }
}
