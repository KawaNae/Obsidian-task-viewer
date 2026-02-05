import { App, TFile, WorkspaceLeaf, MarkdownView } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from './TaskParser';
import { TaskViewerSettings } from '../types';
import { TaskRepository } from './TaskRepository';
import { TaskCommandExecutor } from './TaskCommandExecutor';
import { DateUtils } from '../utils/DateUtils';

export interface ValidationError {
    file: string;
    line: number;
    taskId: string;
    error: string;
}

export class TaskIndex {
    private app: App;
    private tasks: Map<string, Task> = new Map(); // ID -> Task
    private listeners: ((taskId?: string, changes?: string[]) => void)[] = [];
    private settings: TaskViewerSettings;
    private validationErrors: ValidationError[] = [];

    public getSettings(): TaskViewerSettings {
        return this.settings;
    }

    // Services
    private repository: TaskRepository;
    private commandExecutor: TaskCommandExecutor;
    private isInitializing = true;

    // Sync detection: track local edits via active editor input events
    // Local edit: User types in editor OR Plugin UI operation
    // Sync: File modified without local interaction
    private pendingLocalEdit: Map<string, boolean> = new Map();
    private currentEditorEl: HTMLElement | null = null;
    private editorListenerBound: ((e: InputEvent) => void) | null = null;

