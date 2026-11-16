/**
 * What the E2E suite needs of the running Obsidian, checked once before the
 * first test file (vitest's `globalSetup`).
 *
 * A suite run where one of these does not hold fails by the hundreds and
 * for reasons that do not name it (an overlay opens in the settings window,
 * a focus test sees no focus, a view of a phone lays its parts out
 * otherwise), so the run is stopped here instead, with every check that
 * failed and what puts it right.
 *
 * Two things are put right here, as they change nothing the user set: the
 * window is brought to the front, and the plugin is loaded again when the
 * build in the Dev vault is not the one loaded. The window's size, the
 * theme and the settings are left as they are.
 */
import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { VAULT_PATHS } from '../../dev-paths.mjs';
import { obsidianCli, obsidianEval } from './helpers/cli-helper';

const PLUGIN_ID = 'obsidian-task-viewer';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const DEV_PLUGIN_DIR = path.join(VAULT_PATHS.dev, '.obsidian', 'plugins', PLUGIN_ID);
const BUILT_FILES = ['main.js', 'styles.css', 'manifest.json'];

/** Where the window lays its key the loaded build's fingerprint (see `loadedBuild`). */
const LOADED_BUILD_KEY = '__tvE2ELoadedBuild';

/** A check that failed: what was seen, and what puts it right. */
interface Problem {
    what: string;
    fix: string;
}

function errorOf(value: unknown): string | null {
    return value && typeof value === 'object' && 'error' in value ? String((value as { error: unknown }).error) : null;
}

/** The CLI answers from the Dev vault: the token sent comes back with the vault's path. */
function checkCli(): Problem | null {
    const token = randomUUID();
    const answer = obsidianEval(`JSON.stringify({ token: ${JSON.stringify(token)}, path: app.vault.adapter.basePath })`);
    const ok = answer && typeof answer === 'object' && (answer as { token?: string }).token === token;
    if (!ok) {
        return {
            what: `\`obsidian vault=dev eval\` did not answer with the token it was sent; it answered ${JSON.stringify(errorOf(answer) ?? answer)}`,
            fix: 'start Obsidian with the Dev vault open, and Settings > General > Command line interface on',
        };
    }
    const basePath = (answer as { path?: string }).path;
    if (path.resolve(basePath ?? '') !== path.resolve(VAULT_PATHS.dev)) {
        return {
            what: `the vault that answered is at ${basePath}, not at ${VAULT_PATHS.dev}`,
            fix: 'open the Dev vault (dev-paths.mjs) in Obsidian',
        };
    }
    return null;
}

/** Build time the bundle carries (`__BUILD_TIME__`), which differs between two builds of the same source. */
const BUILD_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)/g;

function builtFile(dir: string, name: string): string {
    const text = fs.readFileSync(path.join(dir, name), 'utf-8');
    return name === 'main.js' ? text.replace(BUILD_TIME, '') : text;
}

/**
 * The Dev vault holds the build of this checkout's source: the source is
 * built again, into a scratch folder, and its files compared with the
 * vault's, the build time aside. A comparison of the files' times would
 * stop a run after a mere switch of branch, which touches the source.
 */
