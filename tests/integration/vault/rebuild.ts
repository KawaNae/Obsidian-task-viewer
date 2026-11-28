/**
 * The E2E vault emptied and written again from its definition, then opened
 * by Obsidian, at the start of every run.
 *
 * The vault's window is closed before its folder is touched, and its
 * renderer is waited out: a page still running writes its workspace as it
 * closes or a second after a change of layout, over the definition. The
 * window is then opened again by a CLI call, which opens a registered vault
 * whose window is closed, and reads the folder anew; so the build loaded is
 * the one written, and no reload of the plugin is needed.
 *
 * What lies outside the folder is kept as it is: the vault's registration,
 * the record that its community plugins are trusted, and the window's place.
 * The one exception is the timers Task Viewer keeps open in `localStorage`,
 * which are removed before the window closes (`forgetTimers`).
 *
 * Each step needs the one before it; the first that does not hold stops the
 * rebuild and is said with what puts it right. Nothing in Obsidian is
 * touched until the checks that need no Obsidian hold.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { E2E_PATHS, VAULT_PATHS } from '../../../dev-paths.mjs';
import { obsidianEval } from '../helpers/cli-helper';
import { STORED_PLUGINS, TASK_VIEWER_ID, VAULT_FILES } from './definition';
import { emptyVaultFolder, whyNotEmptiable } from './emptying';
import { VAULT_NAME, VAULT_PATH } from './location';
import type { Problem } from './problem';

/** The vaults the user works in, which the emptying refuses whatever their markers say. */
const KEPT = [VAULT_PATHS.main, VAULT_PATHS.dev];

const BUILT_FILES = ['main.js', 'manifest.json', 'styles.css'];

/**
 * The window's outer size, set on every run so the tests that depend on the
 * width see the same one: Toolbar's sidebar opens beside the view only when
 * the view is wider than 768px, and suggest-lists.test.ts narrows the
 * window by 160px and needs the hub to move with it.
 */
export const WINDOW_SIZE = { width: 1600, height: 1000 };

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function errorOf(value: unknown): string | null {
    return value && typeof value === 'object' && 'error' in value ? String((value as { error: unknown }).error) : null;
}

function realPath(p: string): string {
    try {
        return fs.realpathSync.native(p);
    } catch {
        return path.resolve(p);
    }
}

// ── 1. What needs no Obsidian ──

function sha256(file: string): string {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function storeDir(id: string, version: string): string {
    return path.join(E2E_PATHS.plugins, id, version);
}

/** The other authors' plugins are in the store, each file the one the definition names. */
function checkStoredPlugins(): Problem[] {
    const problems: Problem[] = [];
    for (const plugin of STORED_PLUGINS) {
        const dir = storeDir(plugin.id, plugin.version);
        const missing = Object.keys(plugin.sha256).filter(name => !fs.existsSync(path.join(dir, name)));
        if (missing.length > 0) {
            problems.push({
                what: `${plugin.id} ${plugin.version} is not in the store: ${missing.join(', ')} not in ${dir}`,
                fix: `put the files of ${plugin.id}'s release ${plugin.version} there; their SHA-256 are in tests/integration/vault/definition.ts (DEVELOPER.md, the E2E vault)`,
            });
            continue;
        }
        for (const [name, expected] of Object.entries(plugin.sha256)) {
            const actual = sha256(path.join(dir, name));
            if (actual !== expected) {
                problems.push({
                    what: `${path.join(dir, name)} is not the file of ${plugin.id} ${plugin.version} the definition names (SHA-256 ${actual}, not ${expected})`,
                    fix: `put the file of ${plugin.id}'s release ${plugin.version} there`,
                });
            }
        }
    }
    return problems;
}

/** Build this checkout's source into a scratch folder; the folder holding the built files, or why it did not build. */
function buildPlugin(repo: string, scratch: string): Problem | string {
    try {
        execFileSync(process.execPath, ['esbuild.config.mjs', 'production'], {
            cwd: repo,
            env: { ...process.env, OBSIDIAN_VAULT_PATH: scratch },
            stdio: 'pipe',
            timeout: 120000,
        });
    } catch (err) {
        const out = (err as { stderr?: Buffer }).stderr?.toString().trim() || String(err);
        return { what: `the source did not build: ${out}`, fix: 'make the build pass (`npm run build` writes to the Dev vault; set OBSIDIAN_VAULT_PATH to try it elsewhere)' };
    }
    const dir = path.join(scratch, '.obsidian', 'plugins', TASK_VIEWER_ID);
    const missing = BUILT_FILES.filter(name => !fs.existsSync(path.join(dir, name)));
    if (missing.length > 0) return { what: `the build did not write ${missing.join(', ')}`, fix: 'see esbuild.config.mjs' };
    return dir;
}

// ── Obsidian ──

/**
 * `code` evaluated in the vault's window, called again while the window is
 * still loading: Obsidian answers a CLI call that opens a window before the
 * window can evaluate (`Command "eval" not found`).
 */
async function evalOnceLoaded(code: string, timeoutMs: number): Promise<unknown> {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const answer = obsidianEval(code);
        const error = errorOf(answer);
        if (!error || !/Command "eval" not found/.test(error) || Date.now() > end) return answer;
        await sleep(200);
    }
}

