import { setIcon } from 'obsidian';
import { t } from '../i18n';
import { ViewSettingsMenu, ViewToolbarBase } from './sharedUI/ViewToolbar';
import type { ViewSettingsOptions } from './sharedUI/ViewToolbar';
import type { ViewToolbarHost } from './base/TaskViewerView';
import type { TimerState, TimerViewMode } from './TimerSchema';

/** What the timer does that is not a change of its state, or reads from more than it. */
export interface TimerCommands {
    /** Whether no timer runs (the mode can be changed only then). */
    isIdle(): boolean;
    /** Open the menu of modes. */
    selectMode(event: MouseEvent): void;
    /** Read the interval templates again. */
    reloadTemplates(): void;
    /** The gear menu: the shared settings with the timer's lengths above them. */
    settingsOptions(): ViewSettingsOptions;
}

export interface TimerToolbarDeps {
    host: ViewToolbarHost<TimerState>;
    commands: TimerCommands;
}

/**
 * Persistent toolbar for TimerView. Marked dynamic-content: its buttons
 * depend on the mode and on whether a timer runs, so it is built anew on
 * each mount, and the view draws on every change of its state.
 */
export class TimerToolbar extends ViewToolbarBase {
    constructor(private deps: TimerToolbarDeps) {
        super({ dynamicContent: true });
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { host, commands } = this.deps;
        const mode = host.store.get().timerViewMode ?? 'pomodoro';
        const isIdle = commands.isIdle();

        const labels: Record<TimerViewMode, string> = {
            countup: t('timer.countup'),
            countdown: t('timer.countdown'),
            pomodoro: t('timer.pomodoro'),
            interval: t('timer.interval'),
        };

        const modeBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--dropdown' });
        const modeIcon = modeBtn.createSpan('view-toolbar__btn-icon');
        const modeLabel = modeBtn.createSpan({ cls: 'view-toolbar__btn-label' });
        setIcon(modeIcon, 'chevrons-up-down');
        modeLabel.setText(labels[mode]);
        modeBtn.disabled = !isIdle;
        modeBtn.onclick = (e) => commands.selectMode(e);

        toolbar.createDiv('view-toolbar__spacer');

        if (mode === 'interval' && isIdle) {
            const refreshBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(refreshBtn, 'refresh-cw');
            refreshBtn.setAttribute('aria-label', t('timer.reloadTemplates'));
            refreshBtn.onclick = () => commands.reloadTemplates();
        }

        ViewSettingsMenu.renderButton(toolbar, commands.settingsOptions());
    }
}
