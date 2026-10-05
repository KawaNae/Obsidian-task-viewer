import { setIcon, type App } from 'obsidian';
import { t } from '../../i18n';
import type { TopRightConfig } from '../../types';
import { ValueSuggest } from '../../suggest/ValueSuggest';
import { OverlayShell } from '../sharedUI/OverlayShell';
import { KNOWN_FIELDS } from '../taskcard/TopRightFieldResolver';
import { onFormEnter } from '../../modals/form/formEnter';

export interface TopRightConfigEditorOpts {
    config: TopRightConfig | undefined;
    propertyKeys: string[];
    onChange: (config: TopRightConfig | undefined) => void;
}

export class TopRightConfigEditor {
    private overlay = new OverlayShell();
    private bodyEl: HTMLElement | null = null;
    private opts: TopRightConfigEditorOpts | null = null;
    private fields: string[] = [];
    private separator: string = '';
    private prefix: string = '';
    private suffix: string = '';
    /** The list under the fields' input as last drawn: closed before the content is drawn anew. */
    private fieldList: ValueSuggest | null = null;

    /** @param app the app: its keymap, whose hotkeys the editor keeps out while it has the focus, and the list under the fields' input. */
    constructor(private readonly app: App) { }

    open(anchor: HTMLElement, opts: TopRightConfigEditorOpts): void {
        this.opts = opts;
        this.fields = opts.config ? [...opts.config.fields] : [];
        this.separator = opts.config?.separator ?? '';
        this.prefix = opts.config?.prefix ?? '';
        this.suffix = opts.config?.suffix ?? '';

        this.overlay.open({
            mode: 'anchored',
            anchor: { kind: 'element', element: anchor },
            panelClass: 'top-right-config-editor',
            keymap: this.app.keymap,
            build: (bodyEl) => {
                this.bodyEl = bodyEl;
                this.renderContent();
            },
            onClose: () => {
                this.fieldList?.close();
                this.fieldList = null;
                this.bodyEl = null;
                this.opts = null;
            },
        });
    }

    private renderContent(): void {
        if (!this.bodyEl) return;
        this.fieldList?.close();
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

        const affixRow = this.bodyEl.createDiv('top-right-config-editor__affix-row');

        const prefixWrap = affixRow.createDiv('top-right-config-editor__affix');
        prefixWrap.createDiv('top-right-config-editor__label').setText(t('pinnedList.topRightPrefix'));
        const prefixInput = prefixWrap.createEl('input', {
            cls: 'tv-ctrl__text-input',
            attr: { type: 'text' },
        });
        prefixInput.value = this.prefix;
        prefixInput.addEventListener('input', () => {
            this.prefix = prefixInput.value;
            this.emitChange();
        });

        const suffixWrap = affixRow.createDiv('top-right-config-editor__affix');
        suffixWrap.createDiv('top-right-config-editor__label').setText(t('pinnedList.topRightSuffix'));
        const suffixInput = suffixWrap.createEl('input', {
            cls: 'tv-ctrl__text-input',
            attr: { type: 'text' },
        });
        suffixInput.value = this.suffix;
        suffixInput.addEventListener('input', () => {
            this.suffix = suffixInput.value;
            this.emitChange();
        });
    }

    private renderFieldsPills(container: HTMLElement): void {
        if (this.fields.length === 0) return;
        const pillsEl = container.createDiv('tv-ctrl__pills');
        for (const field of this.fields) {
            const pill = pillsEl.createDiv('tv-ctrl__pill');
            pill.createSpan().setText(field);
            const removeBtn = pill.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove' });
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

        const addField = (value: string) => {
            const v = value.trim();
            if (!v || this.fields.includes(v)) return;
            this.fields.push(v);
            this.emitChange();
            this.renderContent();
        };

        const list = new ValueSuggest(this.app, input, {
            candidates: (query) => this.getSuggestCandidates(query),
            pick: (value) => addField(value),
        });
        this.fieldList = list;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && this.fields.length > 0) {
                this.fields.pop();
                this.emitChange();
                this.renderContent();
            }
        });
        // An Enter with no list open adds what is typed.
        onFormEnter(input, () => {
            if (input.value) addField(input.value);
        }, { takesEnter: () => list.listShown });
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
            const config: import('../../types').TopRightConfig = {
                fields: [...this.fields],
                separator: this.separator,
            };
            if (this.prefix) config.prefix = this.prefix;
            if (this.suffix) config.suffix = this.suffix;
            this.opts.onChange(config);
        }
    }
}