function checkBuild(): Problem | null {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-e2e-build-'));
    try {
        try {
            execFileSync(process.execPath, ['esbuild.config.mjs', 'production'], {
                cwd: REPO,
                env: { ...process.env, OBSIDIAN_VAULT_PATH: scratch },
                stdio: 'pipe',
                timeout: 120000,
            });
        } catch (err) {
            const out = (err as { stderr?: Buffer }).stderr?.toString().trim() || String(err);
            return { what: `the source did not build: ${out}`, fix: 'make `npm run build` pass' };
        }
        const built = path.join(scratch, '.obsidian', 'plugins', PLUGIN_ID);
        const differ = BUILT_FILES.filter(name => {
            try {
                return builtFile(built, name) !== builtFile(DEV_PLUGIN_DIR, name);
            } catch {
                return true;
            }
        });
        if (differ.length === 0) return null;
        return {
            what: `the Dev vault's build is not this checkout's source (${differ.join(', ')} differ from a build of it)`,
            fix: 'run `npm run build` (it writes to the Dev vault); the plugin is then loaded again on the next run',
        };
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

/** A fingerprint of the build in the Dev vault, the build time aside. */
function devBuildFingerprint(): string {
    const hash = createHash('sha256');
    for (const name of BUILT_FILES) hash.update(name).update('\0').update(builtFile(DEV_PLUGIN_DIR, name)).update('\0');
    return hash.digest('hex');
}

/**
 * The plugin is enabled, and the build loaded is the one in the Dev vault.
 * Obsidian keeps no record of which files it loaded, so the window keeps
 * the fingerprint of the build each reload here loaded; when it is not the
 * vault's (a build since, or a window that was never reloaded here), the
 * plugin is loaded again.
 */
function checkPlugin(buildMatches: boolean): Problem | null {
    const state = obsidianEval(`JSON.stringify({
        enabled: app.plugins.enabledPlugins.has(${JSON.stringify(PLUGIN_ID)}),
        loaded: !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?._loaded,
        build: window[${JSON.stringify(LOADED_BUILD_KEY)}] ?? null,
    })`) as { enabled?: boolean; loaded?: boolean; build?: string | null };
    if (errorOf(state)) return { what: `the plugin's state could not be read: ${errorOf(state)}`, fix: 'see that the CLI answers (above)' };
    if (!state.enabled) {
        return { what: 'Task Viewer is not enabled in the Dev vault', fix: 'enable it in Settings > Community plugins' };
    }
    // A build that is not the source's is not loaded: the run stops on it anyway.
    if (!buildMatches) return null;
    const fingerprint = devBuildFingerprint();
    if (!state.loaded || state.build !== fingerprint) {
        const reloaded = obsidianEval(`(async () => {
            const id = ${JSON.stringify(PLUGIN_ID)};
            await app.plugins.disablePlugin(id);
            await app.plugins.enablePlugin(id);
            const end = Date.now() + 10000;
            while (!app.plugins.plugins[id]?._loaded && Date.now() < end) await new Promise(r => setTimeout(r, 100));
            const loaded = !!app.plugins.plugins[id]?._loaded;
            if (loaded) window[${JSON.stringify(LOADED_BUILD_KEY)}] = ${JSON.stringify(fingerprint)};
            return JSON.stringify(loaded);
        })()`);
        if (reloaded !== true) {
            return {
                what: `Task Viewer did not load again (disabled, then enabled): ${JSON.stringify(errorOf(reloaded) ?? reloaded)}`,
                fix: 'see the developer console of the Dev vault for the error of its load',
            };
        }
    }
    const listed = obsidianCli('list', { limit: '1' }) as { count?: unknown };
    if (typeof listed?.count !== 'number') {
        return {
            what: `the plugin's CLI command \`list\` did not answer with a count; it answered ${JSON.stringify(errorOf(listed) ?? listed)}`,
            fix: 'see the developer console of the Dev vault for the error of its load',
        };
    }
    return null;
}

/** Whether the main window of the Dev vault has the focus. */
function hasFocus(): boolean {
    return obsidianEval('JSON.stringify(document.hasFocus() && activeDocument === document)') === true;
}

/** Obsidian is the application in front, its main window focused; `open -a` brings it there. */
async function checkFront(): Promise<Problem | null> {
    if (hasFocus()) return null;
    if (process.platform === 'darwin') {
        execFileSync('open', ['-a', 'Obsidian']);
        const end = Date.now() + 5000;
        while (Date.now() < end) {
            await new Promise(r => setTimeout(r, 300));
            if (hasFocus()) return null;
        }
    }
    return {
        what: 'the main window of the Dev vault does not have the focus',
        fix: process.platform === 'darwin'
            ? 'bring it to the front (`open -a Obsidian` did not); close a pop-out window that has the focus, and keep other apps from taking it while the suite runs'
            : 'bring Obsidian to the front, its main window focused',
    };
}

/** What the window shows, read in one go. */
interface Screen {
    visibility: string;
    frame: boolean;
    settings: boolean;
    modals: number;
    overlays: number;
    mobile: boolean;
}

function readScreen(): Screen | { error: string } {
    return obsidianEval(`(async () => {
        const docs = [document, ...(app.workspace.floatingSplit?.children ?? []).map(w => w.doc).filter(Boolean)];
        const count = (sel) => docs.reduce((n, doc) => n + doc.querySelectorAll(sel).length, 0);
        const frame = await Promise.race([
            new Promise(r => requestAnimationFrame(() => r(true))),
            new Promise(r => setTimeout(() => r(false), 1000)),
        ]);
        return JSON.stringify({
            visibility: document.visibilityState,
            frame,
            settings: !!app.setting?.activeTab || !!app.setting?.containerEl?.isConnected,
            modals: count('.modal-container'),
            overlays: count('.tv-overlay'),
            mobile: !!app.isMobile || document.body.classList.contains('is-mobile'),
        });
    })()`) as Screen | { error: string };
}

function checkScreen(): Problem[] {
    const screen = readScreen();
    if ('error' in screen) return [{ what: `the window could not be read: ${screen.error}`, fix: 'see that the CLI answers (above)' }];
    const problems: Problem[] = [];
    if (screen.visibility !== 'visible' || !screen.frame) {
        problems.push({
            what: `the window is not drawn (visibility ${screen.visibility}, a frame ${screen.frame ? 'came' : 'did not come'} within 1 s)`,
            fix: 'show the window (not minimized, not hidden), and keep the display awake while the suite runs (`caffeinate -d -u`)',
        });
    }
    if (screen.settings) {
        problems.push({ what: 'the settings are open', fix: 'close the settings window' });
    } else if (screen.modals > 0) {
        problems.push({ what: `${screen.modals} modal(s) are open`, fix: 'close them (Escape)' });
    }
    if (screen.overlays > 0) {
        problems.push({ what: `${screen.overlays} of the plugin's overlay(s) are open (a dialog, a filter or sort menu)`, fix: 'close them' });
    }
    if (screen.mobile) {
        problems.push({
            what: 'the window emulates a phone or a tablet',
            fix: '`obsidian vault=dev dev:mobile off` (or `app.emulateMobile(false)` in the console)',
        });
    }
    return problems;
}

export default async function preflight(): Promise<void> {
    const problems: Problem[] = [];
    const cli = checkCli();
    if (cli) {
        problems.push(cli);
    } else {
        const build = checkBuild();
        if (build) problems.push(build);
        const plugin = checkPlugin(!build);
        if (plugin) problems.push(plugin);
        const front = await checkFront();
        if (front) problems.push(front);
        problems.push(...checkScreen());
    }
    if (problems.length === 0) return;
    throw new Error([
        `The E2E suite did not start: ${problems.length} of what it needs of the Dev vault's Obsidian ${problems.length === 1 ? 'does' : 'do'} not hold.`,
        ...problems.map((p, i) => `  ${i + 1}. ${p.what}\n     fix: ${p.fix}`),
    ].join('\n'));
}