function cliProblem(answer: unknown): Problem {
    const error = errorOf(answer) ?? JSON.stringify(answer);
    if (/Vault not found/i.test(error)) {
        return {
            what: `Obsidian knows no vault named ${VAULT_NAME}`,
            fix: `open ${VAULT_PATH} as a vault in Obsidian once (DEVELOPER.md, the E2E vault)`,
        };
    }
    return {
        what: `\`obsidian vault=${VAULT_NAME} eval\` did not answer as asked; it answered ${JSON.stringify(error)}`,
        fix: 'start Obsidian, with Settings > General > Command line interface on',
    };
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/**
 * The timers Task Viewer has open in the vault, forgotten: a run that did
 * not close one (a CLI call that timed out after the timer started) would
 * otherwise leave it to every later run, the note it ran on gone and the
 * timer restored all the same.
 *
 * The plugin keeps its open timers in Obsidian's `localStorage`, outside the
 * folder, under a key of its own that names the vault; every vault's window
 * shares that storage, so only the key the plugin answers for this vault is
 * removed. The plugin is unloaded first, which saves what it holds one last
 * time, so nothing of it writes the key again before the window closes.
 *
 * A build that is not loaded, or that answers no key, has its timers left;
 * the tests that start timers close what is on the board after each test.
 */
function forgetTimers(): Problem | null {
    const answer = obsidianEval(`(async () => {
        const id = ${JSON.stringify(TASK_VIEWER_ID)};
        const key = app.plugins.plugins[id]?.getTimerWidget?.()?.persistence?.storageKey?.() ?? null;
        if (key === null) return JSON.stringify({ key });
        await app.plugins.disablePlugin(id);
        localStorage.removeItem(key);
        return JSON.stringify({ key, left: localStorage.getItem(key) !== null });
    })()`) as { key?: unknown; left?: unknown };
    if (errorOf(answer) || !answer || typeof answer !== 'object' || !('key' in answer)) return cliProblem(answer);
    if (answer.left) {
        return {
            what: `the open timers of ${VAULT_NAME} (localStorage \`${String(answer.key)}\`) were written again after they were removed`,
            fix: `close the timers in ${VAULT_NAME}'s widget by hand`,
        };
    }
    return null;
}

/**
 * 2. The vault's timers forgotten, its window closed and its renderer
 * ended. A closed window is opened by the call that asks for its renderer,
 * so an open and a closed one are closed the same way.
 */
async function closeWindow(): Promise<Problem | null> {
    const answer = await evalOnceLoaded('JSON.stringify({ path: app.vault.adapter.basePath, pid: process.pid })', 30000);
    const { path: basePath, pid } = (answer ?? {}) as { path?: unknown; pid?: unknown };
    if (typeof basePath !== 'string' || typeof pid !== 'number') return cliProblem(answer);
    if (realPath(basePath) !== realPath(VAULT_PATH)) {
        return {
            what: `the vault Obsidian calls ${VAULT_NAME} is at ${basePath}, not at ${VAULT_PATH}; its window was left open`,
            fix: `give the E2E vault's folder a name no other vault has (\`E2E_PATHS\` in dev-paths.mjs)`,
        };
    }
    const timers = forgetTimers();
    if (timers) return timers;
    // Closed a moment later, so the call that asked for it is answered first.
    const closing = obsidianEval(`(setTimeout(() => require('electron').remote.getCurrentWindow().close(), 50), JSON.stringify(true))`);
    if (closing !== true) return cliProblem(closing);
    const end = Date.now() + 10000;
    while (alive(pid)) {
        if (Date.now() > end) {
            return {
                what: `the window of ${VAULT_NAME} was asked to close, and its renderer (pid ${pid}) has not ended in 10 s`,
                fix: `close the window of ${VAULT_NAME} by hand`,
            };
        }
        await sleep(50);
    }
    return null;
}

/** 3. The folder emptied but for its marker, and the definition, the build and the stored plugins written. */
function writeVault(built: string): Problem | null {
    const refusal = emptyVaultFolder(VAULT_PATH, KEPT);
    if (refusal) return refusal;
    for (const [rel, content] of Object.entries(VAULT_FILES)) {
        const abs = path.join(VAULT_PATH, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
    }
    const copy = (from: string, id: string, names: string[]) => {
        const to = path.join(VAULT_PATH, '.obsidian', 'plugins', id);
        fs.mkdirSync(to, { recursive: true });
        for (const name of names) fs.copyFileSync(path.join(from, name), path.join(to, name));
    };
    copy(built, TASK_VIEWER_ID, BUILT_FILES);
    for (const plugin of STORED_PLUGINS) copy(storeDir(plugin.id, plugin.version), plugin.id, Object.keys(plugin.sha256));
    return null;
}

/** 4. The window opened on the folder written, its layout ready and every community plugin of the definition loaded. */
async function openWindow(): Promise<Problem | null> {
    const ids = [TASK_VIEWER_ID, ...STORED_PLUGINS.map(p => p.id)];
    const code = `JSON.stringify({
        ready: app.workspace.layoutReady,
        restricted: !app.plugins.isEnabled(),
        loaded: ${JSON.stringify(ids)}.filter(id => !!app.plugins.plugins[id]?._loaded),
    })`;
    const end = Date.now() + 30000;
    let state: { ready?: boolean; restricted?: boolean; loaded?: string[] } = {};
    for (;;) {
        const answer = await evalOnceLoaded(code, 30000);
        if (errorOf(answer) || typeof answer !== 'object') return cliProblem(answer);
        state = answer as typeof state;
        if (state.ready && state.loaded?.length === ids.length) return null;
        if (state.ready && state.restricted) {
            return {
                what: `the community plugins are off in ${VAULT_NAME} (restricted mode)`,
                fix: `\`obsidian vault=${VAULT_NAME} plugins:restrict off\`, once: the vault keeps it`,
            };
        }
        if (Date.now() > end) break;
        await sleep(200);
    }
    const notLoaded = ids.filter(id => !state.loaded?.includes(id));
    return {
        what: state.ready
            ? `${notLoaded.join(', ')} did not load in ${VAULT_NAME} within 30 s of its opening`
            : `the layout of ${VAULT_NAME} was not ready within 30 s of its opening`,
        fix: `see the developer console of ${VAULT_NAME} for the error of its load`,
    };
}

/**
 * 5a. The window neither maximized nor full screen, at `WINDOW_SIZE` in the
 * top left of its display's work area. A test that resizes the window
 * (suggest-lists.test.ts) needs a window that can be resized.
 */
async function sizeWindow(log: (message: string) => void): Promise<Problem | null> {
    const { width, height } = WINDOW_SIZE;
    const answer = obsidianEval(`(async () => {
        const { remote } = require('electron');
        const win = remote.getCurrentWindow();
        if (win.isFullScreen()) {
            win.setFullScreen(false);
            const end = Date.now() + 5000;
            while (win.isFullScreen() && Date.now() < end) await new Promise(r => setTimeout(r, 100));
            // macOS animates the way out of full screen after the flag is off.
            await new Promise(r => setTimeout(r, 1000));
        }
        if (win.isMaximized()) win.unmaximize();
        const area = remote.screen.getDisplayMatching(win.getBounds()).workArea;
        if (area.width < ${width} || area.height < ${height}) return JSON.stringify({ area });
        win.setBounds({ x: area.x, y: area.y, width: ${width}, height: ${height} });
        await new Promise(r => setTimeout(r, 300));
        return JSON.stringify({
            area,
            bounds: win.getBounds(),
            full: win.isFullScreen(),
            maximized: win.isMaximized(),
            inner: [window.innerWidth, window.innerHeight],
        });
    })()`) as { area?: { width: number; height: number }; bounds?: { width: number; height: number }; full?: boolean; maximized?: boolean; inner?: number[] };
    if (errorOf(answer) || !answer?.area) return cliProblem(answer);
    const { area, bounds } = answer;
    if (!bounds) {
        return {
            what: `the window of ${width}x${height} the suite sets does not fit in the display's work area of ${area.width}x${area.height}`,
            fix: 'run the suite with the window on a larger display, or make WINDOW_SIZE in tests/integration/vault/rebuild.ts smaller and see the tests that depend on the width pass',
        };
    }
    if (bounds.width !== width || bounds.height !== height || answer.full || answer.maximized) {
        return {
            what: `the window is ${bounds.width}x${bounds.height}${answer.full ? ', full screen' : ''}${answer.maximized ? ', maximized' : ''} after it was set to ${width}x${height}`,
            fix: `take the window of ${VAULT_NAME} out of full screen by hand`,
        };
    }
    log(`window ${bounds.width}x${bounds.height}, its page ${answer.inner?.join('x')}`);
    return null;
}

/**
 * Whether the vault's window has the focus. The window's own word is asked
 * as well as the page's: a page just loaded says it has the focus
 * (`document.hasFocus()`) while another window has it.
 */
function focused(): boolean {
    return obsidianEval(`JSON.stringify(require('electron').remote.getCurrentWindow().isFocused()
        && document.hasFocus() && activeDocument === document)`) === true;
}

/**
 * 5b. The window in front with the focus. `open -a Obsidian` brings to the
 * front whichever of Obsidian's windows had the focus last, and a window's
 * `focus()` brings it forward only while Obsidian is the application in
 * front, so the two are sent in that order.
 */
async function bringToFront(): Promise<Problem | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        execFileSync('open', ['-a', 'Obsidian']);
        obsidianEval(`(require('electron').remote.getCurrentWindow().focus(), JSON.stringify(true))`);
        const end = Date.now() + 2000;
        while (Date.now() < end) {
            if (focused()) return null;
            await sleep(200);
        }
    }
    return {
        what: `the window of ${VAULT_NAME} does not have the focus`,
        fix: 'close a pop-out window that has the focus, and keep other apps from taking it while the suite runs',
    };
}

