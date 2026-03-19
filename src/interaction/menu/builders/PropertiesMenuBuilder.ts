import { App, Menu } from 'obsidian';
import { Task, DisplayTask, PropertyType } from '../../../types';
import { TaskIndex } from '../../../services/core/TaskIndex';
import TaskViewerPlugin from '../../../main';
import { PropertyCalculator, PropertyCalculationContext, CalculatedProperty } from '../PropertyCalculator';
import { PropertyFormatter } from '../PropertyFormatter';
import { CreateTaskModal, CreateTaskResult } from '../../../modals/CreateTaskModal';
import { DateUtils } from '../../../utils/DateUtils';
import { getTaskDisplayName } from '../../../utils/TaskContent';
import { buildStatusOptions, createStatusTitle } from '../../../constants/statusOptions';
import { openFileInExistingOrNewTab } from '../../../utils/NavigationUtils';
import { DailyNoteUtils } from '../../../utils/DailyNoteUtils';
import { t } from '../../../i18n';

type ChangePropertiesFocusField = 'name' | 'start' | 'end' | 'due';

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
    buildPropertiesSubmenu(menu: Menu, task: DisplayTask, viewStartDate: string | null): void {
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle(t('menu.properties'))
                .setIcon('settings')
                .setSubmenu() as Menu;

            // Closure that closes the root menu before opening a modal.
            // On mobile, Obsidian menus stay open until explicitly closed.
            const openModal = (focusField: ChangePropertiesFocusField) => {
                menu.close();
                this.openChangePropertiesModal(task, focusField, viewStartDate);
            };

            // Requested order:
            // file / --- / name / start / end / due / --- / length
            // (Status is now added at root level by the caller)
            this.addFileItem(subMenu, task);
            subMenu.addSeparator();
            this.addNameItem(subMenu, task, openModal);
            this.addPropertyItems(subMenu, task, viewStartDate, openModal);
        });
    }

    /**
     * Add Name item.
     */
    private addNameItem(menu: Menu, task: Task, openModal: (focusField: ChangePropertiesFocusField) => void): void {
        menu.addItem((sub) => {
            const taskName = getTaskDisplayName(task);
            sub.setTitle(t('menu.name', { name: taskName.substring(0, 20) + (taskName.length > 20 ? '...' : '') }))
                .setIcon('pencil')
                .onClick(() => {
                    openModal('name');
                });
        });
    }

    /**
     * Add Status submenu to the given menu.
     */
    addStatusSubmenu(menu: Menu, task: Task): void {
        menu.addItem((sub) => {
            const statusChar = task.statusChar;
            const statusDisplay = `[${statusChar}]`;

            (sub as any).setTitle(t('menu.status', { status: statusDisplay }))
                .setIcon('check-square')
                .setSubmenu();

            const statusMenu = (sub as any).submenu as Menu;

            buildStatusOptions(this.plugin.settings.statusMenuChars).forEach(s => {
                statusMenu.addItem(item => {
                    item.setTitle(createStatusTitle(s))
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
            sub.setTitle(t('menu.file', { name: task.file.split('/').pop() || '' }))
                .setIcon('file-text')
                .onClick(() => {
                    if (this.plugin.settings.reuseExistingTab) {
                        openFileInExistingOrNewTab(this.app, task.file);
                    } else {
                        void this.app.workspace.openLinkText(task.file, '', true);
                    }
                });
        });
    }

    /**
     * Add Start, End, Due, Length items.
     */
    private addPropertyItems(menu: Menu, task: DisplayTask, viewStartDate: string | null, openModal: (focusField: ChangePropertiesFocusField) => void): void {
        const context: PropertyCalculationContext = {
            task,
            startHour: this.plugin.settings.startHour,
            viewStartDate
        };

        const startParts = this.propertyCalculator.calculateStart(context);
        const endParts = this.propertyCalculator.calculateEnd(context);
        const dueParts = this.propertyCalculator.calculateDue(task);

        this.addStartItem(menu, task, startParts, openModal);
        this.addEndItem(menu, task, endParts, openModal);
        this.addDueItem(menu, task, dueParts, openModal);
        menu.addSeparator();
        this.addLengthItem(menu, startParts, endParts, context.startHour);
        this.addTagsItem(menu, task);
        this.addColorItem(menu, task);
        this.addLinestyleItem(menu, task);
        this.addCustomPropertiesItems(menu, task);
    }

    /**
     * Add Start item.
     */
    private addStartItem(menu: Menu, task: Task, parts: CalculatedProperty, openModal: (focusField: ChangePropertiesFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle(t('menu.startLabel'), parts))
                .setIcon('play')
                .onClick(() => {
                    openModal('start');
                });
        });
    }

    /**
     * Add End item.
     */
    private addEndItem(menu: Menu, task: Task, parts: CalculatedProperty, openModal: (focusField: ChangePropertiesFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle(t('menu.endLabel'), parts))
                .setIcon('square')
                .onClick(() => {
                    openModal('end');
                });
        });
    }

    /**
     * Add Due item.
     */
    private addDueItem(menu: Menu, task: Task, parts: CalculatedProperty, openModal: (focusField: ChangePropertiesFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle(t('menu.dueLabel'), parts))
                .setIcon('alert-circle')
                .onClick(() => {
                    openModal('due');
                });
        });
    }

    private openChangePropertiesModal(task: DisplayTask, focusField: ChangePropertiesFocusField, viewStartDate: string | null = null): void {
        // Build implicit placeholders from PropertyCalculator results
        const context: PropertyCalculationContext = {
            task,
            startHour: this.plugin.settings.startHour,
            viewStartDate
        };
        const startCalc = this.propertyCalculator.calculateStart(context);
        const endCalc = this.propertyCalculator.calculateEnd(context);

        // initialValues: explicit values only (implicit values excluded → shown as placeholders)
        const initialValues: Partial<CreateTaskResult> = {
            content: task.content ?? '',
            startDate: startCalc.dateImplicit ? undefined : task.startDate,
            startTime: startCalc.timeImplicit ? undefined : task.startTime,
            endDate: endCalc.dateImplicit ? undefined : task.endDate,
            endTime: endCalc.timeImplicit ? undefined : task.endTime,
            due: task.due,
        };

        new CreateTaskModal(
            this.app,
            async (result) => {
                await this.taskIndex.updateTask(
                    task.id,
                    this.buildTaskUpdatesFromResult(result, task, startCalc, endCalc)
                );
            },
            initialValues,
            {
                title: t('modal.changeProperties'),
                submitLabel: t('modal.save'),
                focusField,
                startHour: this.plugin.settings.startHour,
                dailyNoteDate: DailyNoteUtils.parseDateFromFilePath(this.app, task.file) ?? undefined,
            }
        ).open();
    }

    private buildTaskUpdatesFromResult(
        result: CreateTaskResult,
        task: DisplayTask,
        startCalc: CalculatedProperty,
        endCalc: CalculatedProperty
    ): Partial<Task> {
        const startDate = result.startDate?.trim() || undefined;
        const startTime = result.startTime?.trim() || undefined;
        const endDate = result.endDate?.trim() || undefined;
        const endTime = result.endTime?.trim() || undefined;
        const due = result.due?.trim() || undefined;

        const updates: Partial<Task> = { content: result.content ?? '' };

        if (task.parserId === 'frontmatter') {
            // frontmatter: 常に解決済み値を書く（空欄→暗黙値で埋める）
            updates.startDate = startDate ?? startCalc.date;
            updates.startTime = startTime ?? startCalc.time;
            updates.endDate = endDate ?? endCalc.date;
            updates.endTime = endTime ?? endCalc.time;
            if (due !== undefined) updates.due = due;
        } else {
            // inline: 空欄は省略維持（startDateInherited 保護）
            if (startDate !== undefined) updates.startDate = startDate;
            if (startTime !== undefined) updates.startTime = startTime;
            if (endDate !== undefined) updates.endDate = endDate;
            if (endTime !== undefined) updates.endTime = endTime;
            if (due !== undefined) updates.due = due;
        }

        return updates;
    }

    private addTagsItem(menu: Menu, task: Task): void {
        const tagsText = task.tags.length > 0 ? task.tags.join(', ') : '-';
        menu.addItem((item) => {
            item.setTitle(t('menu.tagsLabel', { value: tagsText }))
                .setIcon('tag')
                .setDisabled(true);
        });
    }

    private addColorItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.colorLabel', { value: task.color || '-' }))
                .setIcon('palette')
                .setDisabled(true);
        });
    }

    private addLinestyleItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.linestyleLabel', { value: task.linestyle || '-' }))
                .setIcon('minus')
                .setDisabled(true);
        });
    }

    private addCustomPropertiesItems(menu: Menu, task: Task): void {
        const keys = Object.keys(task.properties);
        if (keys.length === 0) return;

        menu.addSeparator();
        for (const key of keys) {
            const prop = task.properties[key];
            menu.addItem((item) => {
                item.setTitle(`${key}: ${prop.value}`)
                    .setIcon(this.getPropertyTypeIcon(prop.type))
                    .setDisabled(true);
            });
        }
    }

    private getPropertyTypeIcon(type: PropertyType): string {
        switch (type) {
            case 'number':  return 'hash';
            case 'boolean': return 'toggle-left';
            case 'array':   return 'list';
            default:        return 'type';
        }
    }

    private addLengthItem(menu: Menu, startParts: CalculatedProperty, endParts: CalculatedProperty, startHour: number): void {
        let lengthText = '-';

        if (startParts.date) {
            const durationMs = DateUtils.getTaskDurationMs(
                startParts.date,
                startParts.time,
                endParts.date,
                endParts.time,
                startHour
            );
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
        }

        menu.addItem((item) => {
            item.setTitle(t('menu.lengthLabel', { value: lengthText }))
                .setIcon('clock')
                .setDisabled(true);
        });
    }
}