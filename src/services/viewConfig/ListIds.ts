/**
 * A new id for a saved list (a pinned list, a Kanban cell): unique in its
 * view, made of the time and a random part. A list is found by its id (its
 * collapsed state, its page, its cards' place), never by its name.
 */
export function newListId(): string {
    return 'list-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}
