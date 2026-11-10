const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

test("subscription API requires login, validates opt-in, and keeps the webhook private", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soodering-release-api-"));
  const realFetch = global.fetch;
  process.env.SOODEERING_DATA_DIR = directory;
  process.env.POWER_AUTOMATE_RELEASE_URL = "https://example.invalid/private-webhook-secret";
  process.env.CAFETERIA_ORIGIN = "https://cafeteria.invalid";
  process.env.USAGE_ADMIN_EMAIL = "admin@example.com";
  let upstreamRequests = 0;
  let menuChecks = 0;
  let releaseMenuCheck;
  let signalMenuStarted;
  const menuStarted = new Promise((resolve) => { signalMenuStarted = resolve; });
  const menuBlocked = new Promise((resolve) => { releaseMenuCheck = resolve; });
  let releaseAutoMenuCheck;
  let signalAutoMenuStarted;
  const autoMenuStarted = new Promise((resolve) => { signalAutoMenuStarted = resolve; });
  const autoMenuBlocked = new Promise((resolve) => { releaseAutoMenuCheck = resolve; });
  const sent = [];
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://example.invalid/")) {
      sent.push(JSON.parse(options.body));
      return new Response(null, { status: 202 });
    }
    upstreamRequests++;
    if (new URL(url).pathname === "/lunch/") {
      menuChecks++;
      if (menuChecks === 1) {
        signalMenuStarted();
        await menuBlocked;
      } else if (menuChecks === 2) {
        signalAutoMenuStarted();
        await autoMenuBlocked;
      }
      throw new Error("Menu temporarily unavailable");
    }
    if (String(url).includes("/orders/")) return new Response('<table><tbody><tr><td>#123</td><td>Today</td><td>November 3, 2026</td><td>Chicken</td><td>Processing</td><td>$5</td></tr></tbody></table>');
    return new Response('<p>Hello <strong>Person</strong></p><p class="woo-wallet-price">$100</p>');
  };
  const { server } = require("../server");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const anonymous = await realFetch(`${base}/api/release-subscription`);
    assert.equal(anonymous.status, 401);
    const login = await realFetch(`${base}/api/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "person@example.com", password: "test", autoLogin: true }),
      signal: AbortSignal.timeout(3000)
    });
    assert.equal(login.status, 200);
    await menuStarted;
    assert.equal(menuChecks, 1); // Login completes even while the release check is blocked.
    releaseMenuCheck();
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    const status = await realFetch(`${base}/api/release-subscription`, { headers: { cookie } });
    assert.deepEqual(await status.json(), { enabled: true, subscribed: false });
    const invalid = await realFetch(`${base}/api/release-subscription`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ subscribed: "yes" })
    });
    assert.equal(invalid.status, 400);
    const unsubscribe = await realFetch(`${base}/api/release-subscription`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ subscribed: false, email: "someone-else@example.com" })
    });
    assert.deepEqual(await unsubscribe.json(), { enabled: true, subscribed: false });
    const config = await realFetch(`${base}/api/config`);
    assert.doesNotMatch(await config.text(), /private-webhook-secret|POWER_AUTOMATE_RELEASE_URL/);
    assert.equal(upstreamRequests, 4); // Login page, login POST, wallet, and login-triggered menu check.
    assert.equal(menuChecks, 1); // Subscription/config requests must not trigger more checks.
    const autoCookie = login.headers.getSetCookie().find((value) => /^soodering_auto_login=[a-f0-9]{64};/.test(value)).split(";")[0];
    const restored = await realFetch(`${base}/api/session`, { headers: { cookie: autoCookie }, signal: AbortSignal.timeout(3000) });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).account.username, "person@example.com");
    await autoMenuStarted;
    releaseAutoMenuCheck();
    const denied = await realFetch(`${base}/api/admin/release-test-email`, {
      method: "POST", headers: { cookie }, body: "{}"
    });
    assert.equal(denied.status, 403);
    assert.equal(sent.length, 0);
    const adminLogin = await realFetch(`${base}/api/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin@example.com", password: "test" })
    });
    const adminCookie = adminLogin.headers.getSetCookie()[0].split(";")[0];
    const noGet = await realFetch(`${base}/api/admin/release-test-email`, { headers: { cookie: adminCookie } });
    assert.equal(noGet.status, 405);
    const manual = await realFetch(`${base}/api/admin/release-test-email`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "other@example.com" })
    });
    assert.equal(manual.status, 200);
    assert.match((await manual.json()).message, /accepted/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, "admin@example.com");
    for (const endpoint of ["release-audience", "release-preview", "release-announce"]) {
      const blocked = await realFetch(`${base}/api/admin/${endpoint}`, { headers: { cookie } });
      assert.equal(blocked.status, 403);
    }
    const orders = await realFetch(`${base}/api/orders`, { headers: { cookie } });
    assert.equal(orders.status, 200);
    const menuDate = "2099-11-03";
    await writeFile(path.join(directory, "menu-cache.json"), JSON.stringify({ cacheVersion: 3,
      fetchedAt: new Date().toISOString(), days: [{ date: menuDate, products: [{ item: "Chicken" }] }] }));
    const audience = await realFetch(`${base}/api/admin/release-audience`, { headers: { cookie: adminCookie } });
    const audienceData = await audience.json();
    assert.equal(audienceData.customerCount, 1);
    assert.match(audienceData.defaultMonth, /^\d{4}-\d{2}$/);
    const planResponse = await realFetch(`${base}/api/admin/release-preview?month=2099-11&audience=customers`, { headers: { cookie: adminCookie } });
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.equal(plan.recipientCount, 1);
    const announcement = await realFetch(`${base}/api/admin/release-announce`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ month: "2099-11", audience: "customers", token: plan.token })
    });
    assert.equal(announcement.status, 202);
    for (let attempt = 0; attempt < 100; attempt++) {
      const list = await realFetch(`${base}/api/admin/release-audience`, { headers: { cookie: adminCookie } });
      if ((await list.json()).campaigns[0].status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(sent.length, 2);
    assert.equal(sent[1].email, "person@example.com");
    assert.match(sent[1].subject, /November 2099/);
  } finally {
    releaseMenuCheck();
    releaseAutoMenuCheck();
    await new Promise((resolve) => server.close(resolve));
    global.fetch = realFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
