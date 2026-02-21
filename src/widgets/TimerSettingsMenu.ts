import { App, Menu } from 'obsidian';
import TaskViewerPlugin from '../main';
import { InputModal } from '../modals/InputModal';
import { IntervalTimer } from './TimerInstance';

interface PomodoroSettingsMenuOptions {
    app: App;
    plugin: TaskViewerPlugin;
    timer: IntervalTimer;
    event: MouseEvent;
    onPersist: () => void;
    onRender: () => void;
}

export class TimerSettingsMenu {
    static showPomodoroSettings(options: PomodoroSettingsMenuOptions): void {
        const { app, plugin, timer, event, onPersist, onRender } = options;
        const group = timer.groups[0];
        const workSegment = group?.segments[0];
        const breakSegment = group?.segments[1];
        if (!group || !workSegment || !breakSegment) {
            return;
        }

        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Work Duration').setDisabled(true);
        });

        const workOptions = [15, 25, 30, 45, 50];
        workOptions.forEach((mins) => {
            menu.addItem((item) => {
                const current = plugin.settings.pomodoroWorkMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' ✓' : ''}`)
                    .onClick(async () => {
                        plugin.settings.pomodoroWorkMinutes = mins;
                        workSegment.durationSeconds = mins * 60;
                        await plugin.saveSettings();
                        this.syncIdleDisplay(timer, onRender);
                        onPersist();
                    });
            });
        });

        menu.addItem((item) => {
            const current = plugin.settings.pomodoroWorkMinutes;
            const isCustom = !workOptions.includes(current);
            item.setTitle(`  Custom...${isCustom ? ` (${current}min) ✓` : ''}`)
                .onClick(() => {
                    new InputModal(
                        app,
                        'Work Duration',
                        'Minutes (1-120)',
                        current.toString(),
                        async (value) => {
                            const mins = parseInt(value, 10);
                            if (!isNaN(mins) && mins > 0 && mins <= 120) {
                                plugin.settings.pomodoroWorkMinutes = mins;
                                workSegment.durationSeconds = mins * 60;
                                await plugin.saveSettings();
                                this.syncIdleDisplay(timer, onRender);
                                onPersist();
                            }
                        }
                    ).open();
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Break Duration').setDisabled(true);
        });

        const breakOptions = [5, 10, 15];
        breakOptions.forEach((mins) => {
            menu.addItem((item) => {
                const current = plugin.settings.pomodoroBreakMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' ✓' : ''}`)
                    .onClick(async () => {
                        plugin.settings.pomodoroBreakMinutes = mins;
                        breakSegment.durationSeconds = mins * 60;
                        await plugin.saveSettings();
                        this.syncIdleDisplay(timer, onRender);
                        onPersist();
                    });
            });
        });

        menu.addItem((item) => {
            const current = plugin.settings.pomodoroBreakMinutes;
            const isCustom = !breakOptions.includes(current);
            item.setTitle(`  Custom...${isCustom ? ` (${current}min) ✓` : ''}`)
                .onClick(() => {
                    new InputModal(
                        app,
                        'Break Duration',
                        'Minutes (1-60)',
                        current.toString(),
                        async (value) => {
                            const mins = parseInt(value, 10);
                            if (!isNaN(mins) && mins > 0 && mins <= 60) {
                                plugin.settings.pomodoroBreakMinutes = mins;
                                breakSegment.durationSeconds = mins * 60;
                                await plugin.saveSettings();
                                this.syncIdleDisplay(timer, onRender);
                                onPersist();
                            }
                        }
                    ).open();
                });
        });

        menu.addSeparator();
        menu.addItem((item) => {
            const autoRepeat = group.repeatCount === 0;
            item.setTitle(`Auto Repeat${autoRepeat ? ' ✓' : ''}`)
                .onClick(() => {
                    group.repeatCount = autoRepeat ? 1 : 0;
                    timer.totalDuration = this.computeTotalDuration(timer);
                    onPersist();
                });
        });

        menu.showAtMouseEvent(event);
    }

    private static syncIdleDisplay(timer: IntervalTimer, onRender: () => void): void {
        timer.totalDuration = this.computeTotalDuration(timer);
        if (timer.phase !== 'idle') {
            return;
        }
        timer.currentGroupIndex = 0;
        timer.currentSegmentIndex = 0;
        timer.currentRepeatIndex = 0;
        const firstSegment = timer.groups[0]?.segments[0];
        if (firstSegment) {
            timer.segmentTimeRemaining = firstSegment.durationSeconds;
        }
        onRender();
    }

    private static computeTotalDuration(timer: IntervalTimer): number {
        if (timer.groups.some((group) => group.repeatCount === 0)) {
            return 0;
        }
        return timer.groups.reduce((total, group) => {
            const groupTotal = group.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
            return total + groupTotal * Math.max(1, group.repeatCount);
        }, 0);
    }
}
