import { App, Menu, Notice } from 'obsidian';
import { Task } from '../types';
import { TaskIndex } from '../services/TaskIndex';
import TaskViewerPlugin from '../main';
import { ConfirmModal } from '../modals/ConfirmModal';
import { DateUtils } from '../utils/DateUtils';
import { DateTimeInputModal, DateTimeValue, DateTimeModalOptions } from '../modals/DateTimeInputModal';

export class MenuHandler {
    private app: App;
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private viewStartDate: string | null = null;

    constructor(app: App, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        this.app = app;
        this.taskIndex = taskIndex;
        this.plugin = plugin;
    }

    /**
     * Set the view's left edge date for implicit start date calculation (E, ED, D types)
     */
    setViewStartDate(date: string | null) {
        this.viewStartDate = date;
    }

    addTaskContextMenu(el: HTMLElement, task: Task) {
        // Standard Context Menu (Desktop/Mouse)
        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.showContextMenu(event.pageX, event.pageY, task);
        });

        // Touch Handling for Long Press (Mobile/Touch Devices)
        let timer: number | null = null;
        let startX = 0;
        let startY = 0;

        el.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;

            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;

            timer = window.setTimeout(() => {
                // Long press detected
                timer = null;
                e.preventDefault(); // Prevent native context menu/selection
                this.showContextMenu(startX, startY, task);
            }, 500); // 500ms long press
        }, { passive: false });

        el.addEventListener('touchmove', (e) => {
            if (!timer) return;

            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;

            // If moved more than 10px, cancel long press
            if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) {
                clearTimeout(timer);
                timer = null;
            }
        }, { passive: true });

        el.addEventListener('touchend', () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });

        el.addEventListener('touchcancel', () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
    }

    private showContextMenu(x: number, y: number, task: Task) {
        const menu = new Menu();

        // ========================================
        // 1. Properties Submenu
        // ========================================
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Properties')
                .setIcon('settings')
                .setSubmenu() as Menu;

            // Task Name (placeholder)
            subMenu.addItem((sub) => {
                const taskName = task.content.trim() || 'Untitled';
                sub.setTitle(`Task Name: ${taskName.substring(0, 20)}${taskName.length > 20 ? '...' : ''}`)
                    .setIcon('pencil')
                    .onClick(() => {
                        new Notice('Task Name editing: Coming soon');
                    });
            });

            // Status (placeholder)
            subMenu.addItem((sub) => {
                const status = task.status === 'done' ? '[x]' : '[ ]';
                sub.setTitle(`Status: ${status}`)
                    .setIcon('check-square')
                    .onClick(() => {
                        new Notice('Status editing: Coming soon');
                    });
            });

            subMenu.addSeparator();

            // Start, End, Deadline (existing functionality)
            this.addPropertyItems(subMenu, task);
        });

        menu.addSeparator();

        // ========================================
        // 2. Start Timer - directly records to this task's start/end
        // ========================================
        if (!task.startTime) {
            menu.addItem((item) => {
                const displayName = task.content.trim() || task.file.replace(/\.md$/, '').split('/').pop() || 'Untitled';
                item.setTitle('⏱️ Start Timer')
                    .setIcon('play')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        // recordMode: 'self' = update this task directly, autoStart: true
                        widget.showCountup(task.id, displayName, task.originalText, task.file, 'self', true);
                    });
            });
        }

        // ========================================
        // 3. Move Operations
        // ========================================
        if (task.isFuture) {
            // F Type
            menu.addItem((item) => {
                item.setTitle('Move to All Day (Today)')
                    .setIcon('calendar-days')
                    .onClick(async () => {
                        const startHour = this.plugin.settings.startHour;
                        const today = DateUtils.getVisualDateOfNow(startHour);
                        await this.taskIndex.updateTask(task.id, {
                            isFuture: false,
                            startDate: today,
                            startTime: undefined,
                            endDate: undefined,
                            endTime: undefined
                        });
                    });
            });

            menu.addItem((item) => {
                item.setTitle('Move to Timeline (Now)')
                    .setIcon('clock')
                    .onClick(async () => {
                        const startHour = this.plugin.settings.startHour;
                        const today = DateUtils.getVisualDateOfNow(startHour);
                        const now = new Date();
                        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

                        await this.taskIndex.updateTask(task.id, {
                            isFuture: false,
                            startDate: today,
                            startTime: timeStr,
                            endDate: undefined,
                            endTime: undefined
                        });
                    });
            });
        } else {
            const isTime = !!task.startTime;

            if (isTime) {
                // S-Timed, SE-Timed, SED-Timed
                this.addMoveToFutureItem(menu, task);

                menu.addItem((item) => {
                    item.setTitle('Move to All Day')
                        .setIcon('calendar-with-checkmark')
                        .onClick(async () => {
                            await this.taskIndex.updateTask(task.id, {
                                startTime: undefined,
                                endTime: undefined
                            });
                        });
                });

                if (task.deadline) {
                    menu.addItem((item) => {
                        item.setTitle('Move to All Day (Deadline only)')
                            .setIcon('calendar-clock')
                            .onClick(async () => {
                                await this.taskIndex.updateTask(task.id, {
                                    startDate: undefined,
                                    startTime: undefined,
                                    endDate: undefined,
                                    endTime: undefined,
                                    isFuture: false
                                });
                            });
                    });
                }
            } else {
                // All-Day / Long-Term
                this.addMoveToFutureItem(menu, task);

                menu.addItem((item) => {
                    item.setTitle('Move to Timeline')
                        .setIcon('clock')
                        .onClick(async () => {
                            const startHour = this.plugin.settings.startHour;
                            const h = startHour.toString().padStart(2, '0');

                            await this.taskIndex.updateTask(task.id, {
                                startTime: `${h}:00`,
                                endTime: undefined
                            });
                        });
                });
            }
        }

        menu.addSeparator();

        // ========================================
        // 4. Add Child Tasks (Pomodoro/Timer)
        // ========================================
        if (!task.startTime) {
            const displayName = task.content.trim() || task.file.replace(/\.md$/, '').split('/').pop() || 'Untitled';

            menu.addItem((item) => {
                item.setTitle('🍅 Open Pomodoro as Child')
                    .setIcon('timer')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        widget.show(task.id, displayName, task.originalText, task.file);
                    });
            });

            menu.addItem((item) => {
                item.setTitle('⏱️ Open Timer as Child')
                    .setIcon('clock')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        widget.showCountup(task.id, displayName, task.originalText, task.file);
                    });
            });
        }

        menu.addSeparator();

        // ========================================
        // 5. Task Actions
        // ========================================
        menu.addItem((item) => {
            item.setTitle('Open in Editor')
                .setIcon('document')
                .onClick(async () => {
                    await this.app.workspace.openLinkText(task.file, '', true);
                });
        });

        // Duplicate (Submenu)
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Duplicate')
                .setIcon('copy')
                .setSubmenu() as Menu;

            subMenu.addItem((sub) => {
                sub.setTitle('Once')
                    .setIcon('copy')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTask(task.id);
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle('For Week (7 days)')
                    .setIcon('calendar-range')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTaskForWeek(task.id);
                    });
            });
        });

        // Delete
        menu.addItem((item) => {
            item.setTitle('Delete')
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    new ConfirmModal(
                        this.app,
                        'Delete Task',
                        'Are you sure you want to delete this task?',
                        async () => {
                            await this.taskIndex.deleteTask(task.id);
                        }
                    ).open();
                });
        });

        menu.showAtPosition({ x, y });
    }

    private addPropertyItems(menu: Menu, task: Task) {
        // Display start, end, deadline with appropriate icons
        // Auto-derived values are shown in parentheses based on README spec:
        //
        // README Period Calculation Rules (lines 40-46):
        // 1. SED, SE: actual time from start to end
        // 2. SD, S-All: start day's startHour to startHour+23:59 (1 day = 24h)
        // 3. S-Timed: start time to +1 hour
        // 4. E, ED: view's left edge date's startHour as start
        // 5. D: view's left edge date's startHour as start, start+23:59 as end

        const startHour = this.plugin.settings.startHour;
        const startHourStr = startHour.toString().padStart(2, '0') + ':00';

        // End time calculation: startHour + 23:59 = next day's (startHour-1):59
        // e.g., if startHour is 5, end time is 04:59 (next day)
        let endHour = startHour - 1;
        if (endHour < 0) endHour = 23;
        const endHourStr = endHour.toString().padStart(2, '0') + ':59';

        // Calculate implicit start date (for E, ED, D types)
        // Use viewStartDate if set, otherwise fall back to today
        const implicitStartDate = this.viewStartDate || DateUtils.getVisualDateOfNow(startHour);

        // Determine task type for period calculation
        const hasExplicitStart = !!task.startDate;
        const hasExplicitEnd = !!task.endDate;
        const hasStartTime = !!task.startTime;
        const hasEndTime = !!task.endTime;
        const hasDeadline = !!task.deadline;

        // --- Start ---
        const startIcon = 'play';
        let startText = 'Start: -';

        if (task.isFuture) {
            startText = 'Start: Future';
        } else if (hasExplicitStart) {
            // Explicit startDate
            if (hasStartTime) {
                // SED-Timed, SE-Timed, S-Timed: explicit start date and time
                startText = `Start: ${task.startDate}T${task.startTime}`;
            } else {
                // SD, S-All, SE, SED (Long-term): explicit date, implicit time = startHour
                startText = `Start: ${task.startDate}T(${startHourStr})`;
            }
        } else {
            // Auto-derived: startDate undefined → view's left edge (E, ED, D types)
            if (hasStartTime) {
                // Edge case: startTime without startDate (shouldn't normally happen)
                startText = `Start: (${implicitStartDate})T${task.startTime}`;
            } else {
                // E, ED, D types: implicit date and implicit time
                startText = `Start: (${implicitStartDate}T${startHourStr})`;
            }
        }

        // --- End ---
        const endIcon = 'square';
        let endText = 'End: -';

        if (task.isFuture) {
            endText = 'End: -';
        } else {
            const effectiveStartDate = task.startDate || implicitStartDate;

            if (hasExplicitEnd) {
                // Explicit endDate exists - always show it as explicit
                if (hasEndTime) {
                    endText = `End: ${task.endDate}T${task.endTime}`;
                } else {
                    // SE, SED (Long-term): explicit date, implicit time
                    endText = `End: ${task.endDate}T(${endHourStr})`;
                }
            } else if (hasEndTime) {
                // Has endTime but no endDate: derive date from start
                const effectiveEndDate = effectiveStartDate;
                endText = `End: (${effectiveEndDate})T${task.endTime}`;
            } else if (hasStartTime && !hasEndTime) {
                // S-Timed type: implicit end = start + 1 hour
                const [h, m] = task.startTime!.split(':').map(Number);
                let endH = h + 1;
                let endM = m;
                let endDateStr = effectiveStartDate;
                if (endH >= 24) {
                    endH -= 24;
                    // Next day
                    endDateStr = DateUtils.addDays(effectiveStartDate, 1);
                }
                const implicitEndTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                endText = `End: (${endDateStr}T${implicitEndTime})`;
            } else {
                // No endDate and no endTime
                // SD, S-All, D types: end = start day's startHour+23:59 (next day)
                const nextDay = DateUtils.addDays(effectiveStartDate, 1);
                endText = `End: (${nextDay}T${endHourStr})`;
            }
        }

        // --- Deadline ---
        const deadlineIcon = 'alert-circle';
        let deadlineText = 'Deadline: -';

        if (task.deadline) {
            deadlineText = `Deadline: ${task.deadline}`;
        }

        // Add menu items (now clickable for editing)
        menu.addItem((item) => {
            item.setTitle(startText).setIcon(startIcon)
                .onClick(() => {
                    const currentValue: DateTimeValue = {
                        date: task.startDate || null,
                        time: task.startTime || null,
                        isFuture: task.isFuture
                    };
                    new DateTimeInputModal(this.app, 'start', currentValue, async (value) => {
                        if (value.isFuture) {
                            await this.taskIndex.updateTask(task.id, {
                                isFuture: true,
                                startDate: undefined,
                                startTime: undefined
                            });
                        } else if (value.date === null) {
                            // Clear: only remove start, not other fields
                            await this.taskIndex.updateTask(task.id, {
                                startDate: undefined,
                                startTime: undefined,
                                isFuture: false
                            });
                        } else {
                            await this.taskIndex.updateTask(task.id, {
                                startDate: value.date,
                                startTime: value.time || undefined,
                                isFuture: false
                            });
                        }
                    }).open();
                });
        });
        menu.addItem((item) => {
            item.setTitle(endText).setIcon(endIcon)
                .onClick(() => {
                    // Parse current endTime if it's full ISO format
                    let endDate = task.endDate || null;
                    let endTime = task.endTime || null;
                    if (endTime && endTime.includes('T')) {
                        const parts = endTime.split('T');
                        endDate = parts[0];
                        endTime = parts[1];
                    }

                    const currentValue: DateTimeValue = {
                        date: endDate,
                        time: endTime
                    };
                    const options: DateTimeModalOptions = {
                        hasStartDate: !!task.startDate
                    };
                    new DateTimeInputModal(this.app, 'end', currentValue, async (value) => {
                        if (value.date === null && value.time === null) {
                            // Clear both
                            await this.taskIndex.updateTask(task.id, {
                                endDate: undefined,
                                endTime: undefined
                            });
                        } else if (value.date === null && value.time !== null) {
                            // Time-only: inherit date from start (required for Parser to handle abbreviation)
                            await this.taskIndex.updateTask(task.id, {
                                endDate: task.startDate,  // Always set endDate when endTime is set
                                endTime: value.time
                            });
                        } else {
                            await this.taskIndex.updateTask(task.id, {
                                endDate: value.date || undefined,
                                endTime: value.time || undefined
                            });
                        }
                    }, options).open();
                });
        });
        menu.addItem((item) => {
            item.setTitle(deadlineText).setIcon(deadlineIcon)
                .onClick(() => {
                    // Parse deadline (can be YYYY-MM-DD or YYYY-MM-DDTHH:mm)
                    let deadlineDate: string | null = null;
                    let deadlineTime: string | null = null;
                    if (task.deadline) {
                        if (task.deadline.includes('T')) {
                            const parts = task.deadline.split('T');
                            deadlineDate = parts[0];
                            deadlineTime = parts[1];
                        } else {
                            deadlineDate = task.deadline;
                        }
                    }

                    const currentValue: DateTimeValue = {
                        date: deadlineDate,
                        time: deadlineTime
                    };
                    new DateTimeInputModal(this.app, 'deadline', currentValue, async (value) => {
                        if (value.date === null) {
                            await this.taskIndex.updateTask(task.id, {
                                deadline: undefined
                            });
                        } else {
                            const newDeadline = value.time
                                ? `${value.date}T${value.time}`
                                : value.date;
                            await this.taskIndex.updateTask(task.id, {
                                deadline: newDeadline
                            });
                        }
                    }).open();
                });
        });
    }

    private addMoveToFutureItem(menu: Menu, task: Task) {
        menu.addItem((item) => {
            item.setTitle('Move to Future')
                .setIcon('archive')
                .onClick(async () => {
                    await this.taskIndex.updateTask(task.id, {
                        isFuture: true,
                        startDate: undefined,
                        startTime: undefined,
                        endDate: undefined,
                        endTime: undefined,
                        // isFloatingStart removed
                        // F type typically @future. 
                        // Some README variants allow @future>>deadline.
                        // We will keep deadline.
                    });
                });
        });
    }
}
