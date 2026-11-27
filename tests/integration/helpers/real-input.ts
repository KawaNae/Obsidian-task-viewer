/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, the mouse and
 * the keyboard as the OS sends them to the window, through Electron
 * (`sendInputEvent`): the browser does with them what it does with a
 * person's, where a press puts the focus and which key scopes hear a key.
 * An event dispatched by script does neither. The window must have the
 * focus.
 *
 * - `press(el, { dy, holdMs })`: the left button pressed and let go on `el`,
 *   at its middle, or `dy` px below it. The point is measured once, before
 *   the press, and the button goes up where it went down, as a person's
 *   finger does though what was under it moves meanwhile. `holdMs` keeps it
 *   down that long, as a person's click does (some 100 ms), for what moves
 *   between the down and the up; with none, the up follows at once and the
 *   press is sent as it returns. It resolves once the up is sent
 * - `keys(name)`: a key pressed and let go as the keyboard sends it, for the
 *   browser's own Tab order and for Obsidian's key scopes
 */
export const REAL_INPUT = `
const press = async (el, { dy = 0, holdMs = 0 } = {}) => {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2 + dy);
    const contents = require('electron').remote.getCurrentWebContents();
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    if (holdMs > 0) await new Promise(resolve => setTimeout(resolve, holdMs));
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
};
const keys = name => {
    const contents = require('electron').remote.getCurrentWebContents();
    contents.sendInputEvent({ type: 'keyDown', keyCode: name });
    if (name.length === 1) contents.sendInputEvent({ type: 'char', keyCode: name });
    contents.sendInputEvent({ type: 'keyUp', keyCode: name });
};
`;
