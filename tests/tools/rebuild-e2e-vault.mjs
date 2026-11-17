// Rebuild the E2E vault from this checkout and leave it open, as the E2E
// suite does before its first test (tests/integration/vault/rebuild.ts),
// without running a test: for a look at the current source in a vault that
// holds nothing else.
//
//   npm run test:e2e:vault
//
// The rebuild is TypeScript whose imports name no extension, which Node
// does not resolve, so it is bundled first with the esbuild the build uses.
import esbuild from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tv-e2e-rebuild-"));
const outfile = path.join(scratch, "rebuild.mjs");

try {
  await esbuild.build({
    stdin: {
      contents: [
        'import { rebuildVault } from "./tests/integration/vault/rebuild";',
        'import { describeProblems } from "./tests/integration/vault/problem";',
        "export { rebuildVault, describeProblems };",
      ].join("\n"),
      resolveDir: repo,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    logLevel: "warning",
  });
  const { rebuildVault, describeProblems } = await import(pathToFileURL(outfile).href);
  const problems = await rebuildVault(repo, (message) => console.log(`[e2e] ${message}`));
  if (problems.length > 0) {
    console.error(describeProblems("The E2E vault was not rebuilt:", problems));
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
