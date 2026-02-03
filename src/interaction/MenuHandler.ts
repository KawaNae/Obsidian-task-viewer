import { App, Menu, Notice } from 'obsidian';
import { Task } from '../types';
import { TaskIndex } from '../services/TaskIndex';
import TaskViewerPlugin from '../main';
import { ConfirmModal } from '../modals/ConfirmModal';
import { DateUtils } from '../utils/DateUtils';
import { DateTimeInputModal, DateTimeValue, DateTimeModalOptions } from '../modals/DateTimeInputModal';
import { InputModal } from '../modals/InputModal';

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

    private showContextMenu(x: number, y: number, taskInput: Task) {
        // Resolve the real task from the index to ensure we have the full, valid data
        // and not a modified RenderableTask segment
        const originalId = (taskInput as any).originalTaskId || taskInput.id;
        const task = this.taskIndex.getTask(originalId);

        if (!task) {
            new Notice('Task not found in index');
            return;
        }

        const menu = new Menu();

        // ========================================
        // 1. Properties Submenu
        // ========================================
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Properties')
                .setIcon('settings')
                .setSubmenu() as Menu;

            // Task Name
            subMenu.addItem((sub) => {
                const taskName = task.content.trim() || 'Untitled';
                sub.setTitle(`Name: ${taskName.substring(0, 20)}${taskName.length > 20 ? '...' : ''}`)
                    .setIcon('pencil')
                    .onClick(() => {
                        new InputModal(
                            this.app,
                            'Edit Task Name',
                            'Task Name',
                            task.content,
                            async (value) => {
                                await this.taskIndex.updateTask(task.id, { content: value });
                            }
                        ).open();
                    });
            });

            // Status
            subMenu.addItem((sub) => {
                const statusChar = task.statusChar;
                const statusDisplay = `[${statusChar}]`;

                (sub as any).setTitle(`Status: ${statusDisplay}`)
                    .setIcon('check-square')
                    .setSubmenu();

                // Status Options
                const statusMenu = (sub as any).submenu as Menu;

                const statuses = [
                    { char: ' ', label: '[ ]' },
                    { char: 'x', label: '[x]' },
                    { char: '-', label: '[-]' },
                    { char: '!', label: '[!]' },
                    { char: '?', label: '[?]' },
                    { char: '>', label: '[>]' }
                ];

                statuses.forEach(s => {
                    statusMenu.addItem(item => {
                        item.setTitle(s.label)
                            .setChecked(task.statusChar === s.char)
                            .onClick(async () => {
                                await this.taskIndex.updateTask(task.id, {
                                    statusChar: s.char
                                });
                            });
                    });
                });
            });

            // File
            subMenu.addItem((sub) => {
                sub.setTitle(`File: ${task.file.split('/').pop()}`)
                    .setIcon('file-text')
                    .onClick(() => {
                        this.app.workspace.openLinkText(task.file, '', true);
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

        // ========================================
        // 3. Move Operations
        // ========================================
        // All tasks are treated as normal tasks now
        const isTime = !!task.startTime;

        if (isTime) {
            // S-Timed, SE-Timed, SED-Timed

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
                                endTime: undefined
                            });
                        });
                });
            }
        } else {
            // All-Day / Long-Term

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

        menu.addSeparator();

        // ========================================
        // 4. Add Child Tasks (Pomodoro/Timer)
        // ========================================
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

    /**
     * Create property title with partial gray and italic styling for implicit parts
     * e.g., if date is implicit but time is explicit: "2026-01-01T" in gray italic, "13:00" in normal
     * 
     * Uses a DocumentFragment with a single parent span containing styled child spans.
     */
    private createPropertyTitleWithParts(label: string, parts: {
        date?: string;
        time?: string;
        dateImplicit: boolean;
        timeImplicit: boolean;

        isUnset?: boolean;
    }): DocumentFragment {
        const frag = document.createDocumentFragment();

        // Create a single container span that holds all content
        const container = document.createElement('span');

        // Label
        container.appendChild(document.createTextNode(label));

        if (parts.isUnset) {
            container.appendChild(document.createTextNode('-'));
            frag.appendChild(container);
            return frag;
        }



        const mutedColor = 'var(--text-muted)';

        // Date part
        if (parts.date) {
            const dateSpan = document.createElement('span');
            dateSpan.textContent = parts.date;
            if (parts.dateImplicit) {
                dateSpan.style.setProperty('color', mutedColor, 'important');
                dateSpan.style.setProperty('font-style', 'italic', 'important');
            }
            container.appendChild(dateSpan);
        }

        // Space separator
        if (parts.date && parts.time) {
            const separatorSpan = document.createElement('span');
            separatorSpan.textContent = ' ';
            // Separator follows the date's implicit status
            if (parts.dateImplicit) {
                separatorSpan.style.setProperty('color', mutedColor, 'important');
                separatorSpan.style.setProperty('font-style', 'italic', 'important');
            }
            container.appendChild(separatorSpan);
        }

        // Time part
        if (parts.time) {
            const timeSpan = document.createElement('span');
            timeSpan.textContent = parts.time;
            if (parts.timeImplicit) {
                timeSpan.style.setProperty('color', mutedColor, 'important');
                timeSpan.style.setProperty('font-style', 'italic', 'important');
            }
            container.appendChild(timeSpan);
        }

        frag.appendChild(container);
        return frag;
    }


    private addPropertyItems(menu: Menu, task: Task) {
        // Display start, end, deadline with appropriate icons
        // Auto-derived values are shown in gray (implicit) based on README spec:
        //
        // README Period Calculation Rules:
        // 1. SED, SE: actual time from start to end
        // 2. SD, S-All: start day's startHour to startHour+23:59 (1 day = 24h)
        // 3. S-Timed: start time to +1 hour
        // 4. E, ED: view's left edge date's startHour as start
        // 5. D: view's left edge date's startHour as start, start+23:59 as end
        //
        // Partial implicit styling:
        // - If date is implicit but time is explicit: date and T are gray, time is normal
        // - If time is implicit but date is explicit: date is normal, T and time are gray
        // - If both are implicit: entire value is gray

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
        // Use explicit flags from Task object (set by parser)
        const hasExplicitStart = task.explicitStartDate ?? false;
        const hasExplicitEnd = task.explicitEndDate ?? false;
        const hasStartTime = task.explicitStartTime ?? false;
        const hasEndTime = task.explicitEndTime ?? false;

        // --- Start Parts ---
        const startIcon = 'play';
        const startLabel = 'Start: ';
        type PropertyParts = {
            date?: string;
            time?: string;
            dateImplicit: boolean;
            timeImplicit: boolean;
            isFuture?: boolean;
            isUnset?: boolean;
        };

        let startParts: PropertyParts;

        if (hasExplicitStart) {
            if (hasStartTime) {
                // SED-Timed, SE-Timed, S-Timed: explicit start date and time
                startParts = {
                    date: task.startDate,
                    time: task.startTime,
                    dateImplicit: false,
                    timeImplicit: false
                };
            } else {
                // SD, S-All, SE, SED (Long-term): explicit date, implicit time = startHour
                startParts = {
                    date: task.startDate,
                    time: startHourStr,
                    dateImplicit: false,
                    timeImplicit: true
                };
            }
        } else {
            // Auto-derived: startDate undefined → view's left edge (E, ED, D types)
            if (hasStartTime) {
                // Time-only notation: startTime is explicit but date is inherited/implicit
                // Use task.startDate (which may have been inherited from parent in TaskIndex)
                startParts = {
                    date: task.startDate || implicitStartDate,
                    time: task.startTime,
                    dateImplicit: true,
                    timeImplicit: false
                };
            } else {
                // E, ED, D types: implicit date and implicit time
                startParts = {
                    date: implicitStartDate,
                    time: startHourStr,
                    dateImplicit: true,
                    timeImplicit: true
                };
            }
        }

        // --- End Parts ---
        const endIcon = 'square';
        const endLabel = 'End: ';
        let endParts: PropertyParts;

        const effectiveStartDate = task.startDate || implicitStartDate;

        if (hasExplicitEnd) {
            if (hasEndTime) {
                // Explicit endDate and endTime
                endParts = {
                    date: task.endDate,
                    time: task.endTime,
                    dateImplicit: false,
                    timeImplicit: false
                };
            } else {
                // SE, SED (Long-term): explicit date, implicit time
                endParts = {
                    date: task.endDate,
                    time: endHourStr,
                    dateImplicit: false,
                    timeImplicit: true
                };
            }
        } else if (hasEndTime) {
            // Has endTime but no endDate: derive date from start
            // e.g., @2026-01-11T12:00>13:00 → end date is implicit (same as start)
            endParts = {
                date: effectiveStartDate,
                time: task.endTime,
                dateImplicit: true,
                timeImplicit: false
            };
        } else if (hasStartTime && !hasEndTime) {
            // S-Timed type: implicit end = start + 1 hour
            const [h, m] = task.startTime!.split(':').map(Number);
            let endH = h + 1;
            const endM = m;
            let endDateStr = effectiveStartDate;
            if (endH >= 24) {
                endH -= 24;
                endDateStr = DateUtils.addDays(effectiveStartDate, 1);
            }
            const implicitEndTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
            endParts = {
                date: endDateStr,
                time: implicitEndTime,
                dateImplicit: true,
                timeImplicit: true
            };
        } else {
            // No endDate and no endTime
            // SD, S-All, D types: end = start day's startHour+23:59 (next day)
            const nextDay = DateUtils.addDays(effectiveStartDate, 1);
            endParts = {
                date: nextDay,
                time: endHourStr,
                dateImplicit: true,
                timeImplicit: true
            };
        }

        // --- Deadline Parts ---
        const deadlineIcon = 'alert-circle';
        const deadlineLabel = 'Deadline: ';
        let deadlineParts: PropertyParts;

        if (task.deadline) {
            if (task.deadline.includes('T')) {
                const [date, time] = task.deadline.split('T');
                deadlineParts = {
                    date: date,
                    time: time,
                    dateImplicit: false,
                    timeImplicit: false
                };
            } else {
                deadlineParts = {
                    date: task.deadline,
                    dateImplicit: false,
                    timeImplicit: false
                };
            }
        } else {
            deadlineParts = { dateImplicit: false, timeImplicit: false, isUnset: true };
        }

        // Add menu items (now clickable for editing)
        menu.addItem((item) => {
            item.setTitle(this.createPropertyTitleWithParts(startLabel, startParts))
                .setIcon(startIcon)
                .onClick(() => {
                    const currentValue: DateTimeValue = {
                        date: task.startDate || null,
                        time: task.startTime || null
                    };
                    new DateTimeInputModal(this.app, 'start', currentValue, async (value) => {
                        const newProps: Partial<Task> = {};
                        newProps.startDate = value.date || undefined;
                        newProps.startTime = value.time || undefined;
                        await this.taskIndex.updateTask(task.id, newProps);
                    }).open();
                });
        });

        menu.addItem((item) => {
            item.setTitle(this.createPropertyTitleWithParts(endLabel, endParts))
                .setIcon(endIcon)
                .onClick(() => {
                    const currentValue: DateTimeValue = {
                        date: task.endDate || null,

                        time: task.endTime || null
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
            item.setTitle(this.createPropertyTitleWithParts(deadlineLabel, deadlineParts))
                .setIcon(deadlineIcon)
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


}
