import { App, MarkdownRenderer, Component, Menu } from 'obsidian';
import { Task, TaskViewerSettings, isCompleteStatusChar } from '../types';
import { TaskIndex } from '../services/TaskIndex';
import { DateUtils } from '../utils/DateUtils';

export class TaskRenderer {
    private app: App;
    private taskIndex: TaskIndex;
    // Track which tasks have their children expanded (preserved across re-renders)
    private expandedTaskIds: Set<string> = new Set();

    constructor(app: App, taskIndex: TaskIndex) {
        this.app = app;
        this.taskIndex = taskIndex;
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

        // Construct full markdown
        // Strip time info from parent task line for display
        const statusChar = task.statusChar || ' ';

        // Check if task is overdue and add warning icon
        // Use isCompleteStatusChar for completion detection
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
        const fileName = task.file.split('/').pop()?.replace('.md', '') || task.file;
        const hasContent = cleanParentLine.replace(/^- \[[xX! -]\]\s*/, '').trim().length > 0;

        if (hasContent) {
            cleanParentLine += `：[[${fileName}]]`;
        } else {
            cleanParentLine += `[[${fileName}]]`;
        }

        // Collapse threshold for children
        const COLLAPSE_THRESHOLD = 3;
        const shouldCollapse = task.childLines.length >= COLLAPSE_THRESHOLD;

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
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${task.childLines.length}件の子タスク`;
                toggle.dataset.collapsed = 'false';
                childrenContainer.addClass('task-card__children--expanded');
            } else {
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${task.childLines.length}件の子タスク`;
                toggle.dataset.collapsed = 'true';
                childrenContainer.addClass('task-card__children--collapsed');
            }

            // Render children: extract @notation for checkbox lines before stripping
            const checkboxNotations: (string | null)[] = [];
            const cleanChildren = task.childLines.map(childLine => {
                if (/^\s*-\s*\[.\]/.test(childLine)) {
                    const m = childLine.match(/@[\w\-:>T]+/);
                    checkboxNotations.push(m ? m[0] : null);
                }

                let cleaned = childLine
                    .replace(/\s*@[\w\-:>T]+(?:\s*==>.*)?/g, '')
                    .trimEnd();

                // Bare checkbox "- [ ]" with no content: append ZWS to force checkbox rendering
                if (/^\s*-\s*\[.\]$/.test(cleaned)) {
                    cleaned += ' \u200B';
                }
                return cleaned;
            });

            const childrenText = cleanChildren.join('\n');
            await MarkdownRenderer.render(this.app, childrenText, childrenContainer, task.file, component);

            // Post-process: append @notation labels to rendered checkbox items
            const childTaskListItems = childrenContainer.querySelectorAll('.task-list-item');
            checkboxNotations.forEach((notation, i) => {
                if (!notation || !childTaskListItems[i]) return;
                const span = document.createElement('span');
                span.className = 'task-card__child-notation';
                span.textContent = this.formatChildNotation(notation, task.startDate);
                const nestedUl = childTaskListItems[i].querySelector(':scope > ul');
                if (nestedUl) {
                    childTaskListItems[i].insertBefore(span, nestedUl);
                } else {
                    childTaskListItems[i].appendChild(span);
                }
            });

