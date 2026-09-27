const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

test("admin restrictions persist across restart and enforce all order routes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "soodering-restrictions-"));
  const cafeteria = http.createServer((req, res) => {
    res.end('<p>Hello <strong>Test user</strong></p><p class="woo-wallet-price">$100</p>');
  });
  cafeteria.listen(0, "127.0.0.1");
  await once(cafeteria, "listening");
  let child;
  let origin;
  async function start() {
    child = spawn(process.execPath, ["-e", 'const {server}=require("./server"); server.listen(0,"127.0.0.1",()=>console.log(server.address().port));'], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, SOODEERING_DATA_DIR: dataDir, USAGE_ADMIN_EMAIL: "admin@example.com", CAFETERIA_ORIGIN: `http://127.0.0.1:${cafeteria.address().port}` },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const port = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/^(\d+)\r?\n/m);
        if (match) resolve(match[1]);
      });
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`Test server exited: ${code}`)));
    });
    origin = `http://127.0.0.1:${port}`;
  }
  async function stop() {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    child = null;
  }
  async function api(route, cookie = "", body) {
    const response = await fetch(origin + route, {
      headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) })
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0], cookies: response.headers.getSetCookie() };
  }
  async function login(username) {
    const result = await api("/api/login", "", { username, password: "fake-test-password" });
    assert.equal(result.status, 200);
    return result.cookie;
  }
  try {
    await start();
    assert.equal((await api("/api/admin/order-restrictions")).status, 401);
    let admin = await login("admin@example.com");
    let user = await login("Rowena.Tan@example.com");
    assert.equal((await api("/api/admin/order-restrictions", user)).status, 403);
    assert.equal((await api("/api/admin/order-restrictions", user, { action: "add", match: "someone" })).status, 403);
    const saved = await api("/api/admin/order-restrictions", admin, { action: "add", match: " ROWENA " });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.matches, ["rowena"]);
    const remembered = await api("/api/login", "", { username: "Rowena.Tan@example.com", password: "fake-test-password", autoLogin: true });
    assert.equal(remembered.data.autoLoginWarning, "");
    const autoCookie = remembered.cookies.findLast((cookie) => /^soodering_auto_login=[a-f0-9]{64};/.test(cookie));
    assert.match(autoCookie, /HttpOnly/);
    const autoToken = autoCookie.split(";")[0];
    const { readdir } = require("node:fs/promises");
    for (const file of (await readdir(path.join(dataDir, "auto-login"))).filter((file) => file.endsWith(".json"))) {
      const stored = await readFile(path.join(dataDir, "auto-login", file), "utf8");
      assert.ok(!stored.includes("fake-test-password"));
      assert.ok(!stored.includes("Rowena"));
    }
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "order-restrictions.json"), "utf8")).matches, ["rowena"]);
    for (const route of ["/api/cart/add", "/api/order/place", "/api/order/bulk", "/api/order/queue"]) {
      const blocked = await api(route, user, {});
      assert.equal(blocked.status, 403, route);
      assert.equal(blocked.data.error, "Request access usage from the admin.");
    }
    await Promise.all([
      api("/api/admin/order-restrictions", admin, { action: "add", match: "alice" }),
      api("/api/admin/order-restrictions", admin, { action: "add", match: "bob" })
    ]);
    assert.deepEqual((await api("/api/admin/order-restrictions", admin)).data.matches.sort(), ["alice", "bob", "rowena"]);
    await stop();
    await start();
    const autoRestored = await api("/api/session", autoToken);
    assert.equal(autoRestored.data.account.username, "Rowena.Tan@example.com");
    assert.equal((await api("/api/order/queue", `${autoToken}; ${autoRestored.cookie}`, {})).status, 403);
    await api("/api/logout", `${autoToken}; ${autoRestored.cookie}`, { keepAutoLogin: true });
    assert.equal((await api("/api/session", autoToken)).data.account.username, "Rowena.Tan@example.com");
    await api("/api/logout", autoToken, {});
    assert.equal((await api("/api/session", autoToken)).data.account, null);
    const noRemember = await api("/api/login", "", { username: "someone@example.com", password: "test", autoLogin: false });
    assert.ok(noRemember.cookies.some((cookie) => cookie.includes("soodering_auto_login=;") && cookie.includes("Max-Age=0")));
    admin = await login("admin@example.com");
    user = await login("Rowena.Tan@example.com");
    assert.deepEqual((await api("/api/admin/order-restrictions", admin)).data.matches.sort(), ["alice", "bob", "rowena"]);
    assert.equal((await api("/api/order/queue", user, {})).status, 403);
    assert.equal((await api("/api/admin/order-restrictions", admin, { action: "remove", match: "ROWENA" })).status, 200);
    const restored = await api("/api/order/queue", user, {});
    assert.notEqual(restored.status, 403);
    assert.equal(restored.data.error, "Please select at least one meal.");
    assert.equal((await api("/api/admin/order-restrictions", admin, { action: "add", match: "@" })).status, 200);
    assert.notEqual((await api("/api/order/queue", admin, {})).status, 403);
  } finally {
    if (child) await stop();
    await new Promise((resolve) => cafeteria.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
