/**
 * A new id for a saved list (a pinned list, a Kanban cell): unique in its
 * view, made of the time and a random part. A list is found by its id (its
 * collapsed state, its page, its cards' place), never by its name.
 */
export function newListId(): string {
    return newId('list');
}

/**
 * A new id for a markdown frame of a sidebar, made as a list's is. The
 * sidebar finds a frame by its id whatever its kind, and the other prefix
 * keeps a markdown frame's id from being a list's.
 */
export function newMarkdownFrameId(): string {
    return newId('md');
}

function newId(prefix: string): string {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}
