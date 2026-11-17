/**
 * The E2E suite's start, run once before the first test file (vitest's
 * `globalSetup`): the E2E vault is rebuilt from its definition and this
 * checkout's source (`vault/rebuild.ts`), and what the suite needs of the
 * window is checked.
 *
 * A suite run where one of these does not hold fails by the hundreds and
 * for reasons that do not name it (an overlay opens in the settings window,
 * a focus test sees no focus, a view of a phone lays its parts out
 * otherwise), so the run is stopped here instead, with every check that
 * failed and what puts it right.
 */
import { fileURLToPath } from 'url';
import { obsidianCli, obsidianEval } from './helpers/cli-helper';
import { rebuildVault } from './vault/rebuild';
import { VAULT_NAME } from './vault/location';
import { describeProblems, type Problem } from './vault/problem';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

function errorOf(value: unknown): string | null {
    return value && typeof value === 'object' && 'error' in value ? String((value as { error: unknown }).error) : null;
}

/** The plugin answers its own CLI commands, which most tests drive it by. */
function checkPluginCli(): Problem | null {
    const listed = obsidianCli('list', { limit: '1' }) as { count?: unknown };
    if (typeof listed?.count === 'number') return null;
    return {
        what: `the plugin's CLI command \`list\` did not answer with a count; it answered ${JSON.stringify(errorOf(listed) ?? listed)}`,
        fix: `see the developer console of ${VAULT_NAME} for the error of its load`,
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

/**
 * The window is drawn and shows nothing in the way. The emulation of a
 * phone is kept outside the vault (Obsidian's `localStorage`), so the
 * rebuild does not end it.
 */
function checkScreen(): Problem[] {
    const screen = readScreen();
    if ('error' in screen) return [{ what: `the window could not be read: ${screen.error}`, fix: `see that \`obsidian vault=${VAULT_NAME} eval\` answers` }];
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
            fix: `\`obsidian vault=${VAULT_NAME} dev:mobile off\` (or \`app.emulateMobile(false)\` in the console)`,
        });
    }
    return problems;
}

export default async function preflight(): Promise<void> {
    if (process.platform !== 'darwin') {
        throw new Error(`The E2E suite runs on macOS only, not on ${process.platform}.`);
    }
    const problems = await rebuildVault(REPO, message => console.log(`[e2e] ${message}`));
    if (problems.length === 0) {
        const cli = checkPluginCli();
        if (cli) problems.push(cli);
        problems.push(...checkScreen());
    }
    if (problems.length === 0) return;
    throw new Error(describeProblems(
        `The E2E suite did not start: ${problems.length} of what it needs of ${VAULT_NAME}'s Obsidian ${problems.length === 1 ? 'does' : 'do'} not hold.`,
        problems,
    ));
}
