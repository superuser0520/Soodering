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
  assert.match(app, /\/api\/session/);
  assert.match(app, /if \(!data\.notification\) return/);
  assert.match(html, /Dont eat so much yoghurt, eat proper food/);
  assert.match(app, /rowenaDismissAttempts >= 3/);
  assert.match(app, /attemptRowenaNotificationDismiss/);
});

test("login failures and native password storage have visible handling", async () => {
  const app = await readFile("public/app.js", "utf8");
  const html = await readFile("public/index.html", "utf8");
  assert.match(app, /navigator\.credentials\.store/);
  assert.match(app, /showSystemNotification\("Login unsuccessful"/);
  assert.match(html, /id="systemNotification"/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^,]+,\s*password/);
});

test("homepage includes the signed-in user's today-order quick view", async () => {
  const app = await readFile("public/app.js", "utf8");
  const html = await readFile("public/index.html", "utf8");
  const styles = await readFile("public/styles.css", "utf8");
  const renderer = app.match(/function renderTodayOrders\(orders\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(html, /id="todayOrdersList"/);
  assert.match(html, /Your order today/);
  assert.match(styles, /\.today-orders-list/);
  assert.match(renderer, /Signed-in account only/);
  assert.match(renderer, /orders\.map/);
});

test("wallet forecast uses the 27th-to-26th cycle and highest order per date", async () => {
  const app = await readFile("public/app.js", "utf8");
  const cycle = app.match(/function creditCycle\([\s\S]*?\n\}/)?.[0] || "";
  const spending = app.match(/function highestOrderSpendPerDate\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(cycle, /start\.setDate\(27\)/);
  assert.match(cycle, /addDays\(refresh, -1\)/);
  assert.match(spending, /new Map\(\)/);
  assert.match(spending, /Math\.max/);
  assert.match(spending, /order\.deliveryDate < cycle\.start/);
  assert.match(spending, /order\.deliveryDate > cycle\.end/);
});
