import { addDays, addWeeks, addMonths, addYears, isWeekend, isMonday, nextMonday, nextTuesday, nextWednesday, nextThursday, nextFriday, nextSaturday, nextSunday } from 'date-fns';

export class RecurrenceUtils {
    static calculateNextDate(baseDate: Date, recurrence: string): Date {
        const lowerRecurrence = recurrence.toLowerCase().trim();

        // 0. Absolute Date (YYYY-MM-DD or YYYY/MM/DD)
        const absoluteMatch = lowerRecurrence.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (absoluteMatch) {
            const y = parseInt(absoluteMatch[1], 10);
            const m = parseInt(absoluteMatch[2], 10);
            const d = parseInt(absoluteMatch[3], 10);
            return new Date(y, m - 1, d);
        }

        // 1. Natural Language Shortcuts
        if (lowerRecurrence === 'tomorrow') {
            return addDays(baseDate, 1);
        }
        if (lowerRecurrence === 'today') {
            return baseDate;
        }
        if (lowerRecurrence === 'next week') {
            return addWeeks(baseDate, 1);
        }

        // 2. Weekdays (e.g., "Monday", "next Friday")
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayFunctions = [nextSunday, nextMonday, nextTuesday, nextWednesday, nextThursday, nextFriday, nextSaturday];

        // Check for basic weekday names (Monday, etc)
        // If today is Monday and user says "Monday", generally means NEXT Monday.
        for (let i = 0; i < days.length; i++) {
            if (lowerRecurrence.includes(days[i])) {
                return dayFunctions[i](baseDate);
            }
        }

        // 3. Simple keywords
        if (lowerRecurrence === 'daily' || lowerRecurrence === 'every day') {
            return addDays(baseDate, 1);
        }
        if (lowerRecurrence === 'weekly' || lowerRecurrence === 'every week') {
            return addWeeks(baseDate, 1);
        }
        if (lowerRecurrence === 'monthly' || lowerRecurrence === 'every month') {
            return addMonths(baseDate, 1);
        }
        if (lowerRecurrence === 'yearly' || lowerRecurrence === 'every year') {
            return addYears(baseDate, 1);
        }
        if (lowerRecurrence === 'weekdays') {
            let nextDate = addDays(baseDate, 1);
            while (isWeekend(nextDate)) {
                nextDate = addDays(nextDate, 1);
            }
            return nextDate;
        }
        if (lowerRecurrence === 'weekends') {
            let nextDate = addDays(baseDate, 1);
            while (!isWeekend(nextDate)) {
                nextDate = addDays(nextDate, 1);
            }
            return nextDate;
        }

        // 4. "N units" pattern (Relative Duration: 3 days, 1 week)
        // Matches: "3 days", "every 3 days", "next 3 days"
        const amountMatch = lowerRecurrence.match(/^(?:every|next)?\s*(\d+)\s*(days?|weeks?|months?|years?)$/);
        if (amountMatch) {
            const amount = parseInt(amountMatch[1], 10);
            const unit = amountMatch[2];

            if (unit.startsWith('day')) return addDays(baseDate, amount);
            if (unit.startsWith('week')) return addWeeks(baseDate, amount);
            if (unit.startsWith('month')) return addMonths(baseDate, amount);
            if (unit.startsWith('year')) return addYears(baseDate, amount);
        }

        // Default
        return addDays(baseDate, 1);
    }
}
