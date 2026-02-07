import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

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
            // Sort cluster by start time (critical for waterfall logic)
            // If start times are equal, longer tasks go first (so shorter ones sit on top)
            cluster.sort((a, b) => {
                if (a.start !== b.start) return a.start - b.start;
                return (b.end - b.start) - (a.end - a.start);
            });

            // Map to store assigned levels for tasks in this cluster
            const taskLevels = new Map<string, number>();
            const processedItems: typeof preparedTasks = [];

            for (const item of cluster) {
                let maxOverlappingLevel = 0;

                // Find all previously processed tasks that overlap with current item
                for (const processed of processedItems) {
                    // Check overlap
                    if (item.start < processed.end && item.end > processed.start) {
                        const level = taskLevels.get(processed.task.id) || 0;
                        if (level > maxOverlappingLevel) {
                            maxOverlappingLevel = level;
                        }
                    }
                }

                // Assign level = max + 1
                const currentLevel = maxOverlappingLevel + 1;
                taskLevels.set(item.task.id, currentLevel);
                processedItems.push(item);
            }

            // Assign layout based on levels
            // Level 1 = Width 100%, Left 0%, Z-Index 1
            // Level n = Width 100 - (n-1)*10, Left (n-1)*10, Z-Index n
            const CASCADE_STEP = 10;
            const MIN_WIDTH = 50;

            for (const item of cluster) {
                const level = taskLevels.get(item.task.id) || 1;
                // Determine step index (0-based) from level (1-based)
                const stepIndex = level - 1;

                const width = Math.max(MIN_WIDTH, 100 - stepIndex * CASCADE_STEP);
                const left = 100 - width; // Right-aligned logic
                const zIndex = level;

                layout.set(item.task.id, { width, left, zIndex });
            }
        }

        return layout;
    }
}
