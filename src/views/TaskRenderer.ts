import { App, MarkdownRenderer, Component } from 'obsidian';
import { Task, TaskViewerSettings } from '../types';
import { TaskIndex } from '../services/TaskIndex';

export class TaskRenderer {
    private app: App;
    private taskIndex: TaskIndex;

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

        // Clean child lines: remove @ notation and add proper indentation for nesting
        const cleanChildren = task.children.map(childLine => {
            // Remove @... notation (matches @date, @date>time, @future, etc.)
            // Pattern: @... up to the next space or end of line, including ==> commands
            const cleaned = childLine
                .replace(/\s*@[\w\-:>T]+(?:\s*==>.*)?/g, '')
                .trimEnd();
            // Add 4-space indent so children render nested under parent task
            return '    ' + cleaned;
        });

        const fullText = [cleanParentLine, ...cleanChildren].join('\n');

        // Use MarkdownRenderer
        await MarkdownRenderer.render(this.app, fullText, contentContainer, task.file, component);

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
        const checkboxes = contentContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            checkbox.addEventListener('click', (e) => {
                // If it's the main task (index 0)
                if (index === 0) {
                    const isChecked = (checkbox as HTMLInputElement).checked;
                    const newStatus = isChecked ? 'done' : 'todo';

                    // Update statusChar as well to ensure visual change
                    // If checking: default to 'x'
                    // If unchecking: default to ' '
                    const newStatusChar = isChecked ? 'x' : ' ';

                    this.taskIndex.updateTask(task.id, {
                        status: newStatus,
                        statusChar: newStatusChar
                    });
                } else {
                    // For children
                    const childLineIndex = index - 1; // 0-based index into children array
                    if (childLineIndex < task.children.length) {
                        let childLine = task.children[childLineIndex];
                        // Regex to find - [?]
                        const match = childLine.match(/\[(.)\]/);
                        if (match) {
                            const currentChar = match[1];
                            const newChar = currentChar === ' ' ? 'x' : ' ';
                            childLine = childLine.replace(`[${currentChar}]`, `[${newChar}]`);
                        }

                        // Calculate absolute line number
                        const absoluteLineNumber = task.line + 1 + childLineIndex;

                        this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
                    }
                }
            });

            // Stop propagation so clicking checkbox doesn't drag/select card
            checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());
        });
    }
}
