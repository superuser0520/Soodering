const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

function browser() {
  const storage = new Map();
  const element = () => ({ value: "0", textContent: "", classList: { toggle() {} }, querySelectorAll: () => [] });
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [] },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    crypto: { randomUUID },
    setTimeout: (callback) => { callback(); }, clearTimeout() {},
    Intl, Date, console
  });
  const source = fs.readFileSync("public/app.js", "utf8").split('refreshButton.addEventListener("click"')[0];
  vm.runInContext(source, context);
  vm.runInContext('state.account = { username: "test@example.com" };', context);
  return { context, storage, run: (code) => vm.runInContext(code, context) };
}

test("queue operation identity includes every meal and checkout option", () => {
  const { run } = browser();
  run('var body = { selections: [{ date: "2026-10-01", productId: "1", quantity: 1 }, { date: "2026-10-02", productId: "2", quantity: 1 }], timeSlot: "11:30", notes: "" };');
  const first = run("orderOperationKey(body)");
  assert.equal(run("orderOperationKey(body)"), first);
  assert.notEqual(run('body.selections[1].productId = "3"; orderOperationKey(body)'), first);
  assert.equal(run('body.selections[1].productId = "2"; orderOperationKey(body)'), first);
  assert.notEqual(run('body.timeSlot = "12:00"; orderOperationKey(body)'), first);
});

test("leave days are isolated by account and credit cycle", () => {
  const { run, storage } = browser();
  storage.set("soodering.leaveDays.test@example.com", "9");
  storage.set("soodering.leaveDays.test@example.com.2026-09-27", "3");
  run('syncLeaveDays({ start: "2026-09-27", workingDays: 20 })');
  assert.equal(run("state.leaveDays"), 3);
  run('syncLeaveDays({ start: "2026-10-27", workingDays: 20 })');
  assert.equal(run("state.leaveDays"), 0);
  run('state.account.username = "other@example.com"; syncLeaveDays({ start: "2026-09-27", workingDays: 20 })');
  assert.equal(run("state.leaveDays"), 0);
});

test("reopening restores saved queue progress without submitting orders", async () => {
  const { run, storage } = browser();
  storage.set("soodering.activeOrderJob.test@example.com", JSON.stringify({ id: "saved-job", products: [{ date: "2026-10-01", id: "1", stall: "Chinese", item: "Rice" }] }));
  run('var calls = []; api = async (url) => { calls.push(url); return { job: { id: "saved-job", status: "completed", items: [{ date: "2026-10-01", productId: "1", status: "done", message: "Ordered" }], placed: [{ date: "2026-10-01", productId: "1" }], failed: [] } }; }; refreshAccountData = async () => {};');
  await run("resumeOrderJob()");
  assert.equal(run("calls.length"), 1);
  assert.match(run("calls[0]"), /^\/api\/order\/job\?/);
  assert.equal(storage.has("soodering.activeOrderJob.test@example.com"), false);
  assert.equal(run("state.ordering"), false);
  assert.equal(run("cartStatus.textContent"), "Order queue completed.");
  assert.match(run("orderProgress.innerHTML"), /Ordered/);
});

test("queue progress reconnects after a temporary polling failure", async () => {
  const { run, storage } = browser();
  storage.set("soodering.activeOrderJob.test@example.com", "saved");
  run('var polls = 0; apiWithRelogin = async () => { if (++polls === 1) throw new Error("offline"); return { job: { id: "saved-job", status: "completed", items: [], placed: [], failed: [] } }; }; refreshAccountData = async () => {};');
  await run('monitorOrderJob({ id: "saved-job", status: "running", items: [], placed: [], failed: [] }, [], "Completed")');
  assert.equal(run("polls"), 2);
  assert.equal(run("state.ordering"), false);
  assert.equal(storage.has("soodering.activeOrderJob.test@example.com"), false);
});

test("a saved queue for another account is not restored", async () => {
  const { run, storage } = browser();
  storage.set("soodering.activeOrderJob.other@example.com", JSON.stringify({ id: "other-job" }));
  run('api = async () => { throw new Error("Should not request another account queue"); };');
  await run("resumeOrderJob()");
  assert.equal(storage.has("soodering.activeOrderJob.other@example.com"), true);
  assert.equal(run("state.ordering"), false);
});

test("expired saved queue is cleared and the user is told to check orders", async () => {
  const { run, storage } = browser();
  storage.set("soodering.activeOrderJob.test@example.com", JSON.stringify({ id: "expired-job" }));
  run('api = async () => { const error = new Error("Order job was not found."); error.status = 404; throw error; };');
  await run("resumeOrderJob()");
  assert.equal(storage.has("soodering.activeOrderJob.test@example.com"), false);
  assert.equal(run("state.ordering"), false);
  assert.match(run("cartStatus.textContent"), /Check your orders before submitting again/);
});