/**
 * Empty the E2E vault, write it from its definition and this checkout's
 * build (`repo`), open it in Obsidian, and set its window. The problems are
 * those of the first step that did not hold; none when the vault is ready.
 */
export async function rebuildVault(repo: string, log: (message: string) => void = () => {}): Promise<Problem[]> {
    const started = Date.now();
    const problems: Problem[] = [];
    const refusal = whyNotEmptiable(VAULT_PATH, KEPT);
    if (refusal) problems.push(refusal);
    problems.push(...checkStoredPlugins());
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-e2e-build-'));
    try {
        const built = buildPlugin(repo, scratch);
        if (typeof built !== 'string') problems.push(built);
        if (problems.length > 0 || typeof built !== 'string') return problems;

        const steps: [string, () => Problem | null | Promise<Problem | null>][] = [
            ['closing the window', closeWindow],
            ['writing the vault', () => writeVault(built)],
            ['opening the window', openWindow],
            ['sizing the window', () => sizeWindow(log)],
            ['bringing the window to the front', bringToFront],
        ];
        for (const [name, step] of steps) {
            const at = Date.now();
            const problem = await step();
            log(`${name}: ${problem ? 'failed' : 'done'} in ${((Date.now() - at) / 1000).toFixed(1)} s`);
            if (problem) return [problem];
        }
        log(`${VAULT_NAME} rebuilt at ${VAULT_PATH} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        return [];
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}
