/**
 * The layers of a window: the elements its body holds, each a surface of
 * its own — the workspace, an overlay of ours, a popover, the list an
 * Obsidian suggest shows under an input, a menu — stacked in the order they
 * were put there. A surface opened on top of ours, while ours is open, is
 * put after it: a popover of ours (`PopoverShell`), and the lists and menus
 * Obsidian opens from a field of ours, which it puts on the body and not in
 * our panel (`AbstractInputSuggest`'s `.suggestion-container`).
 *
 * So what is on the body after a surface belongs to that surface: it was
 * opened while the surface was open, from it or over it, and a press there
 * is no press outside the surface. What stands before it — the workspace,
 * a surface already open when it opened — is outside it.
 */

/**
 * Whether `node` is in a layer put after `layer` (an element the body
 * holds): under an element of the same parent that follows it. Not for
 * `layer` itself, nor for what is in it.
 */
export function inLayerAbove(layer: Node, node: Node | null): boolean {
    const host = layer.parentNode;
    if (!host) return false;
    let at: Node | null = node;
    while (at && at.parentNode !== host) at = at.parentNode;
    if (!at || at === layer) return false;
    for (let next = layer.nextSibling; next; next = next.nextSibling) {
        if (next === at) return true;
    }
    return false;
}
