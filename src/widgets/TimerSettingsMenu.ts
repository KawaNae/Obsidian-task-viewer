import { App, Menu } from 'obsidian';
import TaskViewerPlugin from '../main';
import { InputModal } from '../modals/InputModal';
import { PomodoroTimer } from './TimerInstance';

interface PomodoroSettingsMenuOptions {
    app: App;
    plugin: TaskViewerPlugin;
    timer: PomodoroTimer;
    event: MouseEvent;
    onPersist: () => void;
    onRender: () => void;
}

export class TimerSettingsMenu {
    static showPomodoroSettings(options: PomodoroSettingsMenuOptions): void {
        const { app, plugin, timer, event, onPersist, onRender } = options;
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
                        await plugin.saveSettings();
                        if (timer.phase === 'idle') {
                            timer.timeRemaining = mins * 60;
                            timer.totalTime = mins * 60;
                            onRender();
                        }
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
                                await plugin.saveSettings();
                                if (timer.phase === 'idle') {
                                    timer.timeRemaining = mins * 60;
                                    timer.totalTime = mins * 60;
                                    onRender();
                                }
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
                        await plugin.saveSettings();
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
                                await plugin.saveSettings();
                                onPersist();
                            }
                        }
                    ).open();
                });
        });

        menu.addSeparator();
        menu.addItem((item) => {
            item.setTitle(`Auto Repeat${timer.autoRepeat ? ' ✓' : ''}`)
                .onClick(() => {
                    timer.autoRepeat = !timer.autoRepeat;
                    onPersist();
                });
        });

        menu.showAtMouseEvent(event);
    }
}

