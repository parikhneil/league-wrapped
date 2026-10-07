import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_ASSETS = Object.freeze([
  "index.html", "report.html", "report_espn.html", "report_sleeper.html", "players.html",
  "espn_league.js", "league-data.js", "league-stats.js", "league-ui.js", "league.css",
  "trade-analysis.js", "comeback-history.js",
  "chat-widget.js", "chat-widget.css",
]);

export function buildPublic(rootDir) {
  const root = fs.realpathSync(rootDir);
  const output = path.join(root, "dist");
  // Never publish the repository root, credentials, raw fetch data, or server code.
  // Validate every asset before replacing the prior public build.
  const assets = PUBLIC_ASSETS.map((name) => {
    const source = path.join(root, name);
    if (!fs.lstatSync(source).isFile() || path.dirname(fs.realpathSync(source)) !== root) {
      throw new Error(`Public asset must be a regular repository file: ${name}`);
    }
    const content = fs.readFileSync(source);
    if (/gsk_[A-Za-z0-9_-]{16,}/.test(content.toString("utf8"))) {
      throw new Error(`A public asset appears to contain an API key: ${name}`);
    }
    return { name, content };
  });
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) {
    throw new Error("The public output directory must not be a symlink.");
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output);
  for (const asset of assets) fs.writeFileSync(path.join(output, asset.name), asset.content);
  return assets.map((asset) => asset.name);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = buildPublic(path.dirname(fileURLToPath(import.meta.url)));
  console.log(`Built ${files.length} public dashboard assets in dist/.`);
}
