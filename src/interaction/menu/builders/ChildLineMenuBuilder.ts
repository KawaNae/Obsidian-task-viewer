import { App, Menu } from 'obsidian';
import { Task } from '../../../types';
import { TaskWriteService } from '../../../services/data/TaskWriteService';
import { CheckboxMenuBuilder, type CheckboxLineOps, type CreateFrontmatterTaskCallback } from './CheckboxMenuBuilder';
import { resolveChildLineNumber } from '../../../views/taskcard/ChildLineUtils';
import TaskViewerPlugin from '../../../main';
import type { CreateTaskResult } from '../../../modals/CreateTaskModal';

/**
 * Menu builder for plain checkbox child lines on task cards.
 * Delegates menu construction to CheckboxMenuBuilder,
 * providing TaskWriteService-based line operations.
 */
export class ChildLineMenuBuilder {
    private checkboxMenuBuilder: CheckboxMenuBuilder;

    constructor(
        private app: App,
        private writeService: TaskWriteService,
        private plugin: TaskViewerPlugin
    ) {
        const onCreateFrontmatterTask: CreateFrontmatterTaskCallback = async (result, statusChar) => {
            return this.createFrontmatterTask(result, statusChar);
        };

        this.checkboxMenuBuilder = new CheckboxMenuBuilder(
            app,
            () => plugin.settings.startHour,
            onCreateFrontmatterTask
        );
    }

    showMenu(parentTask: Task, childLineIndex: number, x: number, y: number): void {
        const lineNumber = resolveChildLineNumber(this.app, parentTask, childLineIndex);
        if (lineNumber === -1) return;

        const cl = parentTask.childLines[childLineIndex];
        if (!cl) return;

        const lineText = cl.text;
        const filePath = parentTask.file;
        const settings = this.plugin.settings;
        const menu = new Menu();

        const ops: CheckboxLineOps = {
            updateLine: (content) => this.writeService.updateLine(filePath, lineNumber, content),
            insertLineAfter: (content) => this.writeService.insertLineAfterLine(filePath, lineNumber, content),
            deleteLine: () => this.writeService.deleteLine(filePath, lineNumber),
        };

        this.checkboxMenuBuilder.addFullMenu(menu, lineText, settings, ops, filePath);
        menu.showAtPosition({ x, y });
    }

    private async createFrontmatterTask(result: CreateTaskResult, statusChar: string): Promise<string> {
        const repository = this.plugin.getTaskRepository();
        const settings = this.plugin.settings;
        const tempTask: Task = {
            id: 'convert-temp',
            file: '',
            line: -1,
            indent: 0,
            content: result.content,
            statusChar,
            childIds: [],
            childLines: [],
            startDate: result.startDate,
            startTime: result.startTime,
            endDate: result.endDate || (result.endTime && result.startDate ? result.startDate : undefined),
            endTime: result.endTime,
            due: result.due,
            commands: [],
            originalText: '',
            childLineBodyOffsets: [],
            tags: [],
            parserId: 'at-notation',
            properties: {},
        };
        return await repository.createFrontmatterTaskFile(
            tempTask,
            settings.frontmatterTaskHeader,
            settings.frontmatterTaskHeaderLevel,
            undefined,
            undefined,
            settings.frontmatterTaskKeys
        );
    }
}
