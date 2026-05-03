import { setIcon } from 'obsidian';
import { t } from '../i18n';
import type TaskViewerPlugin from '../main';
import { ViewToolbarBase } from './sharedUI/ViewToolbar';

export type TimerViewMode = 'countup' | 'countdown' | 'pomodoro' | 'interval';

export interface TimerToolbarDeps {
    plugin: TaskViewerPlugin;
    getMode: () => TimerViewMode;
    isIdle: () => boolean;
    onSelectMode: (event: MouseEvent) => void;
    onReloadTemplates: () => void;
    onShowSettingsMenu: (event: MouseEvent) => void;
}

/**
 * Persistent toolbar for TimerView. Marked dynamic-content because button
 * visibility/state depends on timer phase (idle/running/paused) and selected
 * mode, which both change between renders.
 */
export class TimerToolbar extends ViewToolbarBase {
    constructor(private deps: TimerToolbarDeps) {
        super({ dynamicContent: true });
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;
        const mode = deps.getMode();
        const isIdle = deps.isIdle();

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
        modeBtn.onclick = (e) => deps.onSelectMode(e);

        toolbar.createDiv('view-toolbar__spacer');

        if (mode === 'interval' && isIdle) {
            const refreshBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(refreshBtn, 'refresh-cw');
            refreshBtn.setAttribute('aria-label', t('timer.reloadTemplates'));
            refreshBtn.onclick = () => deps.onReloadTemplates();
        }

        const settingsBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(settingsBtn, 'settings');
        settingsBtn.setAttribute('aria-label', t('timer.settings'));
        settingsBtn.onclick = (e) => deps.onShowSettingsMenu(e);
    }
}
