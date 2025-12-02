import { App, MarkdownRenderer, Component } from 'obsidian';
import { Task } from '../types';
import { TaskIndex } from '../services/TaskIndex';

export class TaskRenderer {
    private app: App;
    private taskIndex: TaskIndex;

    constructor(app: App, taskIndex: TaskIndex) {
        this.app = app;
        this.taskIndex = taskIndex;
    }

    async render(container: HTMLElement, task: Task, component: Component) {
        const contentContainer = container.createDiv('task-content-container');

        // Construct full markdown
        // Strip time info from parent task line for display
        const statusChar = task.statusChar || (task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' '));
        let cleanParentLine = `- [${statusChar}] ${task.content}`;

        // Append source file link
        const fileName = task.file.split('/').pop()?.replace('.md', '') || task.file;
        cleanParentLine += `：[[${fileName}]]`;

        const fullText = [cleanParentLine, ...task.children].join('\n');

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
                        // Regex to find [ ] or [x]
                        if (childLine.match(/\[ \]/)) {
                            childLine = childLine.replace('[ ]', '[x]');
                        } else if (childLine.match(/\[x\]/i)) {
                            childLine = childLine.replace(/\[x\]/i, '[ ]');
                        } else if (childLine.match(/\[-\]/)) {
                            childLine = childLine.replace(/\[-\]/, '[ ]');
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
