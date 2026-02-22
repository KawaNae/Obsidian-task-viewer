import { Menu } from 'obsidian';
import type { Task } from '../../types';
import type { FilterState, FilterCondition, FilterProperty } from '../../services/filter/FilterTypes';
import { EMPTY_FILTER_STATE } from '../../services/filter/FilterTypes';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';

export interface FilterMenuCallbacks {
    onFilterChange: () => void;
    getTasks: () => Task[];
    getFileColor: (filePath: string) => string | null;
}

type FilterTab = 'file' | 'tag' | 'status';

/**
 * Multi-property filter menu component.
 * Replaces FileFilterMenu with support for file, tag, and status filtering.
 * Internally uses FilterState for composable filter conditions.
 */
export class FilterMenuComponent {
    private state: FilterState = { ...EMPTY_FILTER_STATE };

    getFilterState(): FilterState {
        return this.state;
    }

    setFilterState(state: FilterState): void {
        this.state = state;
    }

    isTaskVisible(task: Task): boolean {
        return TaskFilterEngine.evaluate(task, this.state);
    }

    hasActiveFilters(): boolean {
        return this.state.conditions.length > 0;
    }

    showMenu(event: MouseEvent, callbacks: FilterMenuCallbacks): void {
        const tasks = callbacks.getTasks();
        const menu = new Menu();

        // Show active filter summary at top
        if (this.state.conditions.length > 0) {
            for (const condition of this.state.conditions) {
                menu.addItem(item => {
                    (item as any).setTitle(`✕ ${this.formatConditionLabel(condition)}`)
                        .onClick(() => {
                            this.removeCondition(condition.id);
                            callbacks.onFilterChange();
                        });
                });
            }
            menu.addSeparator();
            menu.addItem(item => {
                (item as any).setTitle('Clear all filters')
                    .setIcon('trash')
                    .onClick(() => {
                        this.state = { ...EMPTY_FILTER_STATE };
                        callbacks.onFilterChange();
                    });
            });
            menu.addSeparator();
        }

        // File filter submenu
        this.addFileFilterSection(menu, tasks, callbacks);

        // Tag filter submenu
        this.addTagFilterSection(menu, tasks);

        // Status filter submenu
        this.addStatusFilterSection(menu, tasks);

        menu.showAtPosition({ x: event.pageX, y: event.pageY });

        // Store callbacks for sub-menu usage
        this.pendingCallbacks = callbacks;
    }

    private pendingCallbacks: FilterMenuCallbacks | null = null;

    private addFileFilterSection(menu: Menu, tasks: Task[], callbacks: FilterMenuCallbacks): void {
        const files = FilterValueCollector.collectFiles(tasks);
        if (files.length === 0) return;

        const selectedFiles = this.getSelectedValues('file');

        menu.addItem(item => {
            (item as any).setTitle('Files')
                .setIcon('folder')
                .setIsLabel(true);
        });

        for (const file of files) {
            const fileName = file.split('/').pop() || file;
            const isVisible = selectedFiles === null || selectedFiles.has(file);
            const color = callbacks.getFileColor(file);

            menu.addItem(item => {
                (item as any).setTitle(fileName)
                    .setChecked(isVisible)
                    .onClick(() => {
                        this.toggleValue('file', file, files);
                        callbacks.onFilterChange();
                    });

                (item as any).setIcon('circle');
                const iconEl = (item as any).dom?.querySelector('.menu-item-icon');
                if (iconEl) {
                    if (color) {
                        iconEl.style.color = color;
                        iconEl.style.fill = color;
                    } else {
                        iconEl.style.visibility = 'hidden';
                    }
                }
            });
        }

        menu.addSeparator();
    }

    private addTagFilterSection(menu: Menu, tasks: Task[]): void {
        const tags = FilterValueCollector.collectTags(tasks);
        if (tags.length === 0) return;

        const selectedTags = this.getSelectedValues('tag');

        menu.addItem(item => {
            (item as any).setTitle('Tags')
                .setIcon('hash')
                .setIsLabel(true);
        });

        for (const tag of tags) {
            const isVisible = selectedTags === null || selectedTags.has(tag);
            menu.addItem(item => {
                (item as any).setTitle(`#${tag}`)
                    .setChecked(isVisible)
                    .onClick(() => {
                        this.toggleValue('tag', tag, tags);
                        this.pendingCallbacks?.onFilterChange();
                    });
            });
        }

        menu.addSeparator();
    }