    async initialize() {
        this.isInitializing = true;
        // Wait for layout to be ready before initial scan
        this.app.workspace.onLayoutReady(async () => {
            await this.scanVault();
            this.isInitializing = false;
        });

        // Track user interactions to distinguish local edits from sync/programmatic changes
        this.setupInteractionListeners();

        this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // Check if this file had a verified local edit
                const isLocal = this.pendingLocalEdit.get(file.path) || false;

                // Clear the pending flag
                this.pendingLocalEdit.delete(file.path);

                console.log(`[🔄SYNC] vault.modify: ${file.path}, isLocal=${isLocal}`);

                await this.queueScan(file, isLocal);
                this.notifyListeners();
            }
        });

        // Note: editor-change event is no longer used for sync detection.
        // Instead, we use active-leaf-change + beforeinput events on the editor element
        // to reliably detect local edits.

        this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.removeTasksForFile(file.path);
                this.notifyListeners();
            }
        });

        this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // Metadata changed (e.g. frontmatter), notify listeners to re-render
                this.notifyListeners();
            }
        });
    }

    constructor(app: App, settings: TaskViewerSettings) {
        this.app = app;
        this.settings = settings;
        this.repository = new TaskRepository(app);
        this.commandExecutor = new TaskCommandExecutor(this.repository, this, this.app);
    }

    public updateSettings(settings: TaskViewerSettings) {
        this.settings = settings;
        // Re-scan vault as exclusion rules might have changed
        this.scanVault();
    }

    private isExcluded(filePath: string): boolean {
        if (!this.settings.excludedPaths || this.settings.excludedPaths.length === 0) {
            return false;
        }
        return this.settings.excludedPaths.some(excluded => filePath.startsWith(excluded));
    }


    getTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    getValidationErrors(): ValidationError[] {
        return this.validationErrors;
    }

    getTasksForDate(date: string, startHour?: number): Task[] {
        // Use visual date if startHour is provided, otherwise use actual today
        const today = startHour !== undefined ?
            DateUtils.getVisualDateOfNow(startHour) :
            DateUtils.getToday();
        return this.getTasks().filter(t => {
            // Exclude D-type tasks (Deadline only, no start date/time)
            // They belong to the Deadline List, not the daily schedule
            if (!t.startDate && !t.startTime && t.deadline) {
                return false;
            }

            const effectiveStart = t.startDate || today;
            return effectiveStart === date;
        });
    }

    getTasksForVisualDay(visualDate: string, startHour: number): Task[] {
        // 1. Tasks from visualDate (startHour to 23:59)
        const currentDayTasks = this.getTasksForDate(visualDate, startHour).filter(t => {
            if (!t.startTime) return true; // All-day tasks belong to the date
            const [h] = t.startTime.split(':').map(Number);
            return h >= startHour;
        });

        // 2. Tasks from nextDay (00:00 to startHour - 1 min)
        const nextDate = new Date(visualDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];

        const nextDayTasks = this.getTasksForDate(nextDateStr, startHour).filter(t => {
            if (!t.startTime) return false; // All-day tasks of next day don't belong here
            const [h] = t.startTime.split(':').map(Number);
            return h < startHour;
        });

        return [...currentDayTasks, ...nextDayTasks];
    }

    /**
     * Get tasks that are purely Deadline tasks (D-type)
     * No start date, no start time, but has deadline.
     */
    getDeadlineTasks(): Task[] {
        return this.getTasks().filter(t => !t.startDate && !t.startTime && t.deadline);
    }

    onChange(callback: (taskId?: string, changes?: string[]) => void): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notifyListeners(taskId?: string, changes?: string[]) {
        this.listeners.forEach(cb => cb(taskId, changes));
    }

    private scanQueue: Map<string, Promise<void>> = new Map();
    private processedCompletions: Map<string, number> = new Map(); // "file|date|content" -> count
    private visitedFiles = new Set<string>();

    private getTaskSignature(task: Task): string {
        const cmdSig = task.commands ? task.commands.map(c => `${c.name}(${c.args.join(',')})`).join('') : '';
        return `${task.file}|${task.startDate || 'no-date'}|${task.content}|${cmdSig}`;
    }

    private async scanVault() {
        this.validationErrors = []; // Clear previous errors
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            if (this.isExcluded(file.path)) {
                this.removeTasksForFile(file.path);
                continue;
            }
            await this.queueScan(file);
        }
        this.notifyListeners();
        // Fallback: Ensure isInitializing is false after explicit vault scan, 
        // though onLayoutReady handles it too.
        this.isInitializing = false;
    }

    public async requestScan(file: TFile): Promise<void> {
        return this.queueScan(file);
    }

    private async queueScan(file: TFile, isLocal: boolean = false): Promise<void> {
        if (this.isExcluded(file.path)) {
            // Ensure no tasks remain for this excluded file
            if (this.tasks.size > 0) { // Optimization: check if we have any tasks at all first
                // We need to check if there are any tasks for this file to remove
                // But removeTasksForFile iterates all tasks, which is fine but let's just do it
                this.removeTasksForFile(file.path);
                this.notifyListeners();
            }
            return;
        }

        // Simple queue mechanism: chain promises per file path
        const previousScan = this.scanQueue.get(file.path) || Promise.resolve();

        const currentScan = previousScan.then(async () => {
            try {
                await this.scanFile(file, isLocal);
            } catch (error) {
                console.error(`Error scanning file ${file.path}:`, error);
            }
        });

        this.scanQueue.set(file.path, currentScan);
        return currentScan;
    }

    private async scanFile(file: TFile, isLocalChange: boolean = false) {
        // Double check: if layout is not ready, maybe skip? But queue handles ordering.
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        // 1. Parse all new tasks first (with recursive child extraction)
        const newTasks: Task[] = [];

        /**
         * Recursively extract tasks from a range of lines.
         * @param linesToProcess - Array of line strings to process
         * @param baseLineNumber - The actual line number in the file for the first line
         * @param parentStartDate - Parent task's startDate for inheritance (optional)
         * @returns Array of extracted tasks
         */
        const extractTasksFromLines = (
            linesToProcess: string[],
            baseLineNumber: number,
            parentStartDate?: string
        ): Task[] => {
            const extractedTasks: Task[] = [];

            for (let i = 0; i < linesToProcess.length; i++) {
                const line = linesToProcess[i];
                const actualLineNumber = baseLineNumber + i;
                const task = TaskParser.parse(line, file.path, actualLineNumber);

                if (task) {
                    // Inherit parent's startDate if child has time-only notation
                    // (startTime exists but startDate is missing)
                    if (parentStartDate && !task.startDate && task.startTime) {
                        task.startDate = parentStartDate;
                        task.startDateInherited = true;
                    }
                    // Also inherit for endDate if endTime exists but endDate is missing
                    if (parentStartDate && !task.endDate && task.endTime) {
                        task.endDate = parentStartDate;
                    }

                    // Set indent (leading whitespace count)
                    const taskIndent = line.search(/\S|$/);
                    task.indent = taskIndent;

                    // Collect validation warnings (set during parse)
                    if (task.validationWarning) {
                        this.validationErrors.push({
                            file: file.path,
                            line: actualLineNumber + 1, // Display as 1-indexed
                            taskId: task.id,
                            error: task.validationWarning
                        });
                    }

                    // Initialize child arrays
                    task.childIds = [];

                    // Look ahead for children (skip blank lines)
                    const children: string[] = [];
                    let j = i + 1;

                    while (j < linesToProcess.length) {
                        const nextLine = linesToProcess[j];

                        // Stop at blank lines - they are not children
                        if (nextLine.trim() === '') {
                            break;
                        }

                        const nextIndent = nextLine.search(/\S|$/);
                        if (nextIndent > taskIndent) {
                            children.push(nextLine);
                            j++;
                        } else {
                            break;
                        }
                    }

                    // Normalize children indentation: remove base indent so they render correctly
                    // Find the minimum indent of non-empty children
                    const nonEmptyChildren = children.filter(c => c.trim() !== '');
                    if (nonEmptyChildren.length > 0) {
                        const minIndent = Math.min(...nonEmptyChildren.map(c => c.search(/\S|$/)));
                        task.childLines = children.map(c => {
                            if (c.trim() === '') return c;
                            return c.substring(minIndent);
                        });
                    } else {
                        task.childLines = children;
                    }

                    extractedTasks.push(task);

                    // Recursively extract child tasks that have @ notation
                    // Pass this task's startDate for inheritance
                    if (children.length > 0) {
                        const childLineNumber = actualLineNumber + 1;
                        const childTasks = extractTasksFromLines(children, childLineNumber, task.startDate);

                        // Set up parent-child relationships
                        for (const childTask of childTasks) {
                            // Only set parentId for direct children (indent diff = 1 level)
                            if (childTask.indent === taskIndent + 4 || childTask.indent === taskIndent + 2) {
                                childTask.parentId = task.id;
                                task.childIds.push(childTask.id);
                            }
                        }

                        extractedTasks.push(...childTasks);
                    }

                    // Skip consumed lines
                    i = j - 1;
                }
            }

            return extractedTasks;
        };

        // Extract all tasks recursively
        const allExtractedTasks = extractTasksFromLines(lines, 0);
        newTasks.push(...allExtractedTasks);

        // 2. Count Current Completions
        const currentCounts = new Map<string, number>();
        const doneTasks: Task[] = [];

        for (const task of newTasks) {
            // Check extended triggerable status (x, X, -, !)
            if (TaskParser.isTriggerableStatus(task) && task.commands && task.commands.length > 0) {
                const sig = this.getTaskSignature(task);
                currentCounts.set(sig, (currentCounts.get(sig) || 0) + 1);
                doneTasks.push(task);
            }
        }

        // 3. Diff and Trigger
        const tasksToTrigger: Task[] = [];
        const checkedSignatures = new Set<string>();

        let isFirstScan = false;
        if (!this.visitedFiles.has(file.path)) {
            this.visitedFiles.add(file.path);
            isFirstScan = true;
        }

        // Sync detection logging
        console.log(`[🔄SYNC] Scan: ${file.path}, isLocalChange=${isLocalChange}, isFirstScan=${isFirstScan}, isInitializing=${this.isInitializing}`);

        if (!isLocalChange && !isFirstScan && !this.isInitializing) {
            console.log(`[🔄SYNC] ⛔ Sync-driven change detected, skipping command: ${file.path}`);
        }

        for (const task of doneTasks) {
            const sig = this.getTaskSignature(task);
            if (checkedSignatures.has(sig)) continue; // Process each unique signature once per scan
            checkedSignatures.add(sig);

            const currentCount = currentCounts.get(sig) || 0;
            const previousCount = this.processedCompletions.get(sig) || 0;

            console.log(`[🔄SYNC] Task: ${task.content.substring(0, 30)}..., cur=${currentCount}, prev=${previousCount}, local=${isLocalChange}`);

            if (currentCount > previousCount) {
                // Number of done tasks increased! Trigger recurrence for the *difference*
                const diff = currentCount - previousCount;

                // Only trigger if:
                // 1. NOT initializing
                // 2. NOT the first scan of this file
                // 3. IS a local change (not sync-driven)
                if (!this.isInitializing && !isFirstScan && isLocalChange) {
                    console.log(`[🔄SYNC] ✅ Executing command for: ${task.content.substring(0, 30)}...`);
                    for (let k = 0; k < diff; k++) {
                        tasksToTrigger.push(task);
                    }
                } else {
                    console.log(`[TaskIndex] Skipping command - isInitializing=${this.isInitializing}, isFirstScan=${isFirstScan}, isLocalChange=${isLocalChange}`);
                }
            }
        }

        // 4. Update Memory
        // Filter out entries for this file from processedCompletions
        const prefix = `${file.path}|`;
        for (const key of this.processedCompletions.keys()) {
            if (key.startsWith(prefix)) {
                this.processedCompletions.delete(key);
            }
        }

        // Add new counts
        for (const [sig, count] of currentCounts) {
            this.processedCompletions.set(sig, count);
        }

        // 5. Update Index
        // Clear old tasks for this file
        this.removeTasksForFile(file.path);

        // Add new tasks
        for (const task of newTasks) {
            this.tasks.set(task.id, task);
        }

        // 6. Execute Triggers
        if (tasksToTrigger.length > 0) {
            for (const task of tasksToTrigger) {
                await this.commandExecutor.handleTaskCompletion(task);
            }
        }
    }

    private removeTasksForFile(filePath: string) {
        for (const [id, task] of this.tasks) {
            if (task.file === filePath) {
                this.tasks.delete(id);
            }
        }
    }

    async waitForScan(filePath: string): Promise<void> {
        const promise = this.scanQueue.get(filePath);
        if (promise) {
            await promise;
        }
    }

    resolveTask(originalTask: Task): Task | undefined {
        // Try to find the task in the current index
        // 1. By ID (if stable or lucky)
        let found = this.tasks.get(originalTask.id);
        if (found &&
            found.content === originalTask.content &&
            found.file === originalTask.file &&
            found.line === originalTask.line &&
            found.startDate === originalTask.startDate // Strict date check to prevent swapping identical tasks
        ) {
            return found;
        }

        // 2. By Signature (File + Content)
        for (const t of this.tasks.values()) {
            if (t.file === originalTask.file && t.content === originalTask.content) {
                // Heuristic: Status should match the *completed* status?
                // When we queue, status is 'done'. Index should have 'done' too.
                // But check date too if possible.
                if (t.startDate === originalTask.startDate) {
                    return t;
                }
            }
        }

        return undefined;
    }

    async updateTask(taskId: string, updates: Partial<Task>) {
        console.log(`[TaskIndex] updateTask called for ${taskId}`, updates);

        // Handle split task updates
        // If taskId contains ":before" or ":after", extract original ID
        if (taskId.includes(':before') || taskId.includes(':after')) {
            const originalId = taskId.split(':')[0];
            const segment = taskId.includes(':before') ? 'before' : 'after';

            const originalTask = this.tasks.get(originalId);
            if (!originalTask) {
                console.warn(`[TaskIndex] Original task ${originalId} not found for split segment`);
                return;
            }

            // Map segment updates to original task fields
            const originalUpdates: Partial<Task> = {};
            if (segment === 'before') {
                // Before segment: only startDate/startTime can change
                if (updates.startDate !== undefined) originalUpdates.startDate = updates.startDate;
                if (updates.startTime !== undefined) originalUpdates.startTime = updates.startTime;
            } else {
                // After segment: only endDate/endTime can change
                if (updates.endDate !== undefined) originalUpdates.endDate = updates.endDate;
                if (updates.endTime !== undefined) originalUpdates.endTime = updates.endTime;
            }

            // Update original task
            console.log(`[TaskIndex] Mapping split segment ${segment} update to original task ${originalId}`, originalUpdates);
            await this.updateTask(originalId, originalUpdates);
            return;
        }

        const task = this.tasks.get(taskId);
        if (!task) {
            console.warn(`[TaskIndex] Task ${taskId} not found in index`);
            return;
        }

        // Mark as local edit before making file changes
        this.markLocalEdit(task.file);

        // Optimistic Update
        // If we are unchecking a task, we must eagerly decrement the processed count.
        // "Unchecking": Transitioning from Triggerable -> Not Triggerable (Todo)

        // Note: TaskParser.isTriggerableStatus checks the *current* task state (before update is applied to object fully?)
        // Wait, `task` object is referencing the one in `this.tasks`. `updates` are partial.
        // We need to check if it *was* triggerable before updates.
        const wasTriggerable = TaskParser.isTriggerableStatus(task);

        // Assuming updates.statusChar is ' ' means uncheck. 
        const willBeTodo = updates.statusChar === ' ';

        if (wasTriggerable && willBeTodo) {
            const sig = this.getTaskSignature(task);
            const currentCount = this.processedCompletions.get(sig) || 0;
            if (currentCount > 0) {
                this.processedCompletions.set(sig, currentCount - 1);
                console.log(`[TaskIndex] Optimistic decrement for "${sig}" -> ${currentCount - 1}`);
            }
        }

        Object.assign(task, updates);
        this.notifyListeners(taskId, Object.keys(updates));

        // Delegate to Repository
        const updatedTask = { ...task, ...updates };
        await this.repository.updateTaskInFile(task, updatedTask);
    }
    async updateLine(filePath: string, lineNumber: number, newContent: string) {
        await this.repository.updateLine(filePath, lineNumber, newContent);
    }

    async deleteTask(taskId: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // Mark as local edit before making file changes
        this.markLocalEdit(task.file);

        // Optimistic Update
        this.tasks.delete(taskId);
        this.notifyListeners();

        await this.repository.deleteTaskFromFile(task);
    }

    async duplicateTask(taskId: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // Mark as local edit before making file changes
        this.markLocalEdit(task.file);

        await this.repository.duplicateTaskInFile(task);
    }

    async duplicateTaskForWeek(taskId: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // Mark as local edit before making file changes
        this.markLocalEdit(task.file);

        await this.repository.duplicateTaskForWeek(task);
    }

    /**
     * Mark a file as having a local edit.
     * This should be called:
     * 1. When user types in the active editor (via beforeinput event)
     * 2. When plugin UI makes changes (e.g., updateTask, deleteTask)
     */
    private markLocalEdit(filePath: string): void {
        this.pendingLocalEdit.set(filePath, true);
        console.log(`[🔄SYNC] Marked local edit: ${filePath}`);
    }

    private setupInteractionListeners(): void {
        // Create bound handler for editor input events
        this.editorListenerBound = (e: InputEvent) => {
            const filePath = this.app.workspace.getActiveFile()?.path;
            if (filePath) {
                this.markLocalEdit(filePath);
            }
        };

        // Listen for active leaf changes to attach/detach editor listeners
        this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
            this.attachEditorListener(leaf);
        });

        // Attach to initially active leaf
        const activeLeaf = this.app.workspace.activeLeaf;
        if (activeLeaf) {
            this.attachEditorListener(activeLeaf);
        }
    }

    private attachEditorListener(leaf: WorkspaceLeaf | null): void {
        // Remove listener from previous editor element
        if (this.currentEditorEl && this.editorListenerBound) {
            this.currentEditorEl.removeEventListener('beforeinput', this.editorListenerBound as EventListener);
            this.currentEditorEl.removeEventListener('input', this.editorListenerBound as EventListener);
            this.currentEditorEl = null;
        }

        if (!leaf) {
            console.log(`[🔄SYNC] No leaf provided`);
            return;
        }

        const view = leaf.view;
        console.log(`[🔄SYNC] View type: ${view.getViewType()}`);
        if (view.getViewType() !== 'markdown') return;

        const markdownView = view as MarkdownView;
        const editor = markdownView.editor;

        // Try multiple ways to get the editable element
        let editorEl: HTMLElement | null = null;

        // Method 1: CodeMirror 6 via cm.dom
        const cm6Dom = (editor as any).cm?.dom as HTMLElement | undefined;
        if (cm6Dom) {
            editorEl = cm6Dom;
            console.log(`[🔄SYNC] Found editor via cm.dom`);
        }

        // Method 2: Find contenteditable element in the container
        if (!editorEl) {
            const containerEl = markdownView.containerEl;
            const contentEditable = containerEl.querySelector('.cm-content[contenteditable="true"]') as HTMLElement;
            if (contentEditable) {
                editorEl = contentEditable;
                console.log(`[🔄SYNC] Found editor via .cm-content`);
            }
        }

        // Method 3: Use the container's editor area
        if (!editorEl) {
            const containerEl = markdownView.containerEl;
            const editorArea = containerEl.querySelector('.markdown-source-view') as HTMLElement;
            if (editorArea) {
                editorEl = editorArea;
                console.log(`[🔄SYNC] Found editor via .markdown-source-view`);
            }
        }

        if (editorEl && this.editorListenerBound) {
            // Use both beforeinput and input for better coverage
            editorEl.addEventListener('beforeinput', this.editorListenerBound as EventListener);
            editorEl.addEventListener('input', this.editorListenerBound as EventListener);
            this.currentEditorEl = editorEl;
            console.log(`[🔄SYNC] Attached editor listener for: ${this.app.workspace.getActiveFile()?.path || 'unknown'}`);
        } else {
            console.log(`[🔄SYNC] Could not find editor element. editor:`, editor);
        }
    }
}
