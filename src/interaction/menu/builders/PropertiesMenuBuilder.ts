import { App, Menu } from 'obsidian';
import { Task } from '../../../types';
import { TaskIndex } from '../../../services/core/TaskIndex';
import TaskViewerPlugin from '../../../main';
import { PropertyCalculator, PropertyCalculationContext, CalculatedProperty } from '../PropertyCalculator';
import { PropertyFormatter } from '../PropertyFormatter';
import { InputModal } from '../../../modals/InputModal';
import { DateTimeInputModal, DateTimeValue, DateTimeModalOptions } from '../../../modals/DateTimeInputModal';
import { DateUtils } from '../../../utils/DateUtils';
import { getTaskDisplayName } from '../../../utils/TaskContent';

/**
 * Propertiesサブメニューの構築
 */
export class PropertiesMenuBuilder {
    constructor(
        private app: App,
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin,
        private propertyCalculator: PropertyCalculator,
        private propertyFormatter: PropertyFormatter
    ) { }

    /**
     * Propertiesサブメニューを構築
     */
    buildPropertiesSubmenu(menu: Menu, task: Task, viewStartDate: string | null): void {
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Properties')
                .setIcon('settings')
                .setSubmenu() as Menu;

            this.addNameItem(subMenu, task);
            this.addStatusItem(subMenu, task);
            this.addFileItem(subMenu, task);
            subMenu.addSeparator();
            this.addPropertyItems(subMenu, task, viewStartDate);
        });
    }

    /**
     * Task Name項目を追加
     */
    private addNameItem(menu: Menu, task: Task): void {
        menu.addItem((sub) => {
            const taskName = getTaskDisplayName(task);
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
    }

    /**
     * Status項目を追加
     */
    private addStatusItem(menu: Menu, task: Task): void {
        menu.addItem((sub) => {
            const statusChar = task.statusChar;
            const statusDisplay = `[${statusChar}]`;

            (sub as any).setTitle(`Status: ${statusDisplay}`)
                .setIcon('check-square')
                .setSubmenu();

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
    }

    /**
     * File項目を追加
     */
    private addFileItem(menu: Menu, task: Task): void {
        menu.addItem((sub) => {
            sub.setTitle(`File: ${task.file.split('/').pop()}`)
                .setIcon('file-text')
                .onClick(() => {
                    this.app.workspace.openLinkText(task.file, '', true);
                });
        });
    }

    /**
     * プロパティ項目（Start, End, Deadline, Length）を追加
     */
    private addPropertyItems(menu: Menu, task: Task, viewStartDate: string | null): void {
        const context: PropertyCalculationContext = {
            task,
            startHour: this.plugin.settings.startHour,
            viewStartDate
        };

        // Calculate properties
        const startParts = this.propertyCalculator.calculateStart(context);
        const endParts = this.propertyCalculator.calculateEnd(context);
        const deadlineParts = this.propertyCalculator.calculateDeadline(task);

        // Add menu items
        this.addStartItem(menu, task, startParts);
        this.addEndItem(menu, task, endParts, context);
        this.addDeadlineItem(menu, task, deadlineParts);
        menu.addSeparator();
        this.addLengthItem(menu, task, context);
    }

    /**
     * Start項目を追加
     */
    private addStartItem(menu: Menu, task: Task, parts: CalculatedProperty): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle('Start: ', parts))
                .setIcon('play')
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
    }

    /**
     * End項目を追加
     */
    private addEndItem(menu: Menu, task: Task, parts: CalculatedProperty, context: PropertyCalculationContext): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle('End: ', parts))
                .setIcon('square')
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
                            // Time-only: inherit date from start
                            await this.taskIndex.updateTask(task.id, {
                                endDate: task.startDate,
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
    }

    /**
     * Deadline項目を追加
     */
    private addDeadlineItem(menu: Menu, task: Task, parts: CalculatedProperty): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle('Deadline: ', parts))
                .setIcon('alert-circle')
                .onClick(() => {
                    // Parse deadline
                    let deadlineDate: string | null = null;
                    let deadlineTime: string | null = null;
                    if (task.deadline) {
                        if (task.deadline.includes('T')) {
                            const splitParts = task.deadline.split('T');
                            deadlineDate = splitParts[0];
                            deadlineTime = splitParts[1];
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

    /**
     * Length (Duration)項目を追加
     */
    private addLengthItem(menu: Menu, task: Task, context: PropertyCalculationContext): void {
        const { startHour, viewStartDate } = context;
        const implicitStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);
        const effectiveStartDate = task.startDate || implicitStartDate;

        const durationMs = DateUtils.getTaskDurationMs(
            effectiveStartDate,
            task.startTime,
            task.endDate,
            task.endTime,
            startHour
        );

        let lengthText = '-';
        if (!Number.isNaN(durationMs) && durationMs > 0) {
            const totalMinutes = Math.round(durationMs / 60000);
            const days = Math.floor(totalMinutes / 1440);
            const hours = Math.floor((totalMinutes % 1440) / 60);
            const minutes = totalMinutes % 60;

            const parts: string[] = [];
            if (days > 0) parts.push(`${days}d`);
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);

            lengthText = parts.length > 0 ? parts.join(' ') : '0m';
        }

        menu.addItem((item) => {
            item.setTitle(`Length: ${lengthText}`)
                .setIcon('clock')
                .setDisabled(true);
        });
    }
}
