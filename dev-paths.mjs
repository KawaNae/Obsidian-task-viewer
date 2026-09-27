// Where this machine keeps its Obsidian vaults. The build writes the plugin
// into one of them and the E2E suite drives the Dev one, so both read the
// paths from here rather than each holding its own copy.
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
