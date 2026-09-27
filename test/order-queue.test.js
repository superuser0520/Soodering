const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

test("25-date queue recovers temporary failures and lost checkout responses without duplicates", { timeout: 30000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "soodering-queue-"));
  let cartDate = "";
  let allowFunds = false;
  const orderedDates = [];
  const addCounts = new Map();
  const checkoutCounts = new Map();
  const cafeteria = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    let body = "";
    for await (const chunk of request) body += chunk;
    const fields = new URLSearchParams(body);
    if (url.pathname.startsWith("/orders/")) {
      response.end(`<table><tbody>${orderedDates.map((date, i) => {
        const delivery = `October ${Number(date.slice(-2))}, 2026`;
        return `<tr><td>#${i + 1}</td><td>Today</td><td>${delivery}</td><td>Chicken</td><td>Processing</td><td>$5</td></tr>`;
      }).join("")}</tbody></table>`);
    } else if (url.pathname === "/cart/") {
      if (url.searchParams.has("remove_item")) cartDate = "";
      response.end(cartDate ? '<table><tr class="cart_item"><td class="product-name">Chicken</td><td><a href="/cart/?remove_item=1">Remove</a></td></tr></table>' : "Cart is currently empty");
    } else if (url.pathname === "/lunch/" && request.method === "POST") {
      const date = fields.get("deli_date");
      const count = (addCounts.get(date) || 0) + 1;
      addCounts.set(date, count);
      if (date === "2026-10-05" && count === 1) { response.writeHead(503); response.end("Temporary failure"); }
      else { cartDate = date; response.end("Added"); }
    } else if (url.pathname === "/checkout/") {
      response.end(`<table><tr class="cart_item"><td>Chicken</td><td>$5</td></tr></table><select name="exwfood_date_deli"><option value="${cartDate}" selected>${cartDate}</option></select>`);
    } else if (url.searchParams.get("wc-ajax") === "checkout") {
      const date = fields.get("exwfood_date_deli");
      const count = (checkoutCounts.get(date) || 0) + 1;
      checkoutCounts.set(date, count);
      if (date === "2026-10-09" && count === 1) {
        response.end(JSON.stringify({ result: "failure", messages: "Session expired. Please try again." }));
      } else if (date === "2026-10-10" && !allowFunds) {
        response.end(JSON.stringify({ result: "failure", messages: "Insufficient wallet balance" }));
      } else {
        orderedDates.push(date);
        if (date === "2026-10-12") response.destroy();
        else response.end(JSON.stringify({ result: "success", redirect: "/order-received/123" }));
      }
    } else response.end('<p>Hello <strong>Queue test</strong></p><p class="woo-wallet-price">$100</p>');
  });
  cafeteria.listen(0, "127.0.0.1");
  await once(cafeteria, "listening");
  let child;
  try {
    child = spawn(process.execPath, ["-e", 'const {server}=require("./server");server.listen(0,"127.0.0.1",()=>console.log(server.address().port));'], {
      cwd: path.resolve(__dirname, ".."), env: { ...process.env, SOODEERING_DATA_DIR: dataDir, CAFETERIA_ORIGIN: `http://127.0.0.1:${cafeteria.address().port}` }, stdio: ["ignore", "pipe", "pipe"]
    });
    const port = await new Promise((resolve, reject) => {
      child.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim())));
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`Server exited ${code}`)));
    });
    const origin = `http://127.0.0.1:${port}`;
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "queue@example.com", password: "test" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    const api = async (pathname, body) => {
      const response = await fetch(origin + pathname, { headers: { cookie, "content-type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
      assert.ok(response.ok, await response.clone().text());
      return response.json();
    };
    const poll = async (job) => {
      while (["queued", "running"].includes(job.status)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        job = (await api(`/api/order/job?id=${job.id}`)).job;
      }
      return job;
    };
    const selections = Array.from({ length: 25 }, (_, index) => ({ productId: "123", date: `2026-10-${String(index + 1).padStart(2, "0")}` }));
    const body = { selections, timeSlot: "11:30 - 11:55", idempotencyKey: "queue-test-first-operation" };
    const job = await poll((await api("/api/order/queue", body)).job);
    assert.equal(job.status, "partial");
    assert.equal(job.placed.length, 24);
    assert.equal(job.failed.length, 1);
    assert.equal(job.failed[0].date, "2026-10-10");
    assert.equal(addCounts.get("2026-10-05"), 2);
    assert.equal(checkoutCounts.get("2026-10-09"), 2);
    assert.equal(checkoutCounts.get("2026-10-12"), 1);
    assert.equal(new Set(orderedDates).size, orderedDates.length);
    assert.equal((await api("/api/order/queue", body)).job.id, job.id);
    allowFunds = true;
    const retried = await poll((await api("/api/order/queue", { ...body, selections: [selections[9]], idempotencyKey: "queue-test-second-operation" })).job);
    assert.notEqual(retried.id, job.id);
    assert.equal(retried.status, "completed");
    assert.equal(orderedDates.length, 25);
    assert.equal(new Set(orderedDates).size, 25);
  } finally {
    if (child) { const exited = once(child, "exit"); child.kill(); await exited; }
    await new Promise((resolve) => cafeteria.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
