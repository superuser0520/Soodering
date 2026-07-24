const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");

test("public files remain UTF-8 without common mojibake", async () => {
  for (const file of ["public/index.html", "public/app.js", "public/styles.css"]) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /Ã.|Â.|â(?:€|œ|˜)|ðŸ/);
  }
});

test("ordered menu dates use the concise status label", async () => {
  const app = await readFile("public/app.js", "utf8");
  assert.match(app, /alreadyOrdered \? "Ordered"/);
  assert.doesNotMatch(app, /Already ordered, still can order again/);
});

test("Rowena login Easter egg is case-insensitive and keeps the requested copy", async () => {
  const app = await readFile("public/app.js", "utf8");
  const html = await readFile("public/index.html", "utf8");
  const trigger = app.match(/function accountContainsRowena\(account\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(trigger, /\/rowena\/i\.test\(String\(account\?\.name/);
  assert.doesNotMatch(trigger, /username/);
  assert.match(html, /Dont eat so much yoghurt, eat proper food/);
});

test("login failures and native password storage have visible handling", async () => {
  const app = await readFile("public/app.js", "utf8");
  const html = await readFile("public/index.html", "utf8");
  assert.match(app, /navigator\.credentials\.store/);
  assert.match(app, /showSystemNotification\("Login unsuccessful"/);
  assert.match(html, /id="systemNotification"/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^,]+,\s*password/);
});
