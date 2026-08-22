import { DateUtils } from '../../utils/DateUtils';

/** Characters a vault path cannot carry (Obsidian + Windows union). */
const UNSAFE_IN_FILENAME = /[\\/:*?"<>|]/g;

/** A view label made safe to sit in a file name. */
export function sanitizeExportLabel(label: string): string {
    return label.replace(UNSAFE_IN_FILENAME, '_');
}

/**
 * File name for an exported view image: `<label>_<YYYY-MM-DD>.png`.
 *
 * The stamp is the LOCAL calendar day — it says when the export was made,
 * and the two call sites used to build it from `toISOString()`, so an
 * export made at 02:00 JST was named with yesterday's date. Not the visual
 * date: startHour shifts which day a *task* belongs to, which is a
 * different question from when a file was written.
 */
export function buildExportFilename(label: string): string {
    return `${sanitizeExportLabel(label)}_${DateUtils.getToday()}.png`;
}
