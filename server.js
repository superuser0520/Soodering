const http = require("node:http");
const crypto = require("node:crypto");
const { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { config, publicConfig } = require("./config");

const PORT = config.port;
const SITE_ORIGIN = config.siteOrigin;
const LUNCH_URL = `${SITE_ORIGIN}/lunch/`;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USAGE_LOG = path.join(DATA_DIR, "usage.jsonl");
const ROWENA_SETTINGS_FILE = path.join(DATA_DIR, "rowena-settings.json");
const MENU_CACHE_FILE = path.join(DATA_DIR, "menu-cache.json");
const EXTENDED_MENU_CACHE_FILE = path.join(DATA_DIR, "extended-menu-cache.json");
const DEFAULT_TIME_SLOTS = config.defaultTimeSlots;
const MENU_CACHE_VERSION = 3;
const EXTENDED_MENU_CACHE_VERSION = 2;

let cachedMenus = null;
let cachedAt = 0;
const CACHE_MS = config.menuCacheMs;
const SESSION_COOKIE = "soodering_sid";
const SESSION_MAX_AGE_MS = config.sessionCookieMaxAgeMs;
const SESSION_IDLE_TIMEOUT_MS = config.sessionIdleTimeoutMs;
const USAGE_ADMIN_EMAIL = config.usageAdminEmail;
const sessions = new Map();
let menuLoadPromise = null;
let usageWriteChain = Promise.resolve();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function decodeHtml(value = "") {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    times: "x"
  };

  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, key) => named[key] || `&${key};`)
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]*>/g, " "));
}

function extractInput(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<input[^>]+name=["']${escaped}["'][^>]*>`, "i"));
  return match?.[0].match(/\bvalue=["']([^"']*)["']/i)?.[1] || "";
}

function extractSelectOptions(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...html.matchAll(new RegExp(`<select[^>]+name=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/select>`, "gi"))];
  const optionSets = matches.map((match) => [...match[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((option) => ({
    value: option[1].match(/\bvalue=["']([^"']*)["']/i)?.[1] || stripTags(option[2]),
    label: stripTags(option[2]),
    selected: /\bselected\b/i.test(option[1]),
    disabled: /\bdisabled\b/i.test(option[1])
  })));

  return optionSets.sort((a, b) => {
    const score = (options) => options.filter((option) => !/No time slot/i.test(option.label)).length;
    return score(b) - score(a);
  })[0] || [];
}

function parseMoney(text = "") {
  const normalized = stripTags(text).replace(/\$\s+/g, "$");
  return normalized.match(/\$[0-9,.]+/)?.[0] || "";
}

function normalizeStall(value) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .replace(/\bW\b/g, "w");
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      "user-agent": "Mozilla/5.0 Shimano Lunch Viewer",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function createSiteSession() {
  const cookies = new Map();

  function storeCookies(response) {
    const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  function cookieHeader() {
    return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async function request(pathname, options = {}) {
    const url = new URL(pathname, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) throw new Error("Cafeteria requests must remain on the configured origin.");
    const headers = {
      "user-agent": "Mozilla/5.0 Shimano Lunch Viewer",
      accept: "text/html,application/xhtml+xml,application/json",
      referer: SITE_ORIGIN,
      ...(options.headers || {})
    };
    const cookie = cookieHeader();
    if (cookie) headers.cookie = cookie;

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      ...options,
      headers
    });
    storeCookies(response);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (location) {
        const next = new URL(location, url);
        if (next.origin !== SITE_ORIGIN) throw new Error("Cafeteria redirected to an unexpected origin.");
        return request(next, { method: "GET", headers: { accept: headers.accept } });
      }
    }

    return response;
  }

  return {
    account: null,
    credentials: null,
    touchedAt: Date.now(),
    orderOperations: new Map(),
    cookies,
    request,
    reset({ clearCredentials = true } = {}) {
      cookies.clear();
      this.account = null;
      if (clearCredentials) this.credentials = null;
      this.touchedAt = Date.now();
      this.orderOperations.clear();
    }
  };
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((cookie) => {
    const separator = cookie.indexOf("=");
    if (separator < 0) return ["", ""];
    return [
      decodeURIComponent(cookie.slice(0, separator).trim()),
      decodeURIComponent(cookie.slice(separator + 1).trim())
    ];
  }).filter(([key]) => key));
}

