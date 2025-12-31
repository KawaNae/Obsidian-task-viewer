import { App, Menu } from 'obsidian';
import { Task } from '../types';
import { TaskIndex } from '../services/TaskIndex';
import TaskViewerPlugin from '../main';
import { ConfirmModal } from '../modals/ConfirmModal';
import { DateUtils } from '../utils/DateUtils';

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

        // 1. Parameter Display (C:Parameters)
        this.addParameterDisplay(menu, task);

        menu.addSeparator();

        // 2. Open
        menu.addItem((item) => {
            item.setTitle('Open')
                .setIcon('document')
                .onClick(async () => {
                    await this.app.workspace.openLinkText(task.file, '', true);
                });
        });

        // 3. Move/Convert Options based on Type
        // Classification logic based on README
        // F: isFuture
        // S-All: Start defined, No End (or End=Start), No Time (implicit 1 day)
        // SE/SED (Long): Start, End, No Time (or >=24h)
        // S-Timed: Start Time, No End Time (implicit 1h)
        // SE/SED (Timed): Start Time, End Time
        // D: No Start, No End, Deadline only (isFloatingStart=true implicitly for visual, but data-wise only deadline?)
        //    Actually parser sets date=today if empty start. But let's check parsing.
        //    If D type (@>>2023-01-01), parser sets date=Today, isFloatingStart=true.
        //    So we check isFloatingStart.

        if (task.isFuture) {
            // F Type
            // - Move to All day (S-All)
            // - Move to Timeline (S-Timed)

            // Move to All Day (Today)
            menu.addItem((item) => {
                item.setTitle('Move to All day (Today)')
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

            // Move to Timeline (Now)
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
                            endTime: undefined // S-Timed implies +1h or just start
                        });
                    });
            });

        } else {
            // Non-Future Tasks
            const isTime = !!task.startTime;
            const isFloating = !task.startDate && !task.isFuture;

            if (isTime) {
                // S-Timed, SE-Timed, SED-Timed

                // Common: Move to Future
                this.addMoveToFutureItem(menu, task);

                // Move to All Day (Strip time)
                menu.addItem((item) => {
                    item.setTitle('Move to All day')
                        .setIcon('calendar-with-checkmark')
                        .onClick(async () => {
                            await this.taskIndex.updateTask(task.id, {
                                startTime: undefined,
                                endTime: undefined
                            });
                        });
                });

                // Move to Long Term (D Type conversion per README line 165)
                // "start全体とend全体を削除する（deadlineが残る）"
                // Only for SED-Timed? README says "SED型のうち... D型に変換する"
                // But generally converting to D type (Deadline only) might be useful.
                if (task.deadline) {
                    menu.addItem((item) => {
                        item.setTitle('Move to Long Term (Convert to D-Type)')
                            .setIcon('calendar-clock') // Icon for long term?
                            .onClick(async () => {
                                await this.taskIndex.updateTask(task.id, {
                                    startDate: undefined,
                                    startTime: undefined,
                                    endDate: undefined,
                                    endTime: undefined,
                                    isFuture: false
                                    // isFloatingStart removed. Implicit Today.
                                });
                            });
                    });
                }
            } else {
                // All-Day / Long-Term (S-All, SE, SED, D, E, SD)

                // Common: Move to Future
                this.addMoveToFutureItem(menu, task);

                // Move to Timeline
                // "Move to Timeline (S-timed型に変換)"
                menu.addItem((item) => {
                    item.setTitle('Move to Timeline')
                        .setIcon('clock')
                        .onClick(async () => {
                            const startHour = this.plugin.settings.startHour;
                            // Default to "now" or 09:00? README says "追加する時刻はタイムライン上で指定する"
                            // implies drag operation? But context menu is immediate.
                            // Let's default to startHour or current time.
                            const h = startHour.toString().padStart(2, '0');

                            await this.taskIndex.updateTask(task.id, {
                                startTime: `${h}:00`,
                                endTime: undefined // S-Timed
                            });
                        });
                });
            }
        }

        menu.addSeparator();

        // Duplicate
        menu.addItem((item) => {
            item.setTitle('Duplicate')
                .setIcon('copy')
                .onClick(async () => {
                    await this.taskIndex.duplicateTask(task.id);
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

    private addParameterDisplay(menu: Menu, task: Task) {
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

        // Add menu items
        menu.addItem((item) => {
            item.setTitle(startText).setIcon(startIcon).setDisabled(true);
        });
        menu.addItem((item) => {
            item.setTitle(endText).setIcon(endIcon).setDisabled(true);
        });
        menu.addItem((item) => {
            item.setTitle(deadlineText).setIcon(deadlineIcon).setDisabled(true);
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
