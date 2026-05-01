import { App, Menu } from 'obsidian';
import { TaskWriteService } from '../../../services/data/TaskWriteService';
import { CheckboxMenuBuilder, type CheckboxLineOps, type CreateFrontmatterTaskCallback } from './CheckboxMenuBuilder';
import TaskViewerPlugin from '../../../main';
import type { Task, ChildLine } from '../../../types';
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

    showMenu(parentTask: Task, line: ChildLine, bodyLine: number, x: number, y: number): void {
        if (bodyLine < 0) return;
        const settings = this.plugin.settings;
        const menu = new Menu();

        const ops: CheckboxLineOps = {
            updateLine: (content) => this.writeService.updateChildLine(parentTask.id, bodyLine, content),
            insertLineAfter: (content) => this.writeService.insertChildLineAfter(parentTask.id, bodyLine, content),
            deleteLine: () => this.writeService.deleteChildLine(parentTask.id, bodyLine),
        };

        this.checkboxMenuBuilder.addFullMenu(menu, line.text, settings, ops, parentTask.file);
        menu.showAtPosition({ x, y });
    }

    private async createFrontmatterTask(result: CreateTaskResult, statusChar: string): Promise<string> {
        return this.writeService.createFrontmatterTaskFromData({
            content: result.content,
            statusChar,
            startDate: result.startDate,
            startTime: result.startTime,
            endDate: result.endDate || (result.endTime && result.startDate ? result.startDate : undefined),
            endTime: result.endTime,
            due: result.due,
        });
    }
}
