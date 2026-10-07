const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function fixture(t) {
  const { buildPublic, PUBLIC_ASSETS } = await import("../build-netlify.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "league-public-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of PUBLIC_ASSETS) fs.writeFileSync(path.join(root, name), `Public ${name}`);
  return { root, buildPublic, PUBLIC_ASSETS };
}

test("Netlify publishes only dashboard assets, even with credentials and raw data in the repository", async (t) => {
  const f = await fixture(t);
  for (const name of [".env", "espn_secrets.json", "server.mjs"]) fs.writeFileSync(path.join(f.root, name), "private-test-marker");
  fs.mkdirSync(path.join(f.root, "data_espn"));
  fs.writeFileSync(path.join(f.root, "data_espn", "league.json"), "raw-test-marker");
  assert.deepEqual(f.buildPublic(f.root), f.PUBLIC_ASSETS);
  assert.deepEqual(fs.readdirSync(path.join(f.root, "dist")).sort(), [...f.PUBLIC_ASSETS].sort());
  fs.writeFileSync(path.join(f.root, "dist", "unexpected.txt"), "stale");
  f.buildPublic(f.root);
  assert.equal(fs.existsSync(path.join(f.root, "dist", "unexpected.txt")), false);
});

test("a Groq key accidentally embedded in a public asset fails the build before publishing", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, "index.html"), "gsk_test_placeholder_key_12345678");
  assert.throws(() => f.buildPublic(f.root), /appears to contain an API key/);
  assert.equal(fs.existsSync(path.join(f.root, "dist")), false);
});

test("symlinks cannot copy a private file or redirect the publish directory", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, ".env"), "private");
  fs.unlinkSync(path.join(f.root, "index.html"));
  fs.symlinkSync(path.join(f.root, ".env"), path.join(f.root, "index.html"));
  assert.throws(() => f.buildPublic(f.root), /regular repository file/);
  fs.unlinkSync(path.join(f.root, "index.html"));
  fs.writeFileSync(path.join(f.root, "index.html"), "public");
  fs.mkdirSync(path.join(f.root, "private"));
  fs.symlinkSync(path.join(f.root, "private"), path.join(f.root, "dist"));
  assert.throws(() => f.buildPublic(f.root), /must not be a symlink/);
});