            // Toggle click handler
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = toggle.dataset.collapsed === 'true';
                if (isCollapsed) {
                    toggle.dataset.collapsed = 'false';
                    toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${task.childLines.length}件の子タスク`;
                    childrenContainer.removeClass('task-card__children--collapsed');
                    childrenContainer.addClass('task-card__children--expanded');
                    // Save expanded state
                    this.expandedTaskIds.add(task.id);
                } else {
                    toggle.dataset.collapsed = 'true';
                    toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${task.childLines.length}件の子タスク`;
                    childrenContainer.removeClass('task-card__children--expanded');
                    childrenContainer.addClass('task-card__children--collapsed');
                    // Remove from expanded state
                    this.expandedTaskIds.delete(task.id);
                }
            });

            // Handle checkboxes in children container
            this.setupChildCheckboxHandlers(childrenContainer, task, 0, settings);
        } else {
            // Render parent + children together: extract @notation for checkbox lines
            const checkboxNotations: (string | null)[] = [];
            const cleanChildren = task.childLines.map(childLine => {
                if (/^\s*-\s*\[.\]/.test(childLine)) {
                    const m = childLine.match(/@[\w\-:>T]+/);
                    checkboxNotations.push(m ? m[0] : null);
                }

                let cleaned = childLine
                    .replace(/\s*@[\w\-:>T]+(?:\s*==>.*)?/g, '')
                    .trimEnd();

                if (/^\s*-\s*\[.\]$/.test(cleaned)) {
                    cleaned += ' \u200B';
                }
                return '    ' + cleaned;
            });

            const fullText = [cleanParentLine, ...cleanChildren].join('\n');

            await MarkdownRenderer.render(this.app, fullText, contentContainer, task.file, component);

            // Post-process: append @notation labels (skip index 0 = parent)
            const allTaskListItems = contentContainer.querySelectorAll('.task-list-item');
            checkboxNotations.forEach((notation, i) => {
                if (!notation || !allTaskListItems[i + 1]) return;
                const span = document.createElement('span');
                span.className = 'task-card__child-notation';
                span.textContent = this.formatChildNotation(notation, task.startDate);
                const nestedUl = allTaskListItems[i + 1].querySelector(':scope > ul');
                if (nestedUl) {
                    allTaskListItems[i + 1].insertBefore(span, nestedUl);
                } else {
                    allTaskListItems[i + 1].appendChild(span);
                }
            });
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
                const newStatusChar = isChecked ? 'x' : ' ';
                this.taskIndex.updateTask(task.id, {
                    statusChar: newStatusChar
                });
            });
            mainCheckbox.addEventListener('pointerdown', (e) => e.stopPropagation());

            // Right-click context menu for custom checkbox (only if applyGlobalStyles is enabled)
            if (settings.applyGlobalStyles) {
                mainCheckbox.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showCheckboxStatusMenu(e as MouseEvent, task.id);
                });
            }
        }

        // For non-collapsed mode, also handle children checkboxes (old behavior)
        if (!shouldCollapse) {
            const checkboxes = contentContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach((checkbox, index) => {
                if (index === 0) return; // Already handled above
                const childLineIndex = index - 1;

                checkbox.addEventListener('click', () => {
                    if (childLineIndex < task.childLines.length) {
                        let childLine = task.childLines[childLineIndex];
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

                // Right-click context menu for custom checkbox (only if applyGlobalStyles is enabled)
                if (settings.applyGlobalStyles) {
                    checkbox.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.showChildCheckboxStatusMenu(e as MouseEvent, task, childLineIndex);
                    });
                }
            });
        }
    }

    /**
     * Setup checkbox handlers for children in a collapsed container
     */
    private setupChildCheckboxHandlers(container: HTMLElement, task: Task, startOffset: number, settings: TaskViewerSettings): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            const childLineIndex = startOffset + index;

            checkbox.addEventListener('click', () => {
                if (childLineIndex < task.childLines.length) {
                    let childLine = task.childLines[childLineIndex];
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

            // Right-click context menu for custom checkbox (only if applyGlobalStyles is enabled)
            if (settings.applyGlobalStyles) {
                checkbox.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showChildCheckboxStatusMenu(e as MouseEvent, task, childLineIndex);
                });
            }
        });
    }

    /**
     * Show context menu for custom checkbox status selection
     */
    private showCheckboxStatusMenu(e: MouseEvent, taskId: string): void {
        const menu = new Menu();

        const statusOptions: { char: string; label: string }[] = [
            { char: 'x', label: '[x]' },
            { char: '!', label: '[!]' },
            { char: '?', label: '[?]' },
            { char: '>', label: '[>]' },
            { char: '-', label: '[-]' },
            { char: ' ', label: '[ ]' },
        ];

        for (const opt of statusOptions) {
            menu.addItem((item) => {
                item.setTitle(opt.label)
                    .onClick(async () => {
                        await this.taskIndex.updateTask(taskId, {
                            statusChar: opt.char
                        });
                    });
            });
        }

        menu.showAtPosition({ x: e.pageX, y: e.pageY });
    }

    /**
     * Show context menu for child checkbox status selection
     * Child tasks are updated via updateLine (direct file modification)
     */
    private showChildCheckboxStatusMenu(e: MouseEvent, task: Task, childLineIndex: number): void {
        const menu = new Menu();

        const statusOptions: { char: string; label: string }[] = [
            { char: 'x', label: '[x]' },
            { char: '!', label: '[!]' },
            { char: '?', label: '[?]' },
            { char: '>', label: '[>]' },
            { char: '-', label: '[-]' },
            { char: ' ', label: '[ ]' },
        ];

        for (const opt of statusOptions) {
            menu.addItem((item) => {
                item.setTitle(opt.label)
                    .onClick(async () => {
                        if (childLineIndex < task.childLines.length) {
                            let childLine = task.childLines[childLineIndex];
                            // Replace [.] with new status char
                            childLine = childLine.replace(/\[(.)\]/, `[${opt.char}]`);
                            const absoluteLineNumber = task.line + 1 + childLineIndex;
                            await this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
                        }
                    });
            });
        }

        menu.showAtPosition({ x: e.pageX, y: e.pageY });
    }

    /**
     * Format @notation for child task display.
     * Shows only startDate; appends … if there is more content after the date.
     * For inherited time-only notation (@Txx:xx), substitutes parent's startDate.
     */
    private formatChildNotation(notation: string, parentStartDate: string | undefined): string {
        const raw = notation.slice(1); // remove leading @
        if (raw.startsWith('T')) {
            // Inherited time-only: @T10:00 → use parent startDate
            return parentStartDate ? `@${parentStartDate}…` : notation;
        }
        const dateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) return notation;
        const datePart = dateMatch[1];
        // If notation is exactly @YYYY-MM-DD, show as-is; otherwise truncate
        return raw === datePart ? `@${datePart}` : `@${datePart}…`;
    }
}