    private addStatusFilterSection(menu: Menu, tasks: Task[]): void {
        const statuses = FilterValueCollector.collectStatuses(tasks);
        if (statuses.length === 0) return;

        const selectedStatuses = this.getSelectedValues('status');

        menu.addItem(item => {
            (item as any).setTitle('Status')
                .setIcon('check-square')
                .setIsLabel(true);
        });

        for (const status of statuses) {
            const label = status === ' ' ? '[ ] Todo' : `[${status}] ${this.getStatusLabel(status)}`;
            const isVisible = selectedStatuses === null || selectedStatuses.has(status);
            menu.addItem(item => {
                (item as any).setTitle(label)
                    .setChecked(isVisible)
                    .onClick(() => {
                        this.toggleValue('status', status, statuses);
                        this.pendingCallbacks?.onFilterChange();
                    });
            });
        }
    }

    /**
     * Get currently selected values for a property, or null if no filter exists for it.
     */
    private getSelectedValues(property: FilterProperty): Set<string> | null {
        const condition = this.state.conditions.find(
            c => c.property === property && c.operator === 'includes' && c.value.type === 'stringSet'
        );
        if (!condition || condition.value.type !== 'stringSet') return null;
        return new Set(condition.value.values);
    }

    /**
     * Toggle a value in the includes set for a property.
     * If toggling would result in all values selected, remove the condition entirely.
     */
    private toggleValue(property: FilterProperty, value: string, allValues: string[]): void {
        const existingIndex = this.state.conditions.findIndex(
            c => c.property === property && c.operator === 'includes'
        );

        if (existingIndex === -1) {
            // No filter for this property yet -> create one excluding the toggled value
            const remaining = allValues.filter(v => v !== value);
            if (remaining.length === 0) return; // Don't filter if this would hide everything
            this.state.conditions.push({
                id: `${property}-includes`,
                property,
                operator: 'includes',
                value: { type: 'stringSet', values: remaining },
            });
        } else {
            const condition = this.state.conditions[existingIndex];
            if (condition.value.type !== 'stringSet') return;
            const current = new Set(condition.value.values);

            if (current.has(value)) {
                current.delete(value);
                if (current.size === 0) {
                    // Don't allow empty filter - would hide everything
                    return;
                }
            } else {
                current.add(value);
            }

            // If all values are now selected, remove the condition
            if (current.size === allValues.length) {
                this.state.conditions.splice(existingIndex, 1);
            } else {
                condition.value = { type: 'stringSet', values: Array.from(current) };
            }
        }
    }

    private removeCondition(id: string): void {
        this.state.conditions = this.state.conditions.filter(c => c.id !== id);
    }

    private formatConditionLabel(condition: FilterCondition): string {
        const propLabel = this.getPropertyLabel(condition.property);
        if (condition.value.type === 'stringSet') {
            const count = condition.value.values.length;
            return `${propLabel}: ${count} selected`;
        }
        if (condition.value.type === 'string') {
            return `${propLabel} ${condition.operator} "${condition.value.value}"`;
        }
        return `${propLabel}: ${condition.operator}`;
    }

    private getPropertyLabel(property: FilterProperty): string {
        switch (property) {
            case 'file': return 'File';
            case 'tag': return 'Tag';
            case 'status': return 'Status';
            case 'hasStartDate': return 'Start date';
            case 'hasDeadline': return 'Deadline';
            case 'content': return 'Content';
            default: return property;
        }
    }

    private getStatusLabel(statusChar: string): string {
        switch (statusChar) {
            case ' ': return 'Todo';
            case 'x': case 'X': return 'Done';
            case '-': return 'Cancelled';
            case '!': return 'Exception';
            default: return statusChar;
        }
    }
}
