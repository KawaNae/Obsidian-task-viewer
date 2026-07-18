import type { App, Menu } from 'obsidian';
import type { Task, DisplayTask, PropertyType } from '../../../types';
import type { TaskWriteService } from '../../../services/data/TaskWriteService';
import type TaskViewerPlugin from '../../../main';
import type { PropertyCalculator, PropertyCalculationContext, CalculatedProperty } from '../PropertyCalculator';
import type { PropertyFormatter } from '../PropertyFormatter';
import { DateUtils } from '../../../utils/DateUtils';
import { getTaskDisplayName } from '../../../services/parsing/utils/TaskContent';
import { buildStatusOptions, createStatusTitle } from '../../../constants/statusOptions';
import { openFileInExistingOrNewTab } from '../../../utils/NavigationUtils';
import { t } from '../../../i18n';
import { TaskStyling } from '../../../views/sharedUI/TaskStyling';
import type { TaskHubFocusField } from '../../../modals/hub/TaskHubForm';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveMask,
    getEffectiveTags, getEffectiveProperties,
} from '../../../services/data/EffectiveProperties';
import { PROPERTY_ICONS } from '../../../constants/propertyIcons';

type OpenHub = (field: TaskHubFocusField) => void;

/**
 * Properties sub menu builder.
 */
export class PropertiesMenuBuilder {
    constructor(
        private app: App,
        private writeService: TaskWriteService,
        private plugin: TaskViewerPlugin,
        private propertyCalculator: PropertyCalculator,
        private propertyFormatter: PropertyFormatter
    ) { }

    /**
     * Build Properties submenu. 各項目はタスクハブモーダルの該当フィールドに
     * focus した状態で開く（openHub は MenuHandler が配線）。
     */
    buildPropertiesSubmenu(menu: Menu, task: DisplayTask, viewStartDate: string | null, openHub: OpenHub): void {
        menu.addItem((item) => {
            const subMenu = item
                .setTitle(t('menu.properties'))
                .setIcon('settings')
                .setSubmenu();

            // Closure that closes the root menu before opening the hub.
            // On mobile, Obsidian menus stay open until explicitly closed.
            const openModal = (focusField: TaskHubFocusField) => {
                menu.close();
                openHub(focusField);
            };

            // Requested order:
            // file / --- / name / start / end / due / --- / length / tags / color / linestyle / mask / custom
            // (Status is now added at root level by the caller)
            this.addFileItem(subMenu, task, menu);
            subMenu.addSeparator();
            this.addNameItem(subMenu, task, openModal);
            this.addPropertyItems(subMenu, task, viewStartDate, openModal);
        });
    }

