import { App, MarkdownRenderer, Component } from 'obsidian';
import { Task, TaskViewerSettings, isCompleteStatusChar } from '../types';
import { TaskIndex } from '../services/core/TaskIndex';
import { DateUtils } from '../utils/DateUtils';
import { ChildItemBuilder } from './renderers/ChildItemBuilder';
import { ChildSectionRenderer } from './renderers/ChildSectionRenderer';
import { CheckboxWiring } from './renderers/CheckboxWiring';

export class TaskRenderer {
    private app: App;
    private taskIndex: TaskIndex;
    // Track which tasks have their children expanded (preserved across re-renders)
    private expandedTaskIds: Set<string> = new Set();
    private childItemBuilder: ChildItemBuilder;
    private childSectionRenderer: ChildSectionRenderer;
    private checkboxWiring: CheckboxWiring;

    constructor(app: App, taskIndex: TaskIndex) {
        this.app = app;
        this.taskIndex = taskIndex;
        this.checkboxWiring = new CheckboxWiring(app, taskIndex);
        this.childItemBuilder = new ChildItemBuilder(taskIndex);
        this.childSectionRenderer = new ChildSectionRenderer(app, this.checkboxWiring);
    }

    async render(container: HTMLElement, task: Task, component: Component, settings: TaskViewerSettings, options?: { topRight?: 'time' | 'deadline' | 'none' }) {
        // Top-right display: time (default), deadline date, or none
        const topRight = options?.topRight ?? 'time';

        if (topRight === 'time' && task.startTime) {
            const timeDisplay = container.createDiv('task-card__time');
            let timeText = task.startTime;

            if (task.endTime) {
                // Parse dates to compare with visual day boundary
                const startDate = new Date(`${task.startDate}T${task.startTime}`);
                let endDate: Date;

                if (task.endTime.includes('T')) {
                    // Full ISO format
                    endDate = new Date(task.endTime);
                } else {
                    // Simple HH:mm format
                    endDate = new Date(`${task.startDate}T${task.endTime}`);
                    // Handle overnight times (if end time is earlier than start time, assume next day)
                    if (endDate < startDate) {
                        endDate.setDate(endDate.getDate() + 1);
                    }
                }

                // Calculate Visual Day Limit
                // The limit is the next day at startHour
                const limitDate = new Date(`${task.startDate}T${settings.startHour.toString().padStart(2, '0')}:00`);
                limitDate.setDate(limitDate.getDate() + 1);

                if (endDate > limitDate) {
                    // Exceeds visual day: Show full range
                    const startStr = `${task.startDate}T${task.startTime}`;

                    const endY = endDate.getFullYear();
                    const endM = (endDate.getMonth() + 1).toString().padStart(2, '0');
                    const endD = endDate.getDate().toString().padStart(2, '0');
                    const endH = endDate.getHours().toString().padStart(2, '0');
                    const endMin = endDate.getMinutes().toString().padStart(2, '0');
                    const endStr = `${endY}-${endM}-${endD}T${endH}:${endMin}`;

                    timeText = `${startStr}>${endStr}`;
                } else {
                    // Within visual day: Show time only
                    const endH = endDate.getHours().toString().padStart(2, '0');
                    const endMin = endDate.getMinutes().toString().padStart(2, '0');
                    const endStr = `${endH}:${endMin}`;

                    timeText = `${task.startTime}>${endStr}`;
                }
            }

            timeDisplay.innerText = timeText;
        } else if (topRight === 'deadline' && task.deadline) {
            const timeDisplay = container.createDiv('task-card__time');
            const parts = task.deadline.split('T');
            timeDisplay.innerText = parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
        }

        const contentContainer = container.createDiv('task-card__content');

        // Construct parent task line
        const statusChar = task.statusChar || ' ';

        // Check if task is overdue and add warning icon
        let overdueIcon = '';
        if (!isCompleteStatusChar(task.statusChar, settings.completeStatusChars)) {
            if (task.deadline && DateUtils.isPastDeadline(task.deadline, settings.startHour)) {
                overdueIcon = '🚨 ';
            } else if (task.startDate && DateUtils.isPastDate(task.startDate, task.startTime, settings.startHour)) {
                overdueIcon = '⚠️ ';
            } else if (task.endDate) {
                const endTime = task.endTime?.includes('T') ? task.endTime.split('T')[1] : task.endTime;
                if (DateUtils.isPastDate(task.endDate, endTime, settings.startHour)) {
                    overdueIcon = '⚠️ ';
                }
            }
        }

        let cleanParentLine = `- [${statusChar}] ${overdueIcon}${task.content}`;

        // Append source file link
        const filePath = task.file.replace(/\.md$/, '');
        const fileName = task.file.split('/').pop()?.replace('.md', '') || task.file;
        const hasContent = cleanParentLine.replace(/^- \[[xX! -]\]\s*/, '').trim().length > 0;

        if (hasContent) {
            cleanParentLine += ` : [[${filePath}|${fileName}]]`;
        } else {
            cleanParentLine += `[[${filePath}|${fileName}]]`;
        }

        // Inline child tasks rendering
        const COLLAPSE_THRESHOLD = 3;

        if (task.childLines.length > 0) {
            // wikilink 展開後の実際の items 数で折りたたみ判定
            const items = this.childItemBuilder.buildInlineChildItems(task, '');
            if (items.length >= COLLAPSE_THRESHOLD) {
                // Collapsed: render parent alone, then children in collapsible container
                await MarkdownRenderer.render(this.app, cleanParentLine, contentContainer, task.file, component);
                await this.childSectionRenderer.renderCollapsed(
                    contentContainer, items, this.expandedTaskIds, task.id,
                    task.file, component, settings, task.startDate
                );
            } else {
                // Non-collapsed: render parent + children together (indent needed)
                const indentedItems = this.childItemBuilder.buildInlineChildItems(task, '    ');
                await this.childSectionRenderer.renderParentWithChildren(
                    contentContainer, cleanParentLine, indentedItems,
                    task.file, component, settings, task.startDate
                );
            }
        } else {
            // No inline children: render parent only
            await MarkdownRenderer.render(this.app, cleanParentLine, contentContainer, task.file, component);
        }

        // Frontmatter task: render child tasks from childIds
        if (task.parserId === 'frontmatter' && task.childIds.length > 0) {
            const childTasks: Task[] = [];
            for (const childId of task.childIds) {
                if (childId === task.id) continue; // 防御: 自己参照スキップ
                const ct = this.taskIndex.getTask(childId);
                if (ct) childTasks.push(ct);
            }
            if (childTasks.length > 0) {
                const items = this.childItemBuilder.buildFrontmatterChildItems(task, childTasks);
                const fmShouldCollapse = items.length >= COLLAPSE_THRESHOLD;
                if (fmShouldCollapse) {
                    await this.childSectionRenderer.renderCollapsed(
                        contentContainer, items, this.expandedTaskIds,
                        task.id + ':fm-children', task.file, component, settings, task.startDate
                    );
                } else {
                    await this.childSectionRenderer.renderExpanded(
                        contentContainer, items, task.file, component, settings, task.startDate
                    );
                }
            }
        }

        // Handle Internal Links
        const internalLinks = contentContainer.querySelectorAll('a.internal-link');
        internalLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const target = (link as HTMLElement).dataset.href;
                if (target) {
                    this.app.workspace.openLinkText(target, task.file, true);
                }
            });
            link.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });
        });

        // Handle parent checkbox
        const mainCheckbox = contentContainer.querySelector(':scope > ul > li > input[type="checkbox"]');
        if (mainCheckbox) {
            this.checkboxWiring.wireParentCheckbox(mainCheckbox, task.id, settings);
        }
    }
}