function getRequestSession(request, response, { touch = true } = {}) {
  cleanupSessions();
  const cookies = parseCookies(request.headers.cookie || "");
  let id = cookies[SESSION_COOKIE];
  let session = id ? sessions.get(id) : null;

  if (!session) {
    id = crypto.randomUUID();
    session = createSiteSession();
    sessions.set(id, session);
    const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}${secure}`);
  }

  if (touch) session.touchedAt = Date.now();
  return session;
}

function usageUser(session) {
  const displayName = String(session.account?.name || "").trim();
  if (displayName) return displayName;
  return String(session.account?.username || session.credentials?.username || "").trim();
}

async function rotateUsageLogIfNeeded(nextBytes) {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const current = await stat(USAGE_LOG);
    if (current.size + nextBytes > config.usageLogMaxBytes) {
      const suffix = new Date().toISOString().replace(/[:.]/g, "-");
      await rename(USAGE_LOG, path.join(DATA_DIR, `usage-${suffix}.jsonl`));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const cutoff = Date.now() - config.usageLogRetentionDays * 24 * 60 * 60 * 1000;
  const files = await readdir(DATA_DIR, { withFileTypes: true });
  await Promise.all(files.filter((entry) => /^usage-.*\.jsonl$/.test(entry.name)).map(async (entry) => {
    const filePath = path.join(DATA_DIR, entry.name);
    const details = await stat(filePath);
    if (details.mtimeMs < cutoff) await unlink(filePath);
  }));
}

async function trackUsage(request, session, action, details = {}) {
  if (action !== "login.success") return;

  const entry = {
    at: new Date().toISOString(),
    user: usageUser(session),
    balance: String(details.balance || "-").trim()
  };
  try {
    const line = `${JSON.stringify(entry)}\n`;
    usageWriteChain = usageWriteChain.then(async () => {
      await rotateUsageLogIfNeeded(Buffer.byteLength(line));
      await appendFile(USAGE_LOG, line);
    });
    await usageWriteChain;
  } catch (error) {
    usageWriteChain = Promise.resolve();
    console.warn(`Usage log failed: ${error.message}`);
  }
}

async function readUsageLog(limit = 100) {
  try {
    const files = (await readdir(DATA_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && (entry.name === "usage.jsonl" || /^usage-.*\.jsonl$/.test(entry.name)))
      .map((entry) => entry.name)
      .sort().reverse();
    const entries = [];
    for (const file of files) {
      const body = await readFile(path.join(DATA_DIR, file), "utf8");
      for (const line of body.trim().split("\n").filter(Boolean).reverse()) {
        try {
          const entry = JSON.parse(line);
          if (entry.action === "login.success" || (!entry.action && entry.user && entry.balance)) {
            entries.push({ at: entry.at, user: entry.user, balance: entry.balance || "-" });
          }
        } catch {
          // Ignore one malformed record instead of hiding the entire usage log.
        }
        if (entries.length >= limit) return entries;
      }
    }
    return entries;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function assertUsageAdmin(session) {
  assertLoggedIn(session);
  if ((session.account?.username || "").toLowerCase() !== USAGE_ADMIN_EMAIL) {
    const error = new Error("Usage log is only available to the owner account.");
    error.status = 403;
    throw error;
  }
}

const DEFAULT_NOTIFICATION_RULES = [{
  id: "rowena",
  match: "rowena",
  title: "Lunch reminder",
  message: "Dont eat so much yoghurt, eat proper food"
}];

function normalizeNotificationRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.slice(0, 100).map((rule) => ({
    id: String(rule.id || crypto.randomUUID()).slice(0, 80),
    match: String(rule.match || "").trim().toLowerCase().slice(0, 100),
    title: String(rule.title || "").trim().slice(0, 80),
    message: String(rule.message || "").trim().slice(0, 500)
  })).filter((rule) => rule.match && rule.title && rule.message);
}

async function readNotificationRules() {
  try {
    const saved = JSON.parse(await readFile(ROWENA_SETTINGS_FILE, "utf8"));
    if (Array.isArray(saved.rules)) return normalizeNotificationRules(saved.rules);
    // Migrate the original single Rowena notification format.
    return normalizeNotificationRules([{
      ...DEFAULT_NOTIFICATION_RULES[0],
      title: saved.title,
      message: saved.message
    }]);
  } catch (error) {
    if (error.code === "ENOENT") return DEFAULT_NOTIFICATION_RULES.map((rule) => ({ ...rule }));
    throw error;
  }
}

async function saveNotificationRules(body) {
  const rules = normalizeNotificationRules(body.rules);
  if (!Array.isArray(body.rules) || rules.length !== body.rules.length) {
    const error = new Error("Every rule needs a name match, title, and message.");
    error.status = 400;
    throw error;
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ROWENA_SETTINGS_FILE, JSON.stringify({ rules }, null, 2), "utf8");
  return rules;
}

function matchingNotification(account, rules) {
  const username = String(account?.username || "").toLowerCase();
  return rules.find((rule) => username.includes(rule.match)) || null;
}

function serializeAccount(session) {
  if (!session.account) return null;
  return {
    ...session.account,
    canViewUsage: session.account.username.toLowerCase() === USAGE_ADMIN_EMAIL
  };
}

function cleanupSessions() {
  for (const [id, session] of sessions.entries()) {
    if (isSessionExpired(session)) sessions.delete(id);
  }
}

function isSessionExpired(session, now = Date.now()) {
  return (session.touchedAt || 0) < now - SESSION_IDLE_TIMEOUT_MS;
}

function assertLoggedIn(session) {
  if (!session.account) {
    const error = new Error("Please log in to the cafeteria account first.");
    error.status = 401;
    throw error;
  }
}

async function ensureLoggedIn(session) {
  if (session.account) return;
  if (session.credentials?.username && session.credentials?.password) {
    await loginToSite(session, session.credentials.username, session.credentials.password);
    return;
  }
  assertLoggedIn(session);
}

async function readSitePage(session, pathname) {
  const response = await session.request(pathname);
  if (!response.ok) throw new Error(`Cafeteria page failed: ${response.status}`);
  return response.text();
}

function looksLoggedOut(html) {
  return /woocommerce-form-login|name=["']username["']|name=["']password["']/i.test(html)
    && !/customer-logout|woocommerce-MyAccount-navigation|Hello\s*<strong>/i.test(html);
}

async function readProtectedPage(session, pathname) {
  await ensureLoggedIn(session);
  let html = await readSitePage(session, pathname);
  if (looksLoggedOut(html) && session.credentials?.username && session.credentials?.password) {
    session.reset({ clearCredentials: false });
    await loginToSite(session, session.credentials.username, session.credentials.password);
    html = await readSitePage(session, pathname);
  }
  return html;
}

function parseAccount(html) {
  const name = html.match(/Hello\s*<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1]
    || html.match(/woocommerce-MyAccount-content[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1]
    || "";
  const staffId = html.match(/<em>#([^<]+)<\/em>/i)?.[1] || "";
  return {
    name: stripTags(name),
    staffId: stripTags(staffId)
  };
}

async function loginToSite(session, username, password) {
  session.reset({ clearCredentials: false });
  const loginHtml = await readSitePage(session, "/");
  const body = new URLSearchParams({
    username,
    password,
    rememberme: "forever",
    login: "Log in",
    "woocommerce-login-nonce": extractInput(loginHtml, "woocommerce-login-nonce"),
    _wp_http_referer: extractInput(loginHtml, "_wp_http_referer") || "/"
  });

  const response = await session.request("/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const html = await response.text();

  if (/woocommerce-error|Login|Username or email address/i.test(html) && !/customer-logout|Account pages|Hello/i.test(html)) {
    throw new Error("Login failed. Please check the cafeteria username and password.");
  }

  const account = parseAccount(html);
  session.account = {
    username,
    name: account.name || username,
    staffId: account.staffId
  };
  session.credentials = { username, password };
  return session.account;
}

function parseWallet(html) {
  const balanceSection = html.match(/woo-wallet-price[^>]*>([\s\S]*?)(?:<\/p>|<\/div>|<ul|Source)/i)?.[1]
    || html.match(/Balance\s*(?:&#36;|\$)\s*([0-9,.]+)/i)?.[0]
    || "";
  const list = html.match(/woo-wallet-transactions-items[\s\S]*?<\/ul>/i)?.[0] || "";
  const transactions = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .slice(0, 20)
    .map((match) => ({
      source: stripTags(match[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""),
      date: stripTags(match[1].match(/<small[^>]*>([\s\S]*?)<\/small>/i)?.[1] || ""),
      direction: /transaction-type-credit/i.test(match[1]) ? "+" : "-",
      amount: parseMoney(match[1])
    }));

  return {
    balance: parseMoney(balanceSection),
    transactions
  };
}

function parseOrderDeliveryDate(delivery = "") {
  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
  };
  const match = delivery.match(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
  if (!match) return "";
  const parts = match[0].match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  if (!parts) return "";
  return `${parts[3]}-${months[parts[1].toLowerCase()]}-${parts[2].padStart(2, "0")}`;
}

function parseOrders(html) {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || "";
  return [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, 30).map((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => stripTags(cell[1]));
    const viewUrl = decodeHtml(rowMatch[1].match(/href=["']([^"']*view-order[^"']*)["']/i)?.[1] || "");
    const cancelUrl = decodeHtml(rowMatch[1].match(/href=["']([^"']*cancel_order[^"']*)["']/i)?.[1] || "");
    return {
      order: cells[0] || "",
      created: cells[1] || "",
      delivery: cells[2] || "",
      deliveryDate: parseOrderDeliveryDate(cells[2] || ""),
      product: cells[3] || "",
      status: cells[4] || "",
      total: cells[5] || "",
      viewUrl,
      cancelUrl
    };
  }).filter((order) => order.order);
}

function parseCart(html) {
  const rows = [...html.matchAll(/<tr[^>]*class=["'][^"']*cart_item[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => {
    const row = match[1];
    const product = stripTags(row.match(/class=["'][^"']*product-name[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "");
    const price = parseMoney(row.match(/class=["'][^"']*product-price[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "");
    const quantity = row.match(/\bname=["'][^"']*qty[^"']*["'][^>]*value=["']([^"']+)/i)?.[1] || "1";
    const subtotal = parseMoney(row.match(/class=["'][^"']*product-subtotal[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "");
    const removeUrl = decodeHtml(row.match(/href=["']([^"']*remove_item[^"']*)["']/i)?.[1] || "");
    return { product, price, quantity, subtotal, removeUrl };
  });

  return {
    empty: /cart is currently empty/i.test(html),
    items: rows,
    total: parseMoney(html.match(/order-total[\s\S]*?<\/tr>/i)?.[0] || html)
  };
}

function parseCheckout(html) {
  const summaryRows = [...html.matchAll(/<tr[^>]*class=["'][^"']*cart_item[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => stripTags(cell[1]));
    return {
      product: cells[0] || "",
      subtotal: cells[1] || ""
    };
  });
  let timeSlots = extractSelectOptions(html, "exwfood_time_deli").filter((option) => !option.disabled);
  if (timeSlots.length === 0 || timeSlots.every((option) => /No time slot/i.test(option.label))) {
    timeSlots = DEFAULT_TIME_SLOTS.map((slot, index) => ({
      value: slot,
      label: slot,
      selected: index === 0,
      disabled: false
    }));
  }
  const dateOptions = extractSelectOptions(html, "exwfood_date_deli").filter((option) => !option.disabled);
  const fields = {};

  for (const name of [
    "billing_first_name",
    "billing_last_name",
    "billing_phone",
    "billing_email",
    "payment_method",
    "woocommerce-process-checkout-nonce",
    "_wp_http_referer"
  ]) {
    fields[name] = extractInput(html, name);
  }

  fields.exwfood_date_deli = dateOptions.find((option) => option.selected)?.value || dateOptions[0]?.value || "";
  fields.exwfood_time_deli = timeSlots.find((option) => option.selected)?.value || timeSlots[0]?.value || "";
  fields.exwf_auto_limit = extractInput(html, "exwf_auto_limit");
  fields.exwf_dis_auto = extractInput(html, "exwf_dis_auto");

  return {
    empty: /cart is currently empty/i.test(html),
    items: summaryRows,
    total: parseMoney(html.match(/order-total[\s\S]*?<\/tr>/i)?.[0] || html),
    timeSlots,
    dateOptions,
    fields
  };
}

async function addToCart(session, { productId, date, quantity = 1 }) {
  await ensureLoggedIn(session);
  if (!productId || !date) throw new Error("Product and delivery date are required.");

  const body = new URLSearchParams({
    deli_date: date,
    quantity: String(quantity || 1),
    "add-to-cart": String(productId)
  });
  const response = await session.request(`/lunch/?menu-date=${encodeURIComponent(date)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  await response.text();
  return parseCart(await readProtectedPage(session, "/cart/"));
}

async function clearCart(session) {
  await ensureLoggedIn(session);
  let cart = parseCart(await readProtectedPage(session, "/cart/"));
  for (const item of cart.items) {
    if (item.removeUrl) await session.request(item.removeUrl);
  }
  cart = parseCart(await readProtectedPage(session, "/cart/"));
  return cart;
}

async function placeOrder(session, { timeSlot = "", notes = "" }) {
  await ensureLoggedIn(session);
  const checkoutHtml = await readProtectedPage(session, "/checkout/");
  const checkout = parseCheckout(checkoutHtml);
  if (checkout.empty || checkout.items.length === 0) throw new Error("Cart is empty.");

  const fields = checkout.fields;
  const selectedTime = timeSlot || fields.exwfood_time_deli;
  if (!selectedTime || /No time slot/i.test(selectedTime)) {
    throw new Error("No delivery time slot is available for this cart.");
  }

  const body = new URLSearchParams({
    billing_first_name: fields.billing_first_name,
    billing_last_name: fields.billing_last_name,
    billing_phone: fields.billing_phone,
    billing_email: fields.billing_email,
    exwf_auto_limit: fields.exwf_auto_limit,
    exwf_dis_auto: fields.exwf_dis_auto,
    exwfood_date_deli: fields.exwfood_date_deli,
    exwfood_time_deli: selectedTime,
    order_comments: notes,
    payment_method: fields.payment_method || "bacs",
    "woocommerce-process-checkout-nonce": fields["woocommerce-process-checkout-nonce"],
    _wp_http_referer: fields._wp_http_referer || "/?wc-ajax=update_order_review",
    woocommerce_checkout_place_order: "Place order"
  });

  const response = await session.request("/?wc-ajax=checkout", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json, text/javascript, */*; q=0.01"
    },
    body
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { result: response.ok ? "unknown" : "failure", messages: stripTags(text).slice(0, 500) };
  }

  if (payload.result !== "success") {
    throw new Error(stripTags(payload.messages || "Checkout failed."));
  }

  return {
    result: payload.result,
    redirect: payload.redirect || "",
    orders: await loadOrders(session)
  };
}

async function placeBulkOrder(session, { selections = [], timeSlot = "", notes = "" }) {
  await ensureLoggedIn(session);
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error("Please select at least one meal.");
  }

  if (selections.length > 20) throw new Error("A maximum of 20 meals can be ordered at once.");

  const results = [];
  try {
    for (const selection of selections) {
      if (!selection.productId || !/^\d{4}-\d{2}-\d{2}$/.test(selection.date || "")) {
        throw new Error("Every selection requires a valid product and delivery date.");
      }
      await clearCart(session);
      await addToCart(session, {
        productId: selection.productId,
        date: selection.date,
        quantity: selection.quantity || 1
      });
      const placed = await placeOrder(session, { timeSlot, notes });
      results.push({
        date: selection.date,
        productId: selection.productId,
        result: placed.result,
        redirect: placed.redirect
      });
    }

    return {
      result: "success",
      placed: results,
      orders: await loadOrders(session)
    };
  } finally {
    try {
      await clearCart(session);
    } catch {
      // Preserve the original checkout result; the next order also clears the cart first.
    }
  }
}

async function runIdempotentOperation(operations, key, operation) {
  if (operations.has(key)) return operations.get(key);
  const pending = Promise.resolve().then(operation);
  operations.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    operations.delete(key);
    throw error;
  }
}

async function placeIdempotentBulkOrder(session, body) {
  const key = String(body.idempotencyKey || "");
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) {
    const error = new Error("A valid order operation ID is required.");
    error.status = 400;
    throw error;
  }
  return runIdempotentOperation(session.orderOperations, key, () => placeBulkOrder(session, body));
}

async function cancelOrder(session, cancelUrl) {
  await ensureLoggedIn(session);
  let parsedUrl;
  try {
    parsedUrl = new URL(cancelUrl);
  } catch {
    parsedUrl = null;
  }
  if (!parsedUrl || parsedUrl.origin !== SITE_ORIGIN || !parsedUrl.searchParams.has("cancel_order")) {
    throw new Error("A valid cafeteria cancel link is required.");
  }

  const response = await session.request(parsedUrl);
  await response.text();
  return {
    orders: await loadOrders(session),
    cart: parseCart(await readProtectedPage(session, "/cart/"))
  };
}

async function loadOrders(session) {
  await ensureLoggedIn(session);
  const firstPage = parseOrders(await readProtectedPage(session, "/orders/"));
  const extraPages = await Promise.allSettled(
    Array.from({ length: 5 }, (_, index) => readProtectedPage(session, `/orders/${index + 2}`).then(parseOrders))
  );
  const pages = [firstPage, ...extraPages.filter((result) => result.status === "fulfilled").map((result) => result.value)];

  const seen = new Set();
  return pages.flat().filter((order) => {
    const key = `${order.order}|${order.deliveryDate}|${order.product}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDates(html) {
  const dates = [];
  const optionPattern = /<option\b[^>]*data-date=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let match;

  while ((match = optionPattern.exec(html))) {
    dates.push({
      date: match[1],
      label: stripTags(match[2]),
      url: `${SITE_ORIGIN}/lunch/?menu-date=${match[1]}`
    });
  }

  return dates;
}

function splitStall(title) {
  const separator = title.match(/[–-]/);
  if (!separator) return { stall: "Other", item: title };

  const stall = title.slice(0, separator.index).trim();
  const item = title.slice(separator.index + 1).trim();
  return {
    stall: stall ? normalizeStall(stall) : "Other",
    item: item || title
  };
}

function parseProducts(html, date) {
  const blocks = html
    .split(/<div class="item-grid\b/)
    .slice(1)
    .map((block) => `<div class="item-grid${block.split(/<div class="item-grid\b/)[0]}`);

  return blocks.map((block) => {
    const titleMatch = block.match(/<h3>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    const priceMatch = block.match(/woocommerce-Price-currencySymbol[^>]*>[^<]*<\/span>\s*([0-9.]+)/i);
    const imageMatch = block.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    const descMatch = block.match(/<div class="exwf-shdes">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/i);
    const stockMatch = block.match(/<p class="stock in-stock">([\s\S]*?)<\/p>/i);
    const idMatch = block.match(/data-id_food=["']([^"']+)["']/i) || block.match(/name=["']add-to-cart["']\s+value=["']([^"']+)["']/i);

    if (!titleMatch) return null;

    const title = stripTags(titleMatch[2]);
    const { stall, item } = splitStall(title);

    return {
      id: idMatch ? idMatch[1] : `${date}-${title}`,
      date,
      title,
      stall,
      item,
      price: priceMatch ? `$${priceMatch[1]}` : "",
      description: descMatch ? stripTags(descMatch[1]) : "",
      stock: stockMatch ? stripTags(stockMatch[1]) : "",
      productUrl: titleMatch[1],
      imageUrl: imageMatch ? imageMatch[1] : ""
    };
  }).filter(Boolean);
}

function menuPageOffersDate(html, date) {
  const inputs = html.match(/<input\b[^>]*>/gi) || [];
  return inputs.some((input) => {
    const name = input.match(/\bname=["']([^"']+)["']/i)?.[1] || "";
    const value = input.match(/\bvalue=["']([^"']+)["']/i)?.[1] || "";
    return name === "deli_date" && value === date;
  });
}

function addIsoDays(date, offset) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function menuDateLabel(date) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

function buildMenuDateRange(startDate, monthsAhead = 1) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth() + monthsAhead + 1,
    0
  ));
  const totalDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Array.from({ length: totalDays }, (_, index) => {
    const date = addIsoDays(startDate, index);
    return {
      date,
      label: menuDateLabel(date),
      url: `${SITE_ORIGIN}/lunch/?menu-date=${date}`
    };
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function fetchMenuDay(day, { attempts = 2 } = {}) {
  let lastError = null;
  let lastDay = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const html = await fetchHtml(day.url);
      const offersDate = menuPageOffersDate(html, day.date);
      lastDay = {
        ...day,
        orderUrl: day.url,
        products: offersDate ? parseProducts(html, day.date) : []
      };
      if (offersDate) return lastDay;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  if (lastDay) return lastDay;
  throw lastError || new Error(`Menu date ${day.date} could not be loaded.`);
}

async function readExtendedMenuCache() {
  try {
    const parsed = JSON.parse(await readFile(EXTENDED_MENU_CACHE_FILE, "utf8"));
    return parsed?.cacheVersion === EXTENDED_MENU_CACHE_VERSION
      && typeof parsed.dates === "object"
      ? parsed
      : { cacheVersion: EXTENDED_MENU_CACHE_VERSION, dates: {} };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return { cacheVersion: EXTENDED_MENU_CACHE_VERSION, dates: {} };
    }
    throw error;
  }
}

async function loadExtendedMenuDays(startDate, officialDates, now, { force = false } = {}) {
  const cache = await readExtendedMenuCache();
  const official = new Set(officialDates);
  const candidates = buildMenuDateRange(startDate, config.menuLookaheadMonths)
    .filter((day) => !official.has(day.date));
  const cachedDays = [];
  const staleDays = [];

  for (const day of candidates) {
    const entry = cache.dates[day.date];
    const fetchedAt = Date.parse(entry?.fetchedAt || "");
    const cacheDuration = extendedMenuEntryCacheMs(entry);
    if (!force && entry && Number.isFinite(fetchedAt) && now - fetchedAt < cacheDuration) {
      if (entry.day?.products?.length) cachedDays.push(entry.day);
    } else {
      staleDays.push(day);
    }
  }

  const settled = await mapWithConcurrency(
    staleDays,
    Math.min(config.menuFetchConcurrency, 3),
    fetchMenuDay
  );
  const fetchedDays = [];
  let failedDates = 0;
  settled.forEach((result, index) => {
    const date = staleDays[index].date;
    if (result.status === "fulfilled") {
      const day = result.value.products.length ? result.value : null;
      cache.dates[date] = { fetchedAt: new Date(now).toISOString(), day };
      if (day) fetchedDays.push(day);
    } else if (cache.dates[date]?.day?.products?.length) {
      failedDates += 1;
      fetchedDays.push(cache.dates[date].day);
    } else {
      failedDates += 1;
    }
  });

  const candidateSet = new Set(candidates.map((day) => day.date));
  cache.dates = Object.fromEntries(
    Object.entries(cache.dates).filter(([date]) => candidateSet.has(date))
  );
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(EXTENDED_MENU_CACHE_FILE, JSON.stringify(cache), "utf8");
  const days = [...cachedDays, ...fetchedDays];
  return {
    days,
    checked: candidates.length,
    found: days.length,
    failed: failedDates
  };
}

function mergeMenuDays(...groups) {
  const byDate = new Map();
  for (const day of groups.flat()) {
    if (day?.date) byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function extendedMenuEntryCacheMs(entry) {
  return entry?.day?.products?.length ? config.extendedMenuCacheMs : CACHE_MS;
}

async function loadMenus(force = false) {
  const now = Date.now();
  if (!force && cachedMenus) {
    if (now - cachedAt < CACHE_MS) return cachedMenus;
    refreshMenusInBackground();
    return { ...cachedMenus, refreshing: true };
  }
  if (menuLoadPromise) return menuLoadPromise;

  if (!force && !cachedMenus) {
    const persisted = await readPersistedMenus();
    if (persisted) {
      cachedMenus = persisted;
      cachedAt = Date.parse(persisted.fetchedAt) || 0;
      if (now - cachedAt >= CACHE_MS) refreshMenusInBackground();
      return { ...cachedMenus, refreshing: now - cachedAt >= CACHE_MS };
    }
  }

  menuLoadPromise = loadMenusUncached({ forceExtended: force });
  try {
    return await menuLoadPromise;
  } finally {
    menuLoadPromise = null;
  }
}

function filterHiddenMenuItems(menuData) {
  const hidden = config.hiddenMenuItems.map((item) => item.toLowerCase().trim());
  const days = menuData.days.map((day) => ({
    ...day,
    products: day.products.filter((product) => {
      const item = product.item.toLowerCase().trim();
      return !hidden.some((excluded) => item.includes(excluded));
    })
  })).filter((day) => day.products.length > 0);
  return {
    ...menuData,
    days,
    totalProducts: days.reduce((sum, day) => sum + day.products.length, 0)
  };
}

async function readPersistedMenus() {
  try {
    const parsed = JSON.parse(await readFile(MENU_CACHE_FILE, "utf8"));
    return parsed.cacheVersion === MENU_CACHE_VERSION
      && Array.isArray(parsed.days)
      && parsed.days.length > 0
      ? filterHiddenMenuItems(parsed)
      : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function refreshMenusInBackground() {
  if (menuLoadPromise) return;
  menuLoadPromise = loadMenusUncached()
    .catch((error) => {
      console.warn(`Background menu refresh failed: ${error.message}`);
      return cachedMenus;
    })
    .finally(() => {
      menuLoadPromise = null;
    });
}

async function loadMenusUncached({ forceExtended = false } = {}) {
  const now = Date.now();

  const firstPage = await fetchHtml(LUNCH_URL);
  const dropdownDates = parseDates(firstPage).sort((a, b) => a.date.localeCompare(b.date));
  if (dropdownDates.length === 0) {
    throw new Error("No selectable lunch dates were found.");
  }

  const settledDays = await mapWithConcurrency(
    dropdownDates,
    config.menuFetchConcurrency,
    fetchMenuDay
  );
  const dropdownDays = settledDays
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const discoveryRange = buildMenuDateRange(
    dropdownDates[0].date,
    config.menuLookaheadMonths
  );
  const extended = await loadExtendedMenuDays(
    dropdownDates[0].date,
    dropdownDates.map((day) => day.date),
    now,
    { force: forceExtended }
  );
  const days = mergeMenuDays(extended.days, dropdownDays);

  if (days.length === 0) {
    throw new Error("No lunch menu pages could be loaded.");
  }

  cachedMenus = filterHiddenMenuItems({
    cacheVersion: MENU_CACHE_VERSION,
    source: LUNCH_URL,
    fetchedAt: new Date().toISOString(),
    discoveredThrough: discoveryRange.at(-1)?.date || dropdownDates.at(-1).date,
    discovery: {
      checked: extended.checked,
      found: extended.found,
      failed: extended.failed
    },
    days,
    totalProducts: days.reduce((sum, day) => sum + day.products.length, 0)
  });
  cachedAt = now;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MENU_CACHE_FILE, JSON.stringify(cachedMenus), "utf8");
  return cachedMenus;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": contentTypes[".json"],
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 64 * 1024) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
  }
  return body ? JSON.parse(body) : {};
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://ssip-cafeteria.whew.life; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const session = getRequestSession(request, response, { touch: url.pathname !== "/api/keepalive" });

    if (url.pathname === "/api/config") {
      sendJson(response, 200, publicConfig());
      return;
    }

    if (url.pathname === "/api/menus") {
      const force = url.searchParams.get("refresh") === "1";
      const menus = await loadMenus(force);
      await trackUsage(request, session, force ? "menus.refresh" : "menus.load", {
        days: menus.days.length,
        products: menus.totalProducts
      });
      sendJson(response, 200, menus);
      return;
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      const { username, password } = await readJsonBody(request);
      if (!username || !password) throw new Error("Username and password are required.");
      const account = await loginToSite(session, username, password);
      const wallet = parseWallet(await readProtectedPage(session, "/woo-wallet/"));
      await trackUsage(request, session, "login.success", { balance: wallet.balance });
      sendJson(response, 200, { account: serializeAccount(session) });
      return;
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      await trackUsage(request, session, "logout");
      session.reset();
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/session") {
      const rules = session.account ? await readNotificationRules() : [];
      sendJson(response, 200, {
        account: serializeAccount(session),
        idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
        notification: matchingNotification(session.account, rules)
      });
      return;
    }

    if (url.pathname === "/api/keepalive") {
      await ensureLoggedIn(session);
      const wallet = parseWallet(await readProtectedPage(session, "/woo-wallet/"));
      await trackUsage(request, session, "session.keepalive");
      sendJson(response, 200, {
        account: serializeAccount(session),
        balance: wallet.balance,
        keptAliveAt: new Date().toISOString()
      });
      return;
    }

    if (url.pathname === "/api/wallet") {
      await ensureLoggedIn(session);
      const wallet = parseWallet(await readProtectedPage(session, "/woo-wallet/"));
      await trackUsage(request, session, "wallet.view", { balance: wallet.balance });
      sendJson(response, 200, { balance: wallet.balance });
      return;
    }

    if (url.pathname === "/api/orders") {
      const orders = await loadOrders(session);
      await trackUsage(request, session, "orders.view", { count: orders.length });
      sendJson(response, 200, { orders });
      return;
    }

    if (url.pathname === "/api/order/cancel" && request.method === "POST") {
      const { cancelUrl } = await readJsonBody(request);
      const result = await cancelOrder(session, cancelUrl);
      await trackUsage(request, session, "order.cancel", { orders: result.orders.length });
      sendJson(response, 200, result);
      return;
    }

    if (url.pathname === "/api/cart") {
      await ensureLoggedIn(session);
      const cart = parseCart(await readProtectedPage(session, "/cart/"));
      await trackUsage(request, session, "cart.view", { items: cart.items.length, total: cart.total });
      sendJson(response, 200, cart);
      return;
    }

    if (url.pathname === "/api/cart/add" && request.method === "POST") {
      const body = await readJsonBody(request);
      const cart = await addToCart(session, body);
      await trackUsage(request, session, "cart.add", { productId: body.productId, date: body.date, items: cart.items.length });
      sendJson(response, 200, cart);
      return;
    }

    if (url.pathname === "/api/cart/clear" && request.method === "POST") {
      const cart = await clearCart(session);
      await trackUsage(request, session, "cart.clear");
      sendJson(response, 200, cart);
      return;
    }

    if (url.pathname === "/api/checkout") {
      await ensureLoggedIn(session);
      const checkout = parseCheckout(await readProtectedPage(session, "/checkout/"));
      await trackUsage(request, session, "checkout.view", { items: checkout.items.length, total: checkout.total });
      sendJson(response, 200, checkout);
      return;
    }

    if (url.pathname === "/api/order/place" && request.method === "POST") {
      const result = await placeOrder(session, await readJsonBody(request));
      await trackUsage(request, session, "order.place", { result: result.result });
      sendJson(response, 200, result);
      return;
    }

    if (url.pathname === "/api/order/bulk" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await placeIdempotentBulkOrder(session, body);
      await trackUsage(request, session, "order.bulk", {
        result: result.result,
        requested: Array.isArray(body.selections) ? body.selections.length : 0,
        placed: result.placed.length
      });
      sendJson(response, 200, result);
      return;
    }

    if (url.pathname === "/api/usage") {
      await ensureLoggedIn(session);
      assertUsageAdmin(session);
      if (request.method === "POST") {
        const rules = await saveNotificationRules(await readJsonBody(request));
        await trackUsage(request, session, "custom-notifications.update", { count: rules.length });
        sendJson(response, 200, { rules });
        return;
      }
      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
      const entries = await readUsageLog(limit);
      const rules = await readNotificationRules();
      await trackUsage(request, session, "usage.view", { count: entries.length });
      sendJson(response, 200, { entries, rules });
      return;
    }

    if (url.pathname === "/api/custom-notifications" || url.pathname === "/api/custom-notifications/") {
      await ensureLoggedIn(session);
      if (request.method === "POST") {
        assertUsageAdmin(session);
        const rules = await saveNotificationRules(await readJsonBody(request));
        await trackUsage(request, session, "custom-notifications.update", { count: rules.length });
        sendJson(response, 200, { rules });
        return;
      }
      if (request.method !== "GET") {
        const error = new Error("This notification request method is not supported.");
        error.status = 405;
        throw error;
      }
      const rules = await readNotificationRules();
      const notification = matchingNotification(session.account, rules);
      if ((session.account?.username || "").toLowerCase() === USAGE_ADMIN_EMAIL) {
        sendJson(response, 200, { rules, notification });
      } else {
        sendJson(response, 200, { notification });
      }
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getRequestSession(request, response, { touch: false });
      if (url.pathname.startsWith("/api/")) {
        await trackUsage(request, session, "error", {
          status: error.status || 500,
          message: error.message
        });
      }
    } catch {
      // Never let usage tracking hide the original app error.
    }
    sendJson(response, error.status || 500, { error: error.message });
  }
});

function startServer() {
  if (server.listening) return Promise.resolve(server);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      console.log(`SooDering: http://${config.host}:${PORT}`);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(PORT, config.host);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  decodeHtml,
  createSiteSession,
  isSessionExpired,
  parseDates,
  parseOrderDeliveryDate,
  parseOrders,
  parseAccount,
  parseProducts,
  buildMenuDateRange,
  mapWithConcurrency,
  menuPageOffersDate,
  mergeMenuDays,
  extendedMenuEntryCacheMs,
  filterHiddenMenuItems,
  runIdempotentOperation,
  server,
  splitStall,
  usageUser,
  startServer
};
