const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, readFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createReleaseNotifications } = require("../release-notifications");

const account = { username: "person@example.com", name: "Person" };
const days = (...dates) => dates.map((date) => ({ date, products: [{ item: "Lunch" }] }));
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soodering-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sent = [];
  const options = {
    file: path.join(directory, "releases.json"), webhookUrl: "https://example.invalid/secret",
    today: () => "2026-10-26",
    fetchImpl: async (url, options) => { sent.push(JSON.parse(options.body)); return new Response(null, { status: 202 }); },
    ...overrides
  };
  return { service: createReleaseNotifications(options), options, sent };
}

test("baseline menus are silent; concurrent discoveries and restart send each date once", async (t) => {
  const { service, sent, options } = await fixture(t);
  await service.subscribe(account, true, days("2026-11-02"));
  await service.observe(days("2026-11-02"));
  assert.equal(sent.length, 0);
  await Promise.all([service.observe(days("2026-11-02", "2026-11-03", "2026-11-04")), service.observe(days("2026-11-04"))]);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ["email", "message", "subject", "username"]);
  assert.equal(sent[0].email, account.username);
  assert.equal(sent[0].username, "Person");
  assert.match(sent[0].message, /3 Nov 2026/);
  assert.match(sent[0].message, /4 Nov 2026/);
  assert.doesNotMatch(sent[0].message, /2 Nov 2026/);
  const restarted = createReleaseNotifications(options);
  await restarted.observe(days("2026-11-02", "2026-11-03", "2026-11-04"));
  assert.equal(sent.length, 1);
  assert.equal((await restarted.status(account)).subscribed, true);
});

test("only subscribers receive future published dates; disappearing dates do not resend", async (t) => {
  const { service, sent } = await fixture(t);
  await service.subscribe(account, true, []);
  await service.subscribe({ username: "other@example.com", name: "Other" }, true, []);
  await service.observe([...days("2026-10-25", "2026-11-03"), { date: "2026-11-04", products: [] }]);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent[0].message, /25 Oct|4 Nov/);
  await service.observe([]);
  await service.observe(days("2026-11-03"));
  assert.equal(sent.length, 2);
  await service.subscribe(account, false, []);
  await service.observe(days("2026-11-04"));
  assert.equal(sent.length, 3);
  assert.equal(sent[2].email, "other@example.com");
  await service.subscribe(account, true, days("2026-11-04"));
  await service.observe(days("2026-11-04"));
  assert.equal(sent.length, 3);
});

test("lost webhook responses are recorded and never sent again after restart", async (t) => {
  let sends = 0;
  const { service, options } = await fixture(t, { fetchImpl: async () => { sends++; throw new Error("timeout"); } });
  await service.subscribe(account, true, []);
  await service.observe(days("2026-11-03"));
  await createReleaseNotifications(options).observe(days("2026-11-03"));
  assert.equal(sends, 1);
  const state = JSON.parse(await readFile(options.file, "utf8"));
  assert.equal(Object.values(state.subscribers)[0].deliveries[0].status, "unknown");
});

test("HTTP rejection does not prevent other subscribers receiving their email", async (t) => {
  let sends = 0;
  const { service, options } = await fixture(t, { fetchImpl: async () => new Response(null, { status: ++sends === 1 ? 500 : 202 }) });
  await service.subscribe(account, true, []);
  await service.subscribe({ username: "other@example.com" }, true, []);
  await service.observe(days("2026-11-03"));
  const state = JSON.parse(await readFile(options.file, "utf8"));
  assert.deepEqual(Object.values(state.subscribers).map((entry) => entry.deliveries[0].status), ["failed", "accepted"]);
});

test("unconfigured email and invalid recipient accounts cannot subscribe", async (t) => {
  const { service } = await fixture(t, { webhookUrl: "" });
  assert.deepEqual(await service.status(account), { enabled: false, subscribed: false });
  await assert.rejects(service.subscribe(account, true, []), { status: 503 });
  const configured = await fixture(t);
  await assert.rejects(configured.service.subscribe({ username: "invalid" }, true, []), { status: 400 });
});