    /**
     * Add Name item.
     */
    private addNameItem(menu: Menu, task: Task, openModal: (focusField: TaskHubFocusField) => void): void {
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

            sub.setTitle(t('menu.status', { status: statusDisplay }))
                .setIcon('check-square')
                .setSubmenu();

            const statusMenu = sub.submenu;

            buildStatusOptions(this.plugin.settings.statusDefinitions).forEach(s => {
                statusMenu.addItem(item => {
                    item.setTitle(createStatusTitle(s))
                        .setChecked(task.statusChar === s.char)
                        .onClick(async () => {
                            menu.close();
                            await this.writeService.updateTask(task.id, {
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
    private addFileItem(menu: Menu, task: Task, rootMenu?: Menu): void {
        menu.addItem((sub) => {
            sub.setTitle(t('menu.file', { name: task.file.split('/').pop() || '' }))
                .setIcon('file-text')
                .onClick(() => {
                    (rootMenu ?? menu).close();
                    if (this.plugin.settings.reuseExistingTab) {
                        openFileInExistingOrNewTab(this.app, task.file);
                    } else {
                        void this.app.workspace.openLinkText(task.file, '', true);
                    }
                });

            if (sub.dom) {
                const titleEl = sub.dom.querySelector('.menu-item-title');
                if (titleEl instanceof HTMLElement) {
                    const fileName = task.file.split('/').pop() || '';
                    titleEl.empty();
                    titleEl.appendText(t('menu.filePrefix'));
                    const nameSpan = titleEl.createSpan();
                    nameSpan.setText(fileName);
                    const color = getEffectiveColor(task);
                    if (color) {
                        const hsl = TaskStyling.hexToHSL(color);
                        if (hsl) {
                            nameSpan.style.color = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
                        }
                    } else {
                        nameSpan.style.color = 'var(--interactive-accent)';
                    }
                }
            }
        });
    }

    /**
     * Add Start, End, Due, Length, Tags, Color, Linestyle, Mask, and Custom Properties items.
     */
    private addPropertyItems(menu: Menu, task: DisplayTask, viewStartDate: string | null, openModal: (focusField: TaskHubFocusField) => void): void {
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
        this.addTagsItem(menu, task, openModal);
        this.addColorItem(menu, task, openModal);
        this.addLinestyleItem(menu, task, openModal);
        this.addMaskItem(menu, task, openModal);
        this.addCustomPropertiesItems(menu, task, openModal);
    }

    /**
     * Add Start item.
     */
    private addStartItem(menu: Menu, task: Task, parts: CalculatedProperty, openModal: (focusField: TaskHubFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle(t('menu.startLabel'), parts))
                .setIcon(PROPERTY_ICONS.start)
                .onClick(() => {
                    openModal('start');
                });
        });
    }

    /**
     * Add End item.
     */
    private addEndItem(menu: Menu, task: Task, parts: CalculatedProperty, openModal: (focusField: TaskHubFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle(t('menu.endLabel'), parts))
                .setIcon(PROPERTY_ICONS.end)
                .onClick(() => {
                    openModal('end');
                });
        });
    }

    /**
     * Add Due item.
     */
    private addDueItem(menu: Menu, task: Task, parts: CalculatedProperty, openModal: (focusField: TaskHubFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(this.propertyFormatter.createPropertyTitle(t('menu.dueLabel'), parts))
                .setIcon(PROPERTY_ICONS.due)
                .onClick(() => {
                    openModal('due');
                });
        });
    }

    private addTagsItem(menu: Menu, task: Task, openModal: (focusField: TaskHubFocusField) => void): void {
        const tags = getEffectiveTags(task);
        const tagsText = tags.length > 0 ? tags.join(', ') : '-';
        menu.addItem((item) => {
            item.setTitle(t('menu.tagsLabel', { value: tagsText }))
                .setIcon(PROPERTY_ICONS.tags)
                .onClick(() => openModal('tags'));
        });
    }

    private addColorItem(menu: Menu, task: Task, openModal: (focusField: TaskHubFocusField) => void): void {
        const color = getEffectiveColor(task);
        menu.addItem((item) => {
            item.setTitle(t('menu.colorLabel', { value: color || '-' }))
                .setIcon(PROPERTY_ICONS.color)
                .onClick(() => openModal('color'));

            if (color && item.dom) {
                const titleEl = item.dom.querySelector('.menu-item-title');
                if (titleEl) {
                    titleEl.empty();
                    titleEl.appendText(t('menu.colorPrefix'));
                    const swatch = titleEl.createSpan('menu-color-swatch');
                    swatch.style.backgroundColor = /^[0-9a-fA-F]{3,6}$/.test(color)
                        ? '#' + color
                        : color;
                    titleEl.appendText(color);
                }
            }
        });
    }

    private addLinestyleItem(menu: Menu, task: Task, openModal: (focusField: TaskHubFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.linestyleLabel', { value: getEffectiveLinestyle(task) || '-' }))
                .setIcon(PROPERTY_ICONS.linestyle)
                .onClick(() => openModal('linestyle'));
        });
    }

    private addMaskItem(menu: Menu, task: Task, openModal: (focusField: TaskHubFocusField) => void): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.maskLabel', { value: getEffectiveMask(task) || '-' }))
                .setIcon(PROPERTY_ICONS.mask)
                .onClick(() => openModal('mask'));
        });
    }

    private addCustomPropertiesItems(menu: Menu, task: Task, openModal: (focusField: TaskHubFocusField) => void): void {
        const properties = getEffectiveProperties(task);
        const keys = Object.keys(properties);
        if (keys.length === 0) return;

        menu.addSeparator();
        for (const key of keys) {
            const prop = properties[key];
            menu.addItem((item) => {
                item.setTitle(`${key}: ${prop.value}`)
                    .setIcon(this.getPropertyTypeIcon(prop.type))
                    .onClick(() => openModal('properties'));
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