import { Task } from '../../types';

export interface DragStrategy {
    name: string;
    onDragStart(task: Task, el: HTMLElement, initialX: number, initialY: number, container: HTMLElement): void;
    onDragMove(e: PointerEvent, container: HTMLElement, elBelow: Element | null, autoScrollDelta?: number): void;
    onDragEnd(task: Task, el: HTMLElement): Promise<Partial<Task>>;
    cleanup(): void;
}
