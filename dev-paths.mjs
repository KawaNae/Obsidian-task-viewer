// Where this machine keeps its Obsidian vaults. The build writes the plugin
// into one of them and the E2E suite rebuilds and drives its own, so both
// read the paths from here rather than each holding its own copy.
import os from "os";
import path from "path";

const VAULT_ROOTS = {
  win32: "C:\\Obsidian",
  darwin: path.join(os.homedir(), "Develop", "Obsidian"),
};

const root = VAULT_ROOTS[process.platform];
if (!root) {
  throw new Error(
    `dev-paths: no vault root for platform "${process.platform}". Add one to VAULT_ROOTS in dev-paths.mjs.`
  );
}

export const VAULT_PATHS = {
  dev: path.join(root, "Dev"),
  main: path.join(root, "Main"),
};

// The E2E suite runs on macOS only. Its vault is emptied and written again
// on every run, so the path is held here alone and not read from the
// environment: a variable could point the emptying at another folder.
export const E2E_PATHS = {
  vault: path.join(root, "DevE2E"),
  // Other authors' plugins the E2E vault installs, kept outside the
  // repository and checked against the hashes the vault's definition holds:
  // <plugins>/<id>/<version>/<file>.
  plugins: path.join(root, "_e2e-plugins"),
};
