import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { TaskApiError } from '../../api/TaskApiTypes';
import type { QueryResult } from '../../api/TaskApiTypes';
import {
    pickFields, resolveFields, cliError,
    type OutputFormat,
} from '../CliOutputFormatter';

const VALID_FORMATS = new Set(['json', 'tsv', 'jsonl']);

export function createQueryHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.template) return cliError('Missing required flag: --template');

        if (params.format && !VALID_FORMATS.has(params.format)) {
            return cliError(`Invalid format: ${params.format}. Must be json, tsv, or jsonl`);
        }

        try {
            const result = await plugin.api.query({
                template: params.template,
                date: params.date,
            });

            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params.outputFields);
            return formatQueryResult(result, format, fields);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.message : String(e));
        }
    };
}

function formatQueryResult(
    result: QueryResult,
    format: OutputFormat,
    fields: string[],
): string {
    switch (format) {
        case 'tsv': {
            const header = fields.join('\t');
            const sections = result.lists.map(list => {
                const rows = list.tasks.map(t =>
                    fields.map(f => tsvVal(pickFields(t, fields)[f])).join('\t'),
                );
                return `## ${list.name}\n${header}\n${rows.join('\n')}`;
            });
            return sections.join('\n\n');
        }

        case 'jsonl':
            return result.lists.flatMap(list =>
                list.tasks.map(t =>
                    JSON.stringify({ _list: list.name, ...pickFields(t, fields) }),
                ),
            ).join('\n');

        case 'json':
        default:
            return JSON.stringify({
                template: result.template,
                viewType: result.viewType,
                lists: result.lists.map(list => ({
                    name: list.name,
                    count: list.count,
                    tasks: list.tasks.map(t => pickFields(t, fields)),
                })),
            });
    }
}

function tsvVal(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(';');
    return String(value).replace(/[\t\n\r]/g, ' ');
}
