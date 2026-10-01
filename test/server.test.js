const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeOrderRestrictions,
  isOrderRestricted,
  decodeHtml,
  createSiteSession,
  placeOrder,
  buildMenuDateRange,
  extendedMenuEntryCacheMs,
  filterHiddenMenuItems,
  isSessionExpired,
  parseDates,
  parseAccount,
  parseOrderDeliveryDate,
  parseOrders,
  parseProducts,
  mapWithConcurrency,
  menuPageOffersDate,
  mergeMenuDays,
  normalizeLoginLogEntry,
  runIdempotentOperation,
  splitStall,
  usageUser
} = require("../server");

test("order restrictions match email fragments without case sensitivity and exempt the admin", () => {
  const matches = normalizeOrderRestrictions([" Rowena ", "ROWENA", "other@example.com"]);
  assert.deepEqual(matches, ["rowena", "other@example.com"]);
  assert.equal(isOrderRestricted("Rowena.Tan@example.com", matches), true);
  assert.equal(isOrderRestricted("anotherrowena@example.com", matches), true);
  assert.equal(isOrderRestricted("someone@example.com", matches), false);
  assert.equal(isOrderRestricted("rowena@example.com", []), false);
  const { config } = require("../config");
  assert.equal(isOrderRestricted(config.usageAdminEmail, ["@"]), false);
});

test("order restrictions reject invalid rules and allow clearing all restrictions", () => {
  assert.deepEqual(normalizeOrderRestrictions([]), []);
  for (const matches of [null, "rowena", [" "], [123], ["x".repeat(101)]]) {
    assert.throws(() => normalizeOrderRestrictions(matches), { status: 400 });
  }
});

test("successful checkout stays successful when order history is unavailable", async () => {
  const session = createSiteSession();
  session.account = { username: "test@example.com" };
  session.request = async (pathname) => {
    if (pathname === "/checkout/") return new Response('<tr class="cart_item"><td>Chicken Rice</td><td>$4.50</td></tr>');
    if (pathname === "/?wc-ajax=checkout") return Response.json({ result: "success", redirect: "/confirmed/" });
    throw new Error("Order history is unavailable");
  };
  const result = await placeOrder(session, {});
  assert.equal(result.result, "success");
  assert.equal(result.redirect, "/confirmed/");
  assert.equal(result.orders, null);
  assert.match(result.ordersRefreshError, /Order submitted/);
});

test("queue checkout does not fetch history after a successful payment", async () => {
  const session = createSiteSession();
  session.account = { username: "test@example.com" };
  const requests = [];
  session.request = async (pathname) => {
    requests.push(pathname);
    if (pathname === "/checkout/") return new Response('<tr class="cart_item"><td>Chicken Rice</td><td>$4.50</td></tr>');
    return Response.json({ result: "success" });
  };
  assert.equal((await placeOrder(session, { includeOrders: false })).result, "success");
  assert.deepEqual(requests, ["/checkout/", "/?wc-ajax=checkout"]);
});

test("usage logs prefer the cafeteria display name", () => {
  assert.equal(usageUser({
    account: { name: "Soo Lih Jing", username: "soolihjing@shimano.com.sg" },
    credentials: { username: "fallback@shimano.com.sg" }
  }), "Soo Lih Jing");
  assert.equal(usageUser({
    account: { username: "fallback@shimano.com.sg" }
  }), "fallback@shimano.com.sg");
});

test("usage logs retain successful logins only", () => {
  assert.deepEqual(normalizeLoginLogEntry({
    at: "2026-08-02T10:00:00.000Z",
    action: "login.success",
    user: "Rowena Tan",
    balance: "$42.00",
    session: "legacy"
  }), {
    at: "2026-08-02T10:00:00.000Z",
    user: "Rowena Tan",
    balance: "$42.00"
  });
  assert.equal(normalizeLoginLogEntry({ action: "wallet.view", user: "Rowena Tan" }), null);
  assert.equal(normalizeLoginLogEntry({ action: "orders.view", user: "Rowena Tan" }), null);
});

test("account parsing prioritizes the Hello display name", () => {
  const account = parseAccount(`
    <strong>Wallet balance</strong>
    <div class="woocommerce-MyAccount-content">
      <p>Hello <strong>Rowena Tan</strong></p>
      <em>#12345</em>
    </div>
  `);
  assert.deepEqual(account, { name: "Rowena Tan", staffId: "12345" });
});

test("decodes cafeteria HTML and preserves correct Unicode", () => {
  assert.equal(decodeHtml("Fish &amp; Chips &ndash; Set"), "Fish & Chips - Set");
  assert.deepEqual(splitStall("Chinese Stall – Chicken Rice"), {
    stall: "Chinese Stall",
    item: "Chicken Rice"
  });
});

