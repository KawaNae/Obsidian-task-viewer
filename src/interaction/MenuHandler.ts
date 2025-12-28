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

    constructor(app: App, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        this.app = app;
        this.taskIndex = taskIndex;
        this.plugin = plugin;
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
        // Start is auto-derived (today) if:
        //   - startDate is undefined (E, ED, D types: @>end or @>>deadline)
        //
        // End is auto-derived if:
        //   - endDate is undefined AND no endTime (SD, S-All, D types: end = start)
        //   - endDate === startDate AND no endTime (equivalent to omitted)
        //   - For S-Timed: endTime is undefined (end = start + 1hour)

        // --- Start ---
        const startIcon = 'play';
        let startText = 'Start: -';

        if (task.isFuture) {
            startText = 'Start: Future';
        } else if (task.startDate) {
            // Explicit startDate
            startText = `Start: ${task.startDate}`;
            if (task.startTime) startText += `T${task.startTime}`;
        } else {
            // Auto-derived: startDate undefined → today (E, ED, D types)
            const implicitDate = DateUtils.getToday();
            startText = `Start: (${implicitDate})`;
            if (task.startTime) startText += `T${task.startTime}`;
        }

        // --- End ---
        const endIcon = 'square';
        let endText = 'End: -';

        if (task.isFuture) {
            endText = 'End: -';
        } else {
            const effectiveStart = task.startDate || DateUtils.getToday();

            if (task.endDate && task.endDate !== effectiveStart) {
                // Explicit endDate different from start
                endText = `End: ${task.endDate}`;
                if (task.endTime) endText += `T${task.endTime}`;
            } else if (task.endTime) {
                // Has endTime but endDate is same as start (or undefined)
                // For Timed tasks with endTime: show the date (derived) + time (explicit)
                const effectiveEnd = task.endDate || effectiveStart;
                if (!task.endDate) {
                    endText = `End: (${effectiveEnd})T${task.endTime}`;
                } else {
                    // endDate === effectiveStart with endTime
                    endText = `End: (${effectiveEnd})T${task.endTime}`;
                }
            } else {
                // No endDate (or same as start) and no endTime
                // Auto-derived: end = start (SD, S-All, D types)
                endText = `End: (${effectiveStart})`;
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
