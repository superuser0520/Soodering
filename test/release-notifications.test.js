const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, readFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createReleaseNotifications, nextReleaseCheck } = require("../release-notifications");

test("release checks run at the next 08:00 Singapore time, independent of server timezone", () => {
  for (const [now, expected] of [
    ["2026-10-26T07:59:00+08:00", "2026-10-26T08:00:00+08:00"],
    ["2026-10-26T08:00:00+08:00", "2026-10-27T08:00:00+08:00"],
    ["2026-10-26T15:00:00+08:00", "2026-10-27T08:00:00+08:00"],
    ["2026-12-31T23:59:00+08:00", "2027-01-01T08:00:00+08:00"]
  ]) assert.equal(nextReleaseCheck(Date.parse(now)), Date.parse(expected));
});

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
  assert.match(sent[0].message, /Available dates: 3 Nov 2026 to 4 Nov 2026\./);
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

test("manual email targets the admin and leaves release subscription records untouched", async (t) => {
  const { service, sent } = await fixture(t);
  await service.subscribe(account, true, []);
  const result = await service.sendTest(account);
  assert.match(result.message, /accepted/);
  assert.equal(sent[0].email, account.username);
  assert.equal(sent[0].subject, "SooDering: test email");
  await service.observe(days("2026-11-03"));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].subject, "SooDering: new lunch orders available");
});

test("manual email reports missing configuration, HTTP rejection, and ambiguous network errors", async (t) => {
  const disabled = await fixture(t, { webhookUrl: "" });
  await assert.rejects(disabled.service.sendTest(account), { status: 503 });
  const rejected = await fixture(t, { fetchImpl: async () => new Response(null, { status: 401 }) });
  await assert.rejects(rejected.service.sendTest(account), /HTTP 401/);
  const lost = await fixture(t, { fetchImpl: async () => { throw new Error("secret URL must not leak"); } });
  await assert.rejects(lost.service.sendTest(account), /could not be confirmed/);
});

async function finishCampaign(service, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = (await service.adminList()).campaigns.find((entry) => entry.id === id);
    if (job.status !== "sending") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Announcement did not finish");
}

test("admin sees active subscribers and deduplicated past ordering users", async (t) => {
  const { service } = await fixture(t);
  await service.subscribe(account, true, []);
  await service.subscribe({ username: "unsubscribed@example.com" }, false, []);
  await service.recordCustomer(account);
  await service.recordCustomer({ ...account, username: "PERSON@example.com" });
  const list = await service.adminList();
  assert.deepEqual(list.subscribers, [{ email: account.username, username: account.name }]);
  assert.equal(list.customerCount, 1);
});

test("manual monthly announcements deduplicate overlapping groups across restart", async (t) => {
  const { service, sent, options } = await fixture(t);
  await service.subscribe(account, true, []);
  await service.recordCustomer(account);
  await service.recordCustomer({ username: "customer@example.com", name: "Customer" });
  const menus = days("2026-11-03", "2026-11-04", "2026-12-01");
  const preview = await service.previewAnnouncement("2026-11", "subscribers", menus);
  assert.equal(preview.recipientCount, 1);
  assert.deepEqual(preview.dates, ["2026-11-03", "2026-11-04"]);
  assert.equal("recipients" in preview, false);
  const job = await service.announce("2026-11", "subscribers", menus, preview.token);
  assert.equal((await finishCampaign(service, job.id)).accepted, 1);
  assert.match(sent[0].subject, /November 2026/);
  assert.match(sent[0].message, /Available dates: 3 Nov 2026 to 4 Nov 2026\./);
  assert.doesNotMatch(sent[0].message, /2026-12/);
  const restarted = createReleaseNotifications(options);
  const customerPreview = await restarted.previewAnnouncement("2026-11", "customers", menus);
  assert.equal(customerPreview.recipientCount, 1);
  assert.equal(customerPreview.skippedCount, 1);
  const customerJob = await restarted.announce("2026-11", "customers", menus, customerPreview.token);
  assert.equal((await finishCampaign(restarted, customerJob.id)).accepted, 1);
  assert.equal(sent[1].email, "customer@example.com");
  assert.equal((await restarted.previewAnnouncement("2026-11", "customers", menus)).recipientCount, 0);
});

test("stale previews, invalid choices, empty menus, and simultaneous sends cannot send duplicates", async (t) => {
  const { service, sent } = await fixture(t);
  const menus = days("2026-11-03");
  await service.subscribe(account, true, []);
  await assert.rejects(service.previewAnnouncement("2026-13", "subscribers", menus), { status: 400 });
  await assert.rejects(service.previewAnnouncement("2026-11", "everyone", menus), { status: 400 });
  const stale = await service.previewAnnouncement("2026-11", "subscribers", menus);
  await service.subscribe({ username: "new@example.com" }, true, []);
  await assert.rejects(service.announce("2026-11", "subscribers", menus, stale.token), { status: 409 });
  const empty = await service.previewAnnouncement("2026-12", "subscribers", menus);
  await assert.rejects(service.announce("2026-12", "subscribers", menus, empty.token), { status: 400 });
  const current = await service.previewAnnouncement("2026-11", "subscribers", menus);
  const results = await Promise.allSettled([service.announce("2026-11", "subscribers", menus, current.token), service.announce("2026-11", "subscribers", menus, current.token)]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  const job = results.find((entry) => entry.status === "fulfilled").value;
  await finishCampaign(service, job.id);
  assert.equal(sent.length, 2);
});

test("failed and ambiguous announcements remain claimed instead of resending", async (t) => {
  let sends = 0;
  const { service } = await fixture(t, { fetchImpl: async () => { if (++sends === 1) throw new Error("timeout"); return new Response(null, { status: 500 }); } });
  await service.subscribe(account, true, []);
  await service.subscribe({ username: "other@example.com" }, true, []);
  const menus = days("2026-11-03");
  const preview = await service.previewAnnouncement("2026-11", "subscribers", menus);
  const job = await service.announce("2026-11", "subscribers", menus, preview.token);
  const result = await finishCampaign(service, job.id);
  assert.equal(result.failed, 1);
  assert.equal(result.unknown, 1);
  assert.equal((await service.previewAnnouncement("2026-11", "subscribers", menus)).recipientCount, 0);
});
