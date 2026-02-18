import { App, Menu } from 'obsidian';
import { Task } from '../../../types';
import { TaskIndex } from '../../../services/core/TaskIndex';
import TaskViewerPlugin from '../../../main';
import { PropertyCalculator, PropertyCalculationContext, CalculatedProperty } from '../PropertyCalculator';
import { PropertyFormatter } from '../PropertyFormatter';
import { CreateTaskModal, CreateTaskResult } from '../../../modals/CreateTaskModal';
import { DateUtils } from '../../../utils/DateUtils';
import { getTaskDisplayName } from '../../../utils/TaskContent';

type ChangePropertiesFocusField = 'name' | 'start' | 'end' | 'deadline';

/**
 * Properties sub menu builder.
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
     * Build Properties submenu.
     */
    buildPropertiesSubmenu(menu: Menu, task: Task, viewStartDate: string | null): void {
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Properties')
                .setIcon('settings')
                .setSubmenu() as Menu;

            // Requested order:
            // status / file / --- / name / start / end / deadline / --- / length
            this.addStatusItem(subMenu, task);
            this.addFileItem(subMenu, task);
            subMenu.addSeparator();
            this.addNameItem(subMenu, task);
            this.addPropertyItems(subMenu, task, viewStartDate);
        });
    }

    /**
     * Add Name item.
     */
    private addNameItem(menu: Menu, task: Task): void {
        menu.addItem((sub) => {
            const taskName = getTaskDisplayName(task);
            sub.setTitle(`Name: ${taskName.substring(0, 20)}${taskName.length > 20 ? '...' : ''}`)
                .setIcon('pencil')
                .onClick(() => {
                    this.openChangePropertiesModal(task, 'name');
                });
        });
    }

    /**
     * Add Status item.
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
     * Add File item.
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
     * Add Start, End, Deadline, Length items.
     */
    private addPropertyItems(menu: Menu, task: Task, viewStartDate: string | null): void {
        const context: PropertyCalculationContext = {
            task,
            startHour: this.plugin.settings.startHour,
            viewStartDate
        };

        const startParts = this.propertyCalculator.calculateStart(context);
        const endParts = this.propertyCalculator.calculateEnd(context);
        const deadlineParts = this.propertyCalculator.calculateDeadline(task);

        this.addStartItem(menu, task, startParts);
        this.addEndItem(menu, task, endParts);
        this.addDeadlineItem(menu, task, deadlineParts);
        menu.addSeparator();
        this.addLengthItem(menu, task, context);
    }

    /**
     * Add Start item.
     */
    private addStartItem(menu: Menu, task: Task, parts: CalculatedProperty): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle('Start: ', parts))
                .setIcon('play')
                .onClick(() => {
                    this.openChangePropertiesModal(task, 'start');
                });
        });
    }

    /**
     * Add End item.
     */
    private addEndItem(menu: Menu, task: Task, parts: CalculatedProperty): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle('End: ', parts))
                .setIcon('square')
                .onClick(() => {
                    this.openChangePropertiesModal(task, 'end');
                });
        });
    }

    /**
     * Add Deadline item.
     */
    private addDeadlineItem(menu: Menu, task: Task, parts: CalculatedProperty): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle('Deadline: ', parts))
                .setIcon('alert-circle')
                .onClick(() => {
                    this.openChangePropertiesModal(task, 'deadline');
                });
        });
    }

    private openChangePropertiesModal(task: Task, focusField: ChangePropertiesFocusField): void {
        const initialValues: Partial<CreateTaskResult> = {
            content: task.content ?? '',
            startDate: task.startDate,
            startTime: task.startTime,
            endDate: task.endDate,
            endTime: task.endTime,
            deadline: task.deadline,
        };

        new CreateTaskModal(
            this.app,
            async (result) => {
                await this.taskIndex.updateTask(task.id, this.buildTaskUpdatesFromResult(result));
            },
            initialValues,
            {
                title: 'Change Properties',
                submitLabel: 'Save',
                focusField,
            }
        ).open();
    }

    private buildTaskUpdatesFromResult(result: CreateTaskResult): Partial<Task> {
        const startDate = result.startDate?.trim() || undefined;
        const startTime = result.startTime?.trim() || undefined;
        const endTime = result.endTime?.trim() || undefined;
        const explicitEndDate = result.endDate?.trim() || undefined;
        const endDate = !explicitEndDate && endTime ? startDate : explicitEndDate;
        const deadline = result.deadline?.trim() || undefined;

        return {
            content: result.content ?? '',
            startDate,
            startTime,
            endDate,
            endTime,
            deadline,
        };
    }

    /**
     * Add Length (Duration) item.
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