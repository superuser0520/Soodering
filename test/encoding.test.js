const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");

test("public files remain UTF-8 without common mojibake", async () => {
  for (const file of ["public/index.html", "public/app.js", "public/styles.css"]) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /Ã.|Â.|â(?:€|œ|˜)|ðŸ/);
  }
});
