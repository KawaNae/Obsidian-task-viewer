import type { App } from 'obsidian';
import { hasConditions } from '../services/filter/FilterTypes';
import { FilterSerializer, filterIssueText } from '../services/filter/FilterSerializer';
import { PinnedListQuery, type ListQuery } from '../services/filter/PinnedListQuery';
import { ViewTemplateLoader } from '../services/template/ViewTemplateLoader';
import { TaskApiError } from './TaskApiTypes';

/**
 * Load the query a filter file names: a FilterState (.json), or a view
 * template (.md) whose filter or pinned list `listName` the query is
 * (`PinnedListQuery.fromTemplate`). Returns the query, or the error; one
 * about the list asked for is about the parameter `list`.
 * A condition or a sort rule the file holds that cannot be read is an
 * error, as it is in the API's `filter`: a query does not run on part of
 * what it was asked.
 */
export async function loadFilterFile(
    app: App,
    filePath: string,
    listName?: string,
): Promise<ListQuery | TaskApiError> {
    const read = await readFilterFile(app, filePath, listName);
    if (typeof read === 'string') return new TaskApiError(read);
    if ('listError' in read) return new TaskApiError(name => read.listError(name('list')), 'list');
    return read;
}

async function readFilterFile(
    app: App,
    filePath: string,
    listName: string | undefined,
): Promise<ListQuery | string | { listError: (listParam: string) => string }> {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const exists = await app.vault.adapter.exists(normalizedPath);
    if (!exists) return `Filter file not found: ${normalizedPath}`;

    if (normalizedPath.endsWith('.json')) {
        const raw = await app.vault.adapter.read(normalizedPath);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch {
            return `Invalid JSON in filter file: ${normalizedPath}`;
        }
        const { state, issues } = FilterSerializer.parse(parsed);
        if (issues.length > 0) {
            return `Invalid filter in ${normalizedPath}: ${issues.map(filterIssueText).join('; ')}`;
        }
        if (!hasConditions(state)) {
            return `Invalid FilterState in ${normalizedPath}: no conditions found`;
        }
        return { filter: state };
    }

    if (normalizedPath.endsWith('.md')) {
        const template = await new ViewTemplateLoader(app).loadFullTemplate(normalizedPath);
        if (!template) return `Failed to load view template: ${normalizedPath}`;
        const read = PinnedListQuery.fromTemplate(template, listName);
        if ('error' in read) return read.error;
        return 'listError' in read ? read : read.query;
    }

    return `Unsupported file type: ${normalizedPath}. Use .json or .md`;
}