test("parses dates and products from representative cafeteria markup", () => {
  const dates = parseDates('<option data-date="2026-07-23">Thu 23 Jul</option>');
  assert.equal(dates[0].date, "2026-07-23");

  const products = parseProducts(`
    <div class="item-grid food-menu">
      <h3><a href="https://ssip-cafeteria.whew.life/product/chicken/">Chinese Stall – Chicken Rice</a></h3>
      <span class="woocommerce-Price-currencySymbol">$</span> 4.50
      <div data-id_food="123"></div>
      <div class="exwf-shdes"><p>Roasted chicken</p></div>
      <p class="stock in-stock">Available</p>
    </div>
  `, "2026-07-23");
  assert.equal(products.length, 1);
  assert.equal(products[0].id, "123");
  assert.equal(products[0].stall, "Chinese Stall");
  assert.equal(products[0].item, "Chicken Rice");
  assert.equal(products[0].price, "$4.50");
});

test("discovers exact direct-date menus beyond the dropdown", () => {
  const range = buildMenuDateRange("2026-07-27", 1);
  assert.equal(range[0].date, "2026-07-27");
  assert.equal(range.at(-1).date, "2026-08-31");
  assert.match(range.find((day) => day.date === "2026-08-12").url, /menu-date=2026-08-12$/);

  const exactPage = "<input type='hidden' name='deli_date' value='2026-08-12'>";
  assert.equal(menuPageOffersDate(exactPage, "2026-08-12"), true);
  assert.equal(menuPageOffersDate(exactPage, "2026-08-13"), false);
});

test("rechecks unpublished future menus sooner than published menus", () => {
  assert.equal(extendedMenuEntryCacheMs({ day: null }), 5 * 60 * 1000);
  assert.equal(
    extendedMenuEntryCacheMs({ day: { products: [{ item: "Fish and Chips" }] } }),
    6 * 60 * 60 * 1000
  );
});

test("merges menu dates in order and prefers fresher official data", () => {
  const extended = [
    { date: "2026-08-12", products: [{ item: "Extended" }] },
    { date: "2026-08-07", products: [{ item: "Old" }] }
  ];
  const official = [{ date: "2026-08-07", products: [{ item: "Fresh" }] }];
  const merged = mergeMenuDays(extended, official);
  assert.deepEqual(merged.map((day) => day.date), ["2026-08-07", "2026-08-12"]);
  assert.equal(merged[0].products[0].item, "Fresh");
});

test("limits concurrent menu date requests", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.value), [2, 4, 6, 8, 10]);
});

test("parses order dates and order rows", () => {
  assert.equal(parseOrderDeliveryDate("Thursday, July 23, 2026 11:30"), "2026-07-23");
  const orders = parseOrders(`
    <table><tbody><tr>
      <td>#101</td><td>22 Jul</td><td>July 23, 2026</td>
      <td>Chicken Rice</td><td>Processing</td><td>$4.50</td>
    </tr></tbody></table>
  `);
  assert.equal(orders[0].order, "#101");
  assert.equal(orders[0].product, "Chicken Rice");
});

test("deduplicates concurrent and repeated order operations", async () => {
  const operations = new Map();
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { result: "success" };
  };
  const [first, second] = await Promise.all([
    runIdempotentOperation(operations, "order-1234567890", operation),
    runIdempotentOperation(operations, "order-1234567890", operation)
  ]);
  const third = await runIdempotentOperation(operations, "order-1234567890", operation);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

test("permits a failed order operation to be retried", async () => {
  const operations = new Map();
  await assert.rejects(runIdempotentOperation(operations, "order-failure-123", async () => {
    throw new Error("temporary failure");
  }));
  assert.equal(operations.size, 0);
});

test("expires inactive sessions and rejects off-origin cafeteria requests", async () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ touchedAt: now }, now), false);
  assert.equal(isSessionExpired({ touchedAt: now - 31 * 60 * 1000 }, now), true);
  const session = createSiteSession();
  await assert.rejects(
    session.request("https://ssip-cafeteria.whew.life.attacker.example/cancel_order=1"),
    /configured origin/
  );
});

test("removes configured irrelevant meals from menu data", () => {
  const filtered = filterHiddenMenuItems({
    days: [{ date: "2026-07-23", products: [
      { item: "Vegetarian Set" },
      { item: "Economic Rice Set" },
      { item: "Nasi Padang Set" },
      { item: "Chicken Rice" }
    ] }],
    totalProducts: 4
  });
  assert.deepEqual(filtered.days[0].products.map((product) => product.item), ["Chicken Rice"]);
  assert.equal(filtered.totalProducts, 1);
});
