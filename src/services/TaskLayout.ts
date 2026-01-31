import { Task } from '../types';
import { DateUtils } from '../utils/DateUtils';

export class TaskLayout {
    static calculateTaskLayout(tasks: Task[], date: string, startHour: number): Map<string, { width: number, left: number, zIndex: number }> {
        const layout = new Map<string, { width: number, left: number, zIndex: number }>();
        if (tasks.length === 0) return layout;

        const startHourMinutes = startHour * 60;

        // Helper to get adjusted minutes (minutes from visual start)
        const getAdjustedMinutes = (task: Task, timeStr: string, isEnd: boolean) => {
            let m: number;

            if (timeStr.includes('T')) {
                const startDate = new Date(`${date}T00:00:00`);
                const endDate = new Date(timeStr);
                const diffMs = endDate.getTime() - startDate.getTime();
                m = Math.floor(diffMs / 60000);
            } else {
                m = DateUtils.timeToMinutes(timeStr);
            }

            // Adjust for visual day
            // If it's simple time and < startHour, it's next day (add 24h)
            if (!timeStr.includes('T') && m < startHourMinutes) {
                m += 24 * 60;
            }

            return m;
        };

        // 1. Prepare tasks with calculated start/end for sorting
        const preparedTasks = tasks.map(task => {
            const start = getAdjustedMinutes(task, task.startTime!, false);
            let end = task.endTime ? getAdjustedMinutes(task, task.endTime, true) : start + 60;
            // Fix simple wrap for end time if needed
            if (!task.endTime?.includes('T') && end < start) end += 24 * 60;

            return { task, start, end };
        });

        // 2. Sort by start time, then by duration (longer first)
        preparedTasks.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            const durA = a.end - a.start;
            const durB = b.end - b.start;
            return durB - durA;
        });

        // 3. Group into clusters of overlapping tasks
        const clusters: typeof preparedTasks[] = [];
        let currentCluster: typeof preparedTasks = [];
        let clusterMaxEnd = -1;

        for (const item of preparedTasks) {
            if (currentCluster.length === 0) {
                currentCluster.push(item);
                clusterMaxEnd = item.end;
            } else {
                // If this task starts after the current cluster ends, it's a new cluster
                if (item.start >= clusterMaxEnd) {
                    clusters.push(currentCluster);
                    currentCluster = [item];
                    clusterMaxEnd = item.end;
                } else {
                    currentCluster.push(item);
                    clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
                }
            }
        }
        if (currentCluster.length > 0) {
            clusters.push(currentCluster);
        }

        // 4. Process each cluster independently
        for (const cluster of clusters) {
            const columns: typeof preparedTasks[] = [];

            for (const item of cluster) {
                let placed = false;
                for (let i = 0; i < columns.length; i++) {
                    const column = columns[i];
                    // Check overlap
                    const overlaps = column.some(t => {
                        return item.start < t.end && item.end > t.start;
                    });

                    if (!overlaps) {
                        column.push(item);
                        placed = true;
                        break;
                    }
                }

                if (!placed) {
                    columns.push([item]);
                }
            }

            // Assign width, left position, and z-index for this cluster (Cascade layout)
            // Each overlapping task gets progressively narrower and right-aligned
            // Higher column index = higher z-index (appears on top)
            const CASCADE_STEP = 10; // 10% narrower per overlap
            const MIN_WIDTH = 50;    // Minimum width 50%

            columns.forEach((column, colIndex) => {
                const width = Math.max(MIN_WIDTH, 100 - colIndex * CASCADE_STEP);
                const left = 100 - width; // Right-aligned
                const zIndex = colIndex + 1; // Higher index = on top
                column.forEach(item => {
                    layout.set(item.task.id, { width, left, zIndex });
                });
            });
        }

        return layout;
    }
}
