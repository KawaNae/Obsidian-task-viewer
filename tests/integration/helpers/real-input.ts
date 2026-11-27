/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, the mouse and
 * the keyboard as the OS sends them to the window, through Electron
 * (`sendInputEvent`): the browser does with them what it does with a
 * person's, where a press puts the focus and which key scopes hear a key.
 * An event dispatched by script does neither. The window must have the
 * focus.
 *
 * - `press(el, { dx, dy, holdMs, button })`: a button pressed and let go on
 *   `el`, at its middle, or `dx` px right of it and `dy` px below it; the
 *   left button, or `button: 'right'`, after which the browser sends the
 *   `contextmenu` a person's right click does. `el` is first scrolled into sight,
 *   as a person scrolls to what they press, and the point must then be on
 *   `el` or in it: a point on something else (out of a scrolled body, under
 *   a backdrop or another element over it) throws at once, nothing sent,
 *   since the press would land on that other thing.
 *   The point is measured once, before the press, and the button goes up
 *   where it went down, as a person's finger does though what was under it
 *   moves meanwhile. `holdMs` keeps it down that long, as a person's click
 *   does (some 100 ms), for what moves between the down and the up; with
 *   none, the up follows at once and the press is sent as it returns. It
 *   resolves once the up is sent
 * - `keys(name)`: a key pressed and let go as the keyboard sends it, for the
 *   browser's own Tab order and for Obsidian's key scopes
 */
export const REAL_INPUT = `
const press = (el, { dx = 0, dy = 0, holdMs = 0, button = 'left' } = {}) => {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2 + dx);
    const y = Math.round(r.top + r.height / 2 + dy);
    const at = document.elementFromPoint(x, y);
    if (!el.contains(at)) {
        const name = e => e ? e.tagName + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '') : 'nothing';
        throw new Error('press: the point (' + x + ', ' + y + ') is on ' + name(at) + ', not on ' + name(el));
    }
    const contents = require('electron').remote.getCurrentWebContents();
    contents.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
    const up = () => contents.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
    if (holdMs > 0) return new Promise(resolve => setTimeout(resolve, holdMs)).then(up);
    up();
    return Promise.resolve();
};
const keys = name => {
    const contents = require('electron').remote.getCurrentWebContents();
    contents.sendInputEvent({ type: 'keyDown', keyCode: name });
    if (name.length === 1) contents.sendInputEvent({ type: 'char', keyCode: name });
    contents.sendInputEvent({ type: 'keyUp', keyCode: name });
};
`;
