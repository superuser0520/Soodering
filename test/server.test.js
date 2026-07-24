const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeHtml,
  createSiteSession,
  filterHiddenMenuItems,
  isSessionExpired,
  parseDates,
  parseAccount,
  parseOrderDeliveryDate,
  parseOrders,
  parseProducts,
  runIdempotentOperation,
  splitStall,
  usageUser
} = require("../server");

test("usage logs prefer the cafeteria display name", () => {
  assert.equal(usageUser({
    account: { name: "Soo Lih Jing", username: "soolihjing@shimano.com.sg" },
    credentials: { username: "fallback@shimano.com.sg" }
  }), "Soo Lih Jing");
  assert.equal(usageUser({
    account: { username: "fallback@shimano.com.sg" }
  }), "fallback@shimano.com.sg");
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
