import { moment } from 'obsidian';
import { DateUtils } from './DateUtils';
import type { NoteType } from '../types';

export interface TemplateContext {
    noteType: NoteType;
    /** The date the user triggered note creation for (e.g., the date cell clicked). */
    triggerDate: Date;
    /** The filename format string used to materialize {{title}}. */
    filenameFormat: string;
    /** Only consulted when noteType === 'weekly'. */
    weekStartDay: 0 | 1;
}

const PLACEHOLDER_RE = /\{\{(date|time|title)(:.*?)?\}\}/g;

export function processTemplate(content: string, ctx: TemplateContext): string {
    const anchor = resolveAnchorDate(ctx);
    const anchorMoment = moment(anchor);
    return content.replace(PLACEHOLDER_RE, (match, type, fmt) => {
        const format = fmt ? fmt.substring(1) : null;
        if (type === 'date') return anchorMoment.format(format ?? 'YYYY-MM-DD');
        if (type === 'time') return moment().format(format ?? 'HH:mm');
        if (type === 'title') return anchorMoment.format(ctx.filenameFormat);
        return match;
    });
}

function resolveAnchorDate(ctx: TemplateContext): Date {
    switch (ctx.noteType) {
        case 'daily':   return ctx.triggerDate;
        case 'weekly':  return DateUtils.getWeekStart(ctx.triggerDate, ctx.weekStartDay);
        case 'monthly': return moment(ctx.triggerDate).startOf('month').toDate();
        case 'yearly':  return moment(ctx.triggerDate).startOf('year').toDate();
    }
}

export function normalizeTrailingNewline(content: string): string {
    if (content.length === 0) return content;
    return content.endsWith('\n') ? content : content + '\n';
}
