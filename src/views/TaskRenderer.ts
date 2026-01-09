import { App, MarkdownRenderer, Component } from 'obsidian';
import { Task, TaskViewerSettings } from '../types';
import { TaskIndex } from '../services/TaskIndex';

export class TaskRenderer {
    private app: App;
    private taskIndex: TaskIndex;
    // Track which tasks have their children expanded (preserved across re-renders)
    private expandedTaskIds: Set<string> = new Set();

    constructor(app: App, taskIndex: TaskIndex) {
        this.app = app;
        this.taskIndex = taskIndex;
    }

    async render(container: HTMLElement, task: Task, component: Component, settings: TaskViewerSettings) {
        // Time Display
        if (task.startTime) {
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
                    // Format: YYYY-MM-DDTHH:mm>YYYY-MM-DDTHH:mm
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
                    // If it's next day but within visual day (e.g. 25:00), we still just show the time (01:00)
                    // The user requested "01:00のように表示します" (Display like 01:00)

                    // We need to extract just HH:mm from endDate
                    const endH = endDate.getHours().toString().padStart(2, '0');
                    const endMin = endDate.getMinutes().toString().padStart(2, '0');
                    const endStr = `${endH}:${endMin}`;

                    timeText = `${task.startTime}>${endStr}`;
                }
            }

            timeDisplay.innerText = timeText;
        }

        const contentContainer = container.createDiv('task-card__content');

        // Construct full markdown
        // Strip time info from parent task line for display
        const statusChar = task.statusChar || (task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' '));
        let cleanParentLine = `- [${statusChar}] ${task.content}`;

        // Append source file link
        const fileName = task.file.split('/').pop()?.replace('.md', '') || task.file;
        const hasContent = cleanParentLine.replace(/^- \[[xX! -]\]\s*/, '').trim().length > 0;

        if (hasContent) {
            cleanParentLine += `：[[${fileName}]]`;
        } else {
            cleanParentLine += `[[${fileName}]]`;
        }

        // Collapse threshold for children
        const COLLAPSE_THRESHOLD = 3;
        const shouldCollapse = task.children.length >= COLLAPSE_THRESHOLD;

        if (shouldCollapse) {
            // Render parent only first
            await MarkdownRenderer.render(this.app, cleanParentLine, contentContainer, task.file, component);

            // Check if this task was expanded before re-render
            const wasExpanded = this.expandedTaskIds.has(task.id);

            // Create toggle button
            const toggle = contentContainer.createDiv('task-card__children-toggle');

            // Create children container
            const childrenContainer = contentContainer.createDiv('task-card__children');

            // Set initial state based on saved state
            if (wasExpanded) {
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${task.children.length}件の子タスク`;
                toggle.dataset.collapsed = 'false';
                childrenContainer.addClass('task-card__children--expanded');
            } else {
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${task.children.length}件の子タスク`;
                toggle.dataset.collapsed = 'true';
                childrenContainer.addClass('task-card__children--collapsed');
            }

            // Render children
            const cleanChildren = task.children.map(childLine => {
                const cleaned = childLine
                    .replace(/\s*@[\w\-:>T]+(?:\s*==>.*)?/g, '')
                    .trimEnd();
                return cleaned;
            });

            const childrenText = cleanChildren.join('\n');
            await MarkdownRenderer.render(this.app, childrenText, childrenContainer, task.file, component);

            // Toggle click handler
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = toggle.dataset.collapsed === 'true';
                if (isCollapsed) {
                    toggle.dataset.collapsed = 'false';
                    toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${task.children.length}件の子タスク`;
                    childrenContainer.removeClass('task-card__children--collapsed');
                    childrenContainer.addClass('task-card__children--expanded');
                    // Save expanded state
                    this.expandedTaskIds.add(task.id);
                } else {
                    toggle.dataset.collapsed = 'true';
                    toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${task.children.length}件の子タスク`;
                    childrenContainer.removeClass('task-card__children--expanded');
                    childrenContainer.addClass('task-card__children--collapsed');
                    // Remove from expanded state
                    this.expandedTaskIds.delete(task.id);
                }
            });

            // Handle checkboxes in children container
            this.setupChildCheckboxHandlers(childrenContainer, task, 0);
        } else {
            // Original behavior: render everything together
            const cleanChildren = task.children.map(childLine => {
                const cleaned = childLine
                    .replace(/\s*@[\w\-:>T]+(?:\s*==>.*)?/g, '')
                    .trimEnd();
                return '    ' + cleaned;
            });

            const fullText = [cleanParentLine, ...cleanChildren].join('\n');

            // Use MarkdownRenderer
            await MarkdownRenderer.render(this.app, fullText, contentContainer, task.file, component);
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
            // Prevent drag/selection start
            link.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });
        });

        // Handle Checkbox Clicks
        // For collapsed mode, parent checkbox is handled here, children are handled separately
        const mainCheckbox = contentContainer.querySelector(':scope > ul > li > input[type="checkbox"]');
        if (mainCheckbox) {
            mainCheckbox.addEventListener('click', () => {
                const isChecked = (mainCheckbox as HTMLInputElement).checked;
                const newStatus = isChecked ? 'done' : 'todo';
                const newStatusChar = isChecked ? 'x' : ' ';
                this.taskIndex.updateTask(task.id, {
                    status: newStatus,
                    statusChar: newStatusChar
                });
            });
            mainCheckbox.addEventListener('pointerdown', (e) => e.stopPropagation());
        }

        // For non-collapsed mode, also handle children checkboxes (old behavior)
        if (!shouldCollapse) {
            const checkboxes = contentContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach((checkbox, index) => {
                if (index === 0) return; // Already handled above
                checkbox.addEventListener('click', () => {
                    const childLineIndex = index - 1;
                    if (childLineIndex < task.children.length) {
                        let childLine = task.children[childLineIndex];
                        const match = childLine.match(/\[(.)\]/);
                        if (match) {
                            const currentChar = match[1];
                            const newChar = currentChar === ' ' ? 'x' : ' ';
                            childLine = childLine.replace(`[${currentChar}]`, `[${newChar}]`);
                        }
                        const absoluteLineNumber = task.line + 1 + childLineIndex;
                        this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
                    }
                });
                checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());
            });
        }
    }

    /**
     * Setup checkbox handlers for children in a collapsed container
     */
    private setupChildCheckboxHandlers(container: HTMLElement, task: Task, startOffset: number): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            checkbox.addEventListener('click', () => {
                const childLineIndex = startOffset + index;
                if (childLineIndex < task.children.length) {
                    let childLine = task.children[childLineIndex];
                    const match = childLine.match(/\[(.)\]/);
                    if (match) {
                        const currentChar = match[1];
                        const newChar = currentChar === ' ' ? 'x' : ' ';
                        childLine = childLine.replace(`[${currentChar}]`, `[${newChar}]`);
                    }
                    const absoluteLineNumber = task.line + 1 + childLineIndex;
                    this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
                }
            });
            checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());
        });
    }
}
