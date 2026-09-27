const test = require("node:test");
const assert = require("node:assert/strict");
const { submitQueuedSelection, placeOrder } = require("../server");

function fixture(overrides = {}) {
  const calls = { access: 0, read: 0, clear: 0, add: 0, checkout: 0, waits: [] };
  const dependencies = {
    access: async () => { calls.access++; },
    readOrders: async () => { calls.read++; return []; },
    clear: async () => { calls.clear++; },
    add: async () => { calls.add++; },
    checkout: async () => { calls.checkout++; return { result: "success" }; },
    wait: async (ms) => { calls.waits.push(ms); },
    uncertainDates: new Set(),
    readPending: async () => false,
    recordPending: async () => {},
    clearPending: async () => {},
    ...overrides
  };
  const item = {};
  return { calls, dependencies, item, run: () => submitQueuedSelection({ account: { username: "person@example.com" } }, { date: "2026-10-01", productId: "123" }, {}, item, dependencies) };
}

test("temporary preparation failure retries after checking orders and succeeds", async () => {
  let adds = 0;
  const f = fixture({ add: async () => { if (++adds === 1) throw new Error("fetch failed"); } });
  assert.equal((await f.run()).result, "success");
  assert.equal(f.calls.read, 2);
  assert.equal(f.calls.checkout, 1);
  assert.equal(f.item.attempts, 2);
  assert.deepEqual(f.calls.waits, [1000]);
});

test("explicit transient checkout rejection retries at most three times", async () => {
  let submits = 0;
  const f = fixture({ checkout: async () => {
    submits++;
    throw Object.assign(new Error("Session expired, please try again"), { checkoutRejected: true });
  } });
  await assert.rejects(f.run(), /Session expired/);
  assert.equal(submits, 3);
  assert.equal(f.calls.read, 3);
  assert.deepEqual(f.calls.waits, [1000, 2000]);
});

test("an existing active date is confirmed without another checkout", async () => {
  const f = fixture({ readOrders: async () => [{ deliveryDate: "2026-10-01", status: "Processing", viewUrl: "/view-order/123" }] });
  assert.equal((await f.run()).alreadyOrdered, true);
  assert.equal(f.calls.checkout, 0);
  assert.equal(f.calls.clear, 0);
});

test("a cancelled order does not prevent a new order", async () => {
  const f = fixture({ readOrders: async () => [{ deliveryDate: "2026-10-01", status: "Cancelled" }] });
  assert.equal((await f.run()).result, "success");
  assert.equal(f.calls.checkout, 1);
});

test("lost checkout response is reconciled without resubmitting", async () => {
  let reads = 0;
  let submits = 0;
  const f = fixture({
    readOrders: async () => ++reads === 1 ? [] : [{ deliveryDate: "2026-10-01", status: "Processing" }],
    checkout: async () => { submits++; throw Object.assign(new Error("fetch failed"), { orderOutcomeUnknown: true }); }
  });
  assert.equal((await f.run()).alreadyOrdered, true);
  assert.equal(submits, 1);
  assert.equal(f.dependencies.uncertainDates.size, 0);
});

test("unconfirmed checkout is held for review even on a deliberate retry", async () => {
  let submits = 0;
  const f = fixture({ checkout: async () => {
    submits++;
    throw Object.assign(new Error("Timeout"), { orderOutcomeUnknown: true });
  } });
  await assert.rejects(f.run(), { needsReview: true });
  assert.equal(f.calls.read, 3);
  await assert.rejects(f.run(), { needsReview: true });
  assert.equal(submits, 1);
});

test("permanent errors, access restrictions, and incomplete verification are not retried", async () => {
  const permanent = fixture({ checkout: async () => { throw Object.assign(new Error("Insufficient wallet balance"), { checkoutRejected: true }); } });
  await assert.rejects(permanent.run(), /Insufficient/);
  assert.deepEqual(permanent.calls.waits, []);
  const restricted = fixture({ access: async () => { throw Object.assign(new Error("Request access usage from the admin."), { status: 403 }); } });
  await assert.rejects(restricted.run(), { status: 403 });
  assert.equal(restricted.calls.checkout, 0);
  const incomplete = fixture({ readOrders: async () => { throw new Error("Some pages failed"); } });
  await assert.rejects(incomplete.run(), /No new checkout was submitted/);
  assert.equal(incomplete.calls.checkout, 0);
});

test("a pending checkout from a previous process is checked but never blindly resubmitted", async () => {
  const pending = fixture({ readPending: async () => true });
  await assert.rejects(pending.run(), { needsReview: true });
  assert.equal(pending.calls.checkout, 0);
  let cleared = false;
  const confirmed = fixture({
    readPending: async () => true,
    readOrders: async () => [{ deliveryDate: "2026-10-01", status: "Processing" }],
    clearPending: async () => { cleared = true; }
  });
  assert.equal((await confirmed.run()).alreadyOrdered, true);
  assert.equal(confirmed.calls.checkout, 0);
  assert.equal(cleared, true);
});

test("confirmed checkout remains successful when loading orders fails afterward", async () => {
  let checkouts = 0;
  const session = {
    account: { username: "person@example.com" },
    request: async (url) => {
      if (url === "/checkout/") return new Response('<table><tr class="cart_item"><td>Chicken</td><td>$5</td></tr></table>');
      if (url === "/?wc-ajax=checkout") { checkouts++; return new Response(JSON.stringify({ result: "success", redirect: "/order-received/123" })); }
      throw new Error("Order list unavailable");
    }
  };
  const result = await placeOrder(session, { timeSlot: "11:30 - 11:55" });
  assert.equal(result.result, "success");
  assert.equal(result.redirect, "/order-received/123");
  assert.equal(result.orders, null);
  assert.match(result.ordersRefreshError, /Order submitted/);
  assert.equal(checkouts, 1);
});
