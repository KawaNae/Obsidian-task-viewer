import { App, MarkdownRenderer, Component, Menu, Notice, TFile } from 'obsidian';
import { Task, TaskViewerSettings, isCompleteStatusChar } from '../types';
import { TaskIndex } from '../services/core/TaskIndex';
import { DateUtils } from '../utils/DateUtils';

/** Checkbox handler for frontmatter child task rendering */
type FmCheckboxHandler = {
    type: 'task';
    taskId: string;
} | {
    type: 'childLine';
    parentTask: Task;
    childLineIndex: number;
};

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
        const filePath = task.file.replace(/\.md$/, '');
        const fileName = task.file.split('/').pop()?.replace('.md', '') || task.file;
        const hasContent = cleanParentLine.replace(/^- \[[xX! -]\]\s*/, '').trim().length > 0;

        if (hasContent) {
            cleanParentLine += ` : [[${filePath}|${fileName}]]`;
        } else {
            cleanParentLine += `[[${filePath}|${fileName}]]`;
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
            const checkboxMap = this.getCheckboxChildLineIndices(task.childLines);
            this.setupChildCheckboxHandlers(childrenContainer, task, checkboxMap, 0, settings);
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

        // Frontmatter task: render child tasks from childIds (interactive checkboxes)
        if (task.parserId === 'frontmatter' && task.childIds.length > 0) {
            const childTasks: Task[] = [];
            for (const childId of task.childIds) {
                const ct = this.taskIndex.getTask(childId);
                if (ct) childTasks.push(ct);
            }
            if (childTasks.length > 0) {
                await this.renderFrontmatterChildTasks(contentContainer, task, childTasks, component, settings);
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

                // Prevent touch event propagation to task card
                mainCheckbox.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                });
            }
        }

        // For non-collapsed mode, also handle children checkboxes (old behavior)
        if (!shouldCollapse) {
            const checkboxMap = this.getCheckboxChildLineIndices(task.childLines);
            const checkboxes = contentContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach((checkbox, index) => {
                if (index === 0) return; // Already handled above (parent checkbox)
                const checkboxIndex = index - 1; // DOM checkbox index among children
                const childLineIndex = checkboxMap[checkboxIndex];
                if (childLineIndex === undefined) return;

                checkbox.addEventListener('click', () => {
                    if (childLineIndex < task.childLines.length) {
                        let childLine = task.childLines[childLineIndex];
                        const match = childLine.match(/\[(.)\]/);
                        if (match) {
                            const currentChar = match[1];
                            const newChar = currentChar === ' ' ? 'x' : ' ';
                            childLine = childLine.replace(`[${currentChar}]`, `[${newChar}]`);
                            this.updateCheckboxDataTask(checkbox as HTMLElement, newChar);
                        }

                        // Calculate child line number (supports both inline and frontmatter tasks)
                        const absoluteLineNumber = this.calculateChildLineNumber(task, childLineIndex);
                        if (absoluteLineNumber === -1) {
                            console.warn('[TaskRenderer] 子タスクの行番号を特定できませんでした');
                            new Notice('子タスクの行番号を特定できませんでした。ファイル内で直接編集してください。');
                            return;
                        }

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

                    // Prevent touch event propagation to task card
                    checkbox.addEventListener('touchstart', (e) => {
                        e.stopPropagation();
                    });
                }
            });
        }
    }

    private updateCheckboxDataTask(el: HTMLElement, newChar: string): void {
        const value = newChar === ' ' ? '' : newChar;
        const input = el.matches('input.task-list-item-checkbox')
            ? el
            : (el.closest('input.task-list-item-checkbox') as HTMLElement | null);
        const listItem = el.closest('li');

        if (input) {
            if (value) {
                input.setAttribute('data-task', value);
            } else {
                input.removeAttribute('data-task');
            }
        }
        if (listItem) {
            if (value) {
                listItem.setAttribute('data-task', value);
            } else {
                listItem.removeAttribute('data-task');
            }
        }
    }

    /**
     * Setup checkbox handlers for children in a collapsed container
     */
    private setupChildCheckboxHandlers(container: HTMLElement, task: Task, checkboxMap: number[], startOffset: number, settings: TaskViewerSettings): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            const childLineIndex = checkboxMap[startOffset + index];
            if (childLineIndex === undefined) return;

            checkbox.addEventListener('click', () => {
                if (childLineIndex < task.childLines.length) {
                    let childLine = task.childLines[childLineIndex];
                    const match = childLine.match(/\[(.)\]/);
                    if (match) {
                        const currentChar = match[1];
                        const newChar = currentChar === ' ' ? 'x' : ' ';
                        childLine = childLine.replace(`[${currentChar}]`, `[${newChar}]`);
                        this.updateCheckboxDataTask(checkbox as HTMLElement, newChar);
                    }

                    // Calculate child line number (supports both inline and frontmatter tasks)
                    const absoluteLineNumber = this.calculateChildLineNumber(task, childLineIndex);
                    if (absoluteLineNumber === -1) {
                        console.warn('[TaskRenderer] 子タスクの行番号を計算できません');
                        new Notice('子タスクの行番号を特定できませんでした');
                        return;
                    }

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

                // Prevent touch event propagation to task card
                checkbox.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
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
        const targetEl = e.target as HTMLElement | null;

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
                            if (targetEl) {
                                this.updateCheckboxDataTask(targetEl, opt.char);
                            }

                            // Calculate child line number (supports both inline and frontmatter tasks)
                            const absoluteLineNumber = this.calculateChildLineNumber(task, childLineIndex);
                            if (absoluteLineNumber === -1) {
                                console.warn('[TaskRenderer] 子タスクの行番号を計算できません');
                                new Notice('子タスクの行番号を特定できませんでした');
                                return;
                            }

                            await this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
                        }
                    });
            });
        }

        menu.showAtPosition({ x: e.pageX, y: e.pageY });
    }

    /**
     * Build a mapping from checkbox DOM index to childLines array index.
     * Only lines matching `- [.]` produce checkboxes in rendered HTML,
     * but childLines may also contain non-checkbox content (descriptions, bullets, etc.).
     */
    private getCheckboxChildLineIndices(childLines: string[]): number[] {
        const indices: number[] = [];
        childLines.forEach((line, i) => {
            if (/^\s*-\s*\[.\]/.test(line)) {
                indices.push(i);
            }
        });
        return indices;
    }

    /**
     * Calculate the absolute line number for a child task.
     * Supports both inline tasks (task.line + offset) and frontmatter tasks (after frontmatter end).
     */
    private calculateChildLineNumber(task: Task, childLineIndex: number): number {
        if (task.parserId === 'frontmatter') {
            // Frontmatter task: use recorded body offset (accounts for skipped non-task lines)
            const fmEndLine = this.getFrontmatterEndLine(task.file);
            if (fmEndLine === -1) return -1;
            const bodyOffset = task.childLineBodyOffsets[childLineIndex];
            if (bodyOffset === undefined) return -1;
            return fmEndLine + 1 + bodyOffset;
        } else {
            // Inline task: children are offset from task.line
            return task.line + 1 + childLineIndex;
        }
    }

    /**
     * Get the line number of the frontmatter closing tag (---) for a file.
     * Returns -1 if no frontmatter or file not found.
     */
    private getFrontmatterEndLine(filePath: string): number {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return -1;

        const cache = this.app.metadataCache.getFileCache(file);
        return cache?.frontmatterPosition?.end?.line ?? -1;
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
        return raw === datePart ? `@${datePart} ` : `@${datePart}…`;
    }

    /**
     * Render child tasks for frontmatter tasks using childIds.
     * Each child is rendered as an interactive checkbox with @notation label.
     * Checkbox toggle calls taskIndex.updateTask() (not updateLine).
     */
    private async renderFrontmatterChildTasks(
        contentContainer: HTMLElement,
        parentTask: Task,
        childTasks: Task[],
        component: Component,
        settings: TaskViewerSettings
    ): Promise<void> {
        const COLLAPSE_THRESHOLD = 3;
        const shouldCollapse = childTasks.length >= COLLAPSE_THRESHOLD;

        // Build markdown lines, @notation labels, and checkbox handler map
        const childLines: string[] = [];
        const notations: (string | null)[] = [];
        const checkboxHandlers: FmCheckboxHandler[] = [];

        for (const ct of childTasks) {
            const char = ct.statusChar || ' ';
            // Build @notation from child's date/time
            const notation = this.buildNotationLabel(ct);
            notations.push(notation);

            if (ct.parserId === 'frontmatter' && ct.file !== parentTask.file) {
                // wikilink 子 → 内部リンクとして描画
                const linkName = ct.file.replace(/\.md$/, '');
                childLines.push(`- [${char}] [[${linkName}]]`);
            } else {
                const content = ct.content || '\u200B';
                childLines.push(`- [${char}] ${content}`);
            }
            checkboxHandlers.push({ type: 'task', taskId: ct.id });

            // 子タスク自身の子要素（階層構造）を追加
            // childIds に対応する行のみスキップ（行番号ベースで重複判定）
            const childIdLineNums = new Set<number>();
            for (const childId of ct.childIds) {
                const child = this.taskIndex.getTask(childId);
                if (child && child.line >= 0) childIdLineNums.add(child.line);
            }
            for (let cli = 0; cli < ct.childLines.length; cli++) {
                const absLine = ct.line + 1 + cli;
                if (childIdLineNums.has(absLine)) continue; // childIds で描画されるためスキップ

                // indent不一致でchildIdsに未リンクだが、タスクストアに存在するオーファンタスクを検出
                const orphanTask = this.taskIndex.getTask(`${ct.file}:${absLine}`);
                if (orphanTask) {
                    // タスクデータで描画（@notation グレー表示 + task型ハンドラ）
                    const oChar = orphanTask.statusChar || ' ';
                    const oContent = orphanTask.content || '\u200B';
                    childLines.push(`    - [${oChar}] ${oContent}`);
                    checkboxHandlers.push({ type: 'task', taskId: orphanTask.id });
                    notations.push(this.buildNotationLabel(orphanTask));
                } else {
                    childLines.push('    ' + ct.childLines[cli]);
                    // childLine がチェックボックスなら handler 追加
                    if (/^\s*-\s+\[.\]/.test(ct.childLines[cli])) {
                        checkboxHandlers.push({ type: 'childLine', parentTask: ct, childLineIndex: cli });
                    }
                    notations.push(null);
                }
            }
            // childIds（@notation 孫タスク）
            for (const grandchildId of ct.childIds) {
                const gc = this.taskIndex.getTask(grandchildId);
                if (!gc) continue;
                const gcChar = gc.statusChar || ' ';
                const gcContent = gc.content || '\u200B';
                childLines.push(`    - [${gcChar}] ${gcContent}`);
                checkboxHandlers.push({ type: 'task', taskId: gc.id });
                notations.push(this.buildNotationLabel(gc));
            }
        }

        if (shouldCollapse) {
            const wasExpanded = this.expandedTaskIds.has(parentTask.id + ':fm-children');

            const toggle = contentContainer.createDiv('task-card__children-toggle');
            const childrenContainer = contentContainer.createDiv('task-card__children');

            if (wasExpanded) {
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${childTasks.length}件の子タスク`;
                toggle.dataset.collapsed = 'false';
                childrenContainer.addClass('task-card__children--expanded');
            } else {
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${childTasks.length}件の子タスク`;
                toggle.dataset.collapsed = 'true';
                childrenContainer.addClass('task-card__children--collapsed');
            }

            await MarkdownRenderer.render(this.app, childLines.join('\n'), childrenContainer, parentTask.file, component);
            this.postProcessFmChildNotations(childrenContainer, notations, parentTask.startDate);

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = toggle.dataset.collapsed === 'true';
                if (isCollapsed) {
                    toggle.dataset.collapsed = 'false';
                    toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${childTasks.length}件の子タスク`;
                    childrenContainer.removeClass('task-card__children--collapsed');
                    childrenContainer.addClass('task-card__children--expanded');
                    this.expandedTaskIds.add(parentTask.id + ':fm-children');
                } else {
                    toggle.dataset.collapsed = 'true';
                    toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${childTasks.length}件の子タスク`;
                    childrenContainer.removeClass('task-card__children--expanded');
                    childrenContainer.addClass('task-card__children--collapsed');
                    this.expandedTaskIds.delete(parentTask.id + ':fm-children');
                }
            });

            this.setupFmChildCheckboxHandlers(childrenContainer, checkboxHandlers, settings);
        } else {
            // Inline: render children directly below parent
            const childrenContainer = contentContainer.createDiv('task-card__children task-card__children--expanded');
            await MarkdownRenderer.render(this.app, childLines.join('\n'), childrenContainer, parentTask.file, component);
            this.postProcessFmChildNotations(childrenContainer, notations, parentTask.startDate);
            this.setupFmChildCheckboxHandlers(childrenContainer, checkboxHandlers, settings);
        }
    }

    /**
     * Append @notation labels to rendered frontmatter child task items.
     */
    private postProcessFmChildNotations(container: HTMLElement, notations: (string | null)[], parentStartDate?: string): void {
        const items = container.querySelectorAll('.task-list-item');
        notations.forEach((notation, i) => {
            if (!notation || !items[i]) return;
            const span = document.createElement('span');
            span.className = 'task-card__child-notation';
            span.textContent = this.formatChildNotation(notation, parentStartDate);
            // ネスト ul がある場合はその前に挿入（appendChild だと ul の後ろに隠れる）
            const nestedUl = items[i].querySelector(':scope > ul');
            if (nestedUl) {
                items[i].insertBefore(span, nestedUl);
            } else {
                items[i].appendChild(span);
            }
        });
    }

    /**
     * Build @notation label string from a task's date/time fields.
     */
    private buildNotationLabel(task: Task): string | null {
        if (!task.startDate && !task.startTime) return null;
        const parts: string[] = [];
        if (task.startDate) parts.push(task.startDate);
        if (task.startTime) parts.push(task.startTime);
        let notation = '@' + parts.join('T');
        if (task.endDate || task.endTime) {
            notation += '>';
            const endParts: string[] = [];
            if (task.endDate) endParts.push(task.endDate);
            if (task.endTime) endParts.push(task.endTime);
            notation += endParts.join('T');
        }
        return notation;
    }

    /**
     * Wire checkbox events for frontmatter child tasks (including grandchildren).
     */
    private setupFmChildCheckboxHandlers(
        container: HTMLElement,
        handlers: FmCheckboxHandler[],
        settings: TaskViewerSettings
    ): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            if (index >= handlers.length) return;
            const handler = handlers[index];

            checkbox.addEventListener('click', () => {
                const isChecked = (checkbox as HTMLInputElement).checked;
                const newStatusChar = isChecked ? 'x' : ' ';

                if (handler.type === 'task') {
                    this.taskIndex.updateTask(handler.taskId, { statusChar: newStatusChar });
                } else {
                    // childLine: use updateLine for direct file modification (same pattern as inline checkboxes)
                    const childLine = handler.parentTask.childLines[handler.childLineIndex];
                    const newLine = childLine.replace(
                        /^(\s*-\s+\[).\]/,
                        `$1${newStatusChar}]`
                    );
                    const absoluteLineNumber = handler.parentTask.line + 1 + handler.childLineIndex;
                    this.taskIndex.updateLine(handler.parentTask.file, absoluteLineNumber, newLine);
                }
            });
            checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

            if (settings.applyGlobalStyles && handler.type === 'task') {
                checkbox.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showCheckboxStatusMenu(e as MouseEvent, handler.taskId);
                });
                checkbox.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                });
            }
        });
    }
}
