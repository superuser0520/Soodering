const DEFAULT_TIME_SLOTS = [
  "11:30 - 11:55",
  "12:00 - 12:25",
  "12:30 - 12:55",
  "13:00 - 13:25",
  "13:30 - 13:55"
];
const CREDENTIALS_KEY = "soodering.credentials";
const LEGACY_CREDENTIALS_KEY = "shimanoLunch.credentials";
const MONTHLY_CREDIT = 100;
const KEEPALIVE_MS = 4 * 60 * 1000;
const QUICK_ORDER_EXCLUDED_ITEMS = /economic\s*rice|nasi\s*padang|vegetarian\s*set/i;
const USAGE_ADMIN_EMAIL = "soolihjing@shimano.com.sg";
const SG_PUBLIC_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-02-17",
  "2026-02-18",
  "2026-03-21",
  "2026-04-03",
  "2026-05-01",
  "2026-05-27",
  "2026-05-31",
  "2026-06-01",
  "2026-08-09",
  "2026-08-10",
  "2026-11-08",
  "2026-11-09",
  "2026-12-25",
  "2027-01-01",
  "2027-02-06",
  "2027-02-07",
  "2027-02-08",
  "2027-03-10",
  "2027-03-26",
  "2027-05-01",
  "2027-05-17",
  "2027-05-20",
  "2027-08-09",
  "2027-10-28",
  "2027-12-25"
]);

const state = {
  account: null,
  data: null,
  activeTab: "menu",
  menuFilter: "all",
  selections: new Map(),
  upcomingOrders: [],
  ordersLoaded: false,
  ordersLoading: false,
  usageLoaded: false,
  usageLoading: false,
  walletLoading: false
};

const menusEl = document.querySelector("#menus");
const statusEl = document.querySelector("#status");
const loginScreen = document.querySelector("#loginScreen");
const appScreen = document.querySelector("#appScreen");
const refreshButton = document.querySelector("#refreshButton");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const rememberInput = document.querySelector("#rememberInput");
const accountStatus = document.querySelector("#accountStatus");
const signedInLabel = document.querySelector("#signedInLabel");
const loginButton = document.querySelector("#loginButton");
const logoutButton = document.querySelector("#logoutButton");
const walletBalance = document.querySelector("#walletBalance");
const creditPanel = document.querySelector("#creditPanel");
const creditDaily = document.querySelector("#creditDaily");
const creditDetails = document.querySelector("#creditDetails");
const creditRefresh = document.querySelector("#creditRefresh");
const creditUpcoming = document.querySelector("#creditUpcoming");
const creditProjected = document.querySelector("#creditProjected");
const ordersList = document.querySelector("#ordersList");
const ordersTabCount = document.querySelector("#ordersTabCount");
const cartStatus = document.querySelector("#cartStatus");
const cartList = document.querySelector("#cartList");
const orderProgress = document.querySelector("#orderProgress");
const clearSelectionButton = document.querySelector("#clearSelectionButton");
const placeOrderButton = document.querySelector("#placeOrderButton");
const quickChineseButton = document.querySelector("#quickChineseButton");
const quickMalayButton = document.querySelector("#quickMalayButton");
const menuFilter = document.querySelector(".menu-filter");
const tabButtons = document.querySelectorAll(".tab-button");
const menuView = document.querySelector("#menuView");
const ordersView = document.querySelector("#ordersView");
const usageView = document.querySelector("#usageView");
const usageTabButton = document.querySelector("#usageTabButton");
const usageRefreshButton = document.querySelector("#usageRefreshButton");
const usageList = document.querySelector("#usageList");
const usageStatus = document.querySelector("#usageStatus");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function rememberCredentials(username, password) {
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ username, password }));
  localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
}

function forgetCredentials() {
  localStorage.removeItem(CREDENTIALS_KEY);
  localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
}

function fillRememberedCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) || localStorage.getItem(LEGACY_CREDENTIALS_KEY) || "{}");
    if (saved.username) usernameInput.value = saved.username;
    if (saved.password) passwordInput.value = saved.password;
    rememberInput.checked = Boolean(saved.username || saved.password);
  } catch {
    forgetCredentials();
  }
}

function getRememberedCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) || localStorage.getItem(LEGACY_CREDENTIALS_KEY) || "{}");
    return saved.username && saved.password ? saved : null;
  } catch {
    forgetCredentials();
    return null;
  }
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    if (/expected pattern/i.test(error.message || "")) {
      throw new Error("The cafeteria request was rejected before it could be sent. Refresh the page and try again.");
    }
    throw error;
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || "The server returned an unreadable response.");
  }
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loginWithRememberedCredentials() {
  const saved = getRememberedCredentials();
  if (!saved) return false;

  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({
      username: saved.username,
      password: saved.password
    })
  });
  state.account = data.account;
  renderAccount();
  return true;
}

async function apiWithRelogin(path, options = {}, statusTarget = cartStatus) {
  try {
    return await api(path, options);
  } catch (error) {
    if (!/log in to the cafeteria account/i.test(error.message || "")) throw error;

    if (statusTarget) statusTarget.textContent = "Refreshing cafeteria login...";
    const loggedIn = await loginWithRememberedCredentials();
    if (!loggedIn) throw error;
    return api(path, options);
  }
}

async function keepCafeteriaSessionAlive() {
  if (!state.account) {
    const restored = await loginWithRememberedCredentials();
    if (!restored) return;
  }

  try {
    const data = await apiWithRelogin("/api/keepalive", { headers: {} }, null);
    if (data.account) state.account = data.account;
    if (data.balance) renderWallet({ balance: data.balance });
    renderAccount();
  } catch {
    // Keepalive is best-effort; normal actions still show actionable errors.
  }
}

function todayIso() {
  const now = new Date();
  const sg = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const yyyy = sg.getFullYear();
  const mm = String(sg.getMonth() + 1).padStart(2, "0");
  const dd = String(sg.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T00:00:00`));
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function canViewUsage() {
  return (state.account?.username || "").toLowerCase() === USAGE_ADMIN_EMAIL;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function isWeekday(date) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day >= 1 && day <= 5;
}

function parseMoneyValue(value = "") {
  const match = String(value).replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : 0;
}

function parseOrderQuantity(product = "") {
  return [...String(product).matchAll(/\bx\s*(\d+)\b/gi)].reduce((sum, match) => sum + Number(match[1] || 0), 0) || 1;
}

function normalizeMealName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/\bx\s*\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(stall|side|set)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(start, end) {
  return Math.round((end - start) / 86400000);
}

function isWorkingDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6 && !SG_PUBLIC_HOLIDAYS.has(isoDate(date));
}

function creditCycle(todayIsoValue = todayIso()) {
  const today = new Date(`${todayIsoValue}T00:00:00`);
  const start = new Date(today);
  if (today.getDate() >= 27) {
    start.setDate(27);
  } else {
    start.setMonth(start.getMonth() - 1, 27);
  }

  const refresh = new Date(start);
  refresh.setMonth(refresh.getMonth() + 1, 27);
  const end = addDays(refresh, -1);
  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    if (isWorkingDay(cursor)) days.push(isoDate(cursor));
  }

  const todayIndex = days.findIndex((day) => day >= todayIsoValue);
  const workdaysLeft = todayIndex >= 0 ? days.length - todayIndex : 0;

  return {
    start: isoDate(start),
    end: isoDate(end),
    refresh: isoDate(refresh),
    workingDays: days.length,
    workdaysLeft,
    calendarDaysLeft: Math.max(0, daysBetween(today, refresh)),
    dailyCredit: days.length ? MONTHLY_CREDIT / days.length : 0
  };
}

function isActiveOrder(order) {
  return !/cancel/i.test(order.status || "") && order.deliveryDate && order.deliveryDate >= todayIso();
}

function ordersForProduct(product) {
  const productNeedle = normalizeMealName(`${product.title} ${product.item}`);
  return state.upcomingOrders.filter((order) => {
    if (order.deliveryDate !== product.date) return false;
    const orderNeedle = normalizeMealName(order.product);
    return orderNeedle.includes(productNeedle) || productNeedle.includes(orderNeedle) || orderNeedle.includes(normalizeMealName(product.item));
  });
}

function allProducts(days) {
  return days.flatMap((day) => day.products.map((product) => ({ ...product, label: day.label })));
}

function afterFirstPaint(callback) {
  requestAnimationFrame(() => setTimeout(callback, 0));
}

function renderAccount() {
  if (state.account) {
    const label = `${state.account.name || state.account.username}${state.account.staffId ? ` #${state.account.staffId}` : ""}`;
    signedInLabel.textContent = label;
    loginButton.textContent = "Switch account";
    loginScreen.hidden = true;
    appScreen.hidden = false;
  } else {
    accountStatus.textContent = "Sign in to order lunch.";
    signedInLabel.textContent = "";
    loginButton.textContent = "Login";
    loginScreen.hidden = false;
    appScreen.hidden = true;
  }
  usageTabButton.hidden = !canViewUsage();
  if (!canViewUsage() && state.activeTab === "usage") {
    state.activeTab = "menu";
    renderActiveTab();
  }
}

function renderWallet(wallet) {
  walletBalance.textContent = wallet.balance || "-";
  state.walletBalance = wallet.balance || "";
  renderCredit();
}

function renderActiveTab() {
  tabButtons.forEach((button) => {
    button.classList.toggle("selected", button.dataset.tab === state.activeTab);
  });
  menuView.hidden = state.activeTab !== "menu";
  ordersView.hidden = state.activeTab !== "orders";
  usageView.hidden = state.activeTab !== "usage";
}

function renderOrders(payload) {
  const today = todayIso();
  const upcoming = payload.orders
    .filter((order) => order.deliveryDate && order.deliveryDate >= today && !/cancel/i.test(order.status || ""))
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));

  state.ordersLoaded = true;
  state.orderedDates = new Set(upcoming.map((order) => order.deliveryDate));
  state.upcomingOrders = upcoming;
  ordersTabCount.textContent = String(upcoming.length);

  ordersList.innerHTML = upcoming.map((order) => `
    <div class="list-row order-row">
      <div class="order-copy">
        <strong>${escapeHtml(formatDate(order.deliveryDate))}</strong>
        <span>🍽️ ${escapeHtml(order.product)}</span>
      </div>
      <div class="order-actions">
        <strong>${escapeHtml(order.total)}</strong>
        ${order.cancelUrl ? `<button class="cancel-order-button" type="button" data-cancel-url="${escapeHtml(order.cancelUrl)}">Cancel</button>` : ""}
      </div>
    </div>
  `).join("") || `<p class="meta">No upcoming orders from today onward.</p>`;
  renderCredit();
  renderMenus();
}

function describeUsage(entry) {
  const parts = [entry.action];
  if (entry.user) parts.push(entry.user);
  if (entry.balance) parts.push(`balance ${entry.balance}`);
  if (entry.days) parts.push(`${entry.days} menu days`);
  if (entry.products) parts.push(`${entry.products} products`);
  if (entry.count !== undefined) parts.push(`${entry.count} records`);
  if (entry.requested !== undefined) parts.push(`${entry.requested} requested`);
  if (entry.placed !== undefined) parts.push(`${entry.placed} placed`);
  if (entry.items !== undefined) parts.push(`${entry.items} item${entry.items === 1 ? "" : "s"}`);
  if (entry.total) parts.push(`total ${entry.total}`);
  if (entry.status) parts.push(`status ${entry.status}`);
  if (entry.message) parts.push(entry.message);
  return parts.join(" · ");
}

function renderUsage(entries) {
  usageStatus.textContent = `${entries.length} recent log entr${entries.length === 1 ? "y" : "ies"}.`;
  usageList.innerHTML = entries.map((entry) => `
    <div class="usage-row">
      <div>
        <strong>${escapeHtml(entry.action)}</strong>
        <p class="meta">${escapeHtml(describeUsage(entry))}</p>
      </div>
      <time>${escapeHtml(formatDateTime(entry.at))}</time>
    </div>
  `).join("") || `<p class="empty-state">No usage recorded yet.</p>`;
}

function selectedItems() {
  return [...state.selections.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function weekdayProductsForStall(stallName) {
  if (!state.data) return [];
  return state.data.days
    .filter((day) => isWeekday(day.date))
    .filter((day) => !state.orderedDates?.has(day.date))
    .map((day) => day.products.find((product) => {
      const productName = `${product.title} ${product.item}`;
      return product.stall.toLowerCase() === stallName.toLowerCase()
        && !QUICK_ORDER_EXCLUDED_ITEMS.test(productName);
    }))
    .filter(Boolean);
}

function setMenuLoading(isLoading, message) {
  refreshButton.disabled = isLoading;
  menusEl.classList.toggle("is-loading", isLoading);
  statusEl.classList.toggle("loading-message", isLoading);
  if (message) statusEl.textContent = message;
}

function setOrderingProgress(isOrdering, message) {
  placeOrderButton.disabled = isOrdering || selectedItems().length === 0;
  quickChineseButton.disabled = isOrdering;
  quickMalayButton.disabled = isOrdering;
  placeOrderButton.classList.toggle("is-loading", isOrdering);
  cartStatus.classList.toggle("loading-message", isOrdering);
  if (message) cartStatus.textContent = message;
}

function renderBasket() {
  const items = selectedItems();
  placeOrderButton.disabled = items.length === 0;
  clearSelectionButton.disabled = false;

  if (items.length === 0) {
    cartStatus.textContent = "No meals selected.";
    cartList.innerHTML = "";
  } else {
    cartStatus.textContent = `${items.length} date${items.length === 1 ? "" : "s"} selected.`;
    cartList.innerHTML = items.map((item) => `
      <div class="list-row basket-row">
        <strong>${escapeHtml(formatDate(item.date))}</strong>
        <span>${escapeHtml(item.stall)} - ${escapeHtml(item.item)} ${escapeHtml(item.price)}</span>
        <button class="secondary remove-selection-button" type="button" data-date="${escapeHtml(item.date)}">Remove</button>
      </div>
    `).join("");
  }

  menusEl.querySelectorAll(".pick-button").forEach((button) => {
    const date = button.dataset.date;
    const productId = button.dataset.productId;
    const selected = state.selections.get(date)?.id === productId;
    button.textContent = selected ? "✓" : "+";
    button.setAttribute("aria-label", selected ? "Selected meal" : "Pick meal");
    button.classList.toggle("selected", selected);
  });
}

function renderOrderProgress(items, { active = false } = {}) {
  if (!items.length) {
    orderProgress.hidden = true;
    orderProgress.innerHTML = "";
    return;
  }

  orderProgress.hidden = false;
  orderProgress.innerHTML = `
    <p class="order-reminder">${active ? "Please do not close this page. SooDering is ordering day by day." : "Ordering progress"}</p>
    <div class="order-progress-list">
      ${items.map((item) => `
        <div class="order-progress-row ${escapeHtml(item.status)}">
          <span class="order-progress-dot" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(formatDate(item.date))}</strong>
            <p class="meta">${escapeHtml(item.stall)} - ${escapeHtml(item.item)} ${escapeHtml(item.price || "")}</p>
            ${item.message ? `<p class="meta">${escapeHtml(item.message)}</p>` : ""}
          </div>
          <span class="order-progress-status">${escapeHtml(item.label)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function progressItemsFor(products) {
  return products.map((item) => ({
    ...item,
    status: "pending",
    label: "Waiting",
    message: ""
  }));
}

async function submitProducts(products, successMessage) {
  const progressItems = progressItemsFor(products);
  let latestOrders = null;
  let successCount = 0;
  let failureCount = 0;

  renderOrderProgress(progressItems, { active: true });

  for (const [index, item] of products.entries()) {
    progressItems[index].status = "ordering";
    progressItems[index].label = "Ordering";
    progressItems[index].message = "Submitting now...";
    cartStatus.textContent = `Ordering ${index + 1} of ${products.length}: ${formatDate(item.date)}. Do not close this page.`;
    renderOrderProgress(progressItems, { active: true });

    try {
      const result = await apiWithRelogin("/api/order/bulk", {
        method: "POST",
        body: JSON.stringify({
          selections: [{
            productId: item.id,
            date: item.date,
            quantity: 1
          }],
          timeSlot: DEFAULT_TIME_SLOTS[0],
          notes: ""
        })
      });
      latestOrders = result.orders;
      successCount += 1;
      progressItems[index].status = "done";
      progressItems[index].label = "Ordered";
      progressItems[index].message = "Done";
      state.selections.delete(item.date);
    } catch (error) {
      failureCount += 1;
      progressItems[index].status = "failed";
      progressItems[index].label = "Failed";
      progressItems[index].message = error.message || "Order failed.";
    }

    renderOrderProgress(progressItems, { active: index < products.length - 1 });
  }

  cartStatus.textContent = failureCount
    ? `${successCount} ordered, ${failureCount} failed. Check the progress list.`
    : successMessage;
  renderBasket();
  renderOrderProgress(progressItems);
  if (latestOrders) renderOrders({ orders: latestOrders });
  await refreshAccountData({ includeOrders: true, forceOrders: true });
}

async function quickOrder(stallName) {
  if (!state.data) {
    cartStatus.textContent = "Menu is still loading. Try again in a moment.";
    return;
  }

  if (!state.ordersLoaded) {
    cartStatus.textContent = "Checking which weekdays are not ordered yet...";
    await loadOrders();
  }

  const products = weekdayProductsForStall(stallName);
  if (products.length === 0) {
    cartStatus.textContent = `No unordered weekday ${stallName} items are available after skipping Economic Rice and Nasi Padang.`;
    return;
  }

  const summary = products.map((item) => `${formatDate(item.date)}: ${item.item} ${item.price}`).join("\n");
  const confirmed = window.confirm(`Quick order ${stallName} for ${products.length} weekday${products.length === 1 ? "" : "s"}?\n\n${summary}\n\nTime: 11:30 - 11:55`);
  if (!confirmed) return;

  setOrderingProgress(true, `Ordering ${stallName} weekdays...`);

  try {
    await submitProducts(products, `${stallName} weekday orders placed successfully.`);
  } catch (error) {
    cartStatus.textContent = error.message || "Quick order failed. Please refresh and try again.";
  } finally {
    setOrderingProgress(false);
  }
}

function renderProduct(product) {
  const orders = ordersForProduct(product);
  const orderedQuantity = orders.reduce((sum, order) => sum + parseOrderQuantity(order.product), 0);

  return `
    <li class="menu-item ${orders.length ? "ordered-item" : ""}">
      <a class="thumb" href="${escapeHtml(product.productUrl)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(product.title)}"><span class="food-logo">🍱</span></a>
      <div class="menu-copy">
        <p class="stall">${escapeHtml(product.stall)}</p>
        <h3>${escapeHtml(product.item)}</h3>
        <p class="meta">${escapeHtml(product.price)}${product.stock ? ` · ${escapeHtml(product.stock)}` : ""}</p>
        ${orders.length ? `<p class="ordered-badge">Ordered x ${orderedQuantity}</p>` : ""}
        ${product.description ? `<p class="description">${escapeHtml(product.description)}</p>` : ""}
      </div>
      <button class="secondary pick-button" type="button" data-product-id="${escapeHtml(product.id)}" data-date="${escapeHtml(product.date)}" aria-label="Pick meal">+</button>
    </li>
  `;
}

function renderCredit() {
  if (!state.account) {
    creditPanel.hidden = true;
    return;
  }

  const cycle = creditCycle();
  const cycleOrders = state.upcomingOrders.filter((order) => order.deliveryDate >= cycle.start && order.deliveryDate <= cycle.end && isActiveOrder(order));
  const upcomingSpend = cycleOrders.reduce((sum, order) => sum + parseMoneyValue(order.total), 0);
  const wallet = parseMoneyValue(state.walletBalance);
  const projected = Math.max(0, wallet - upcomingSpend);

  creditPanel.hidden = false;
  creditDaily.textContent = `${formatMoney(cycle.dailyCredit)} / workday`;
  creditDetails.textContent = `${formatDate(cycle.start)} to ${formatDate(cycle.end)} has ${cycle.workingDays} credited workdays.`;
  creditRefresh.textContent = `${cycle.calendarDaysLeft} day${cycle.calendarDaysLeft === 1 ? "" : "s"}`;
  creditUpcoming.textContent = formatMoney(upcomingSpend);
  creditProjected.textContent = formatMoney(projected);
}

function renderMenus() {
  if (!state.data) return;
  const lastDay = state.data.days[state.data.days.length - 1];
  statusEl.textContent = lastDay ? `Orders are available until ${formatDate(lastDay.date)}.` : "No order dates available.";

  const visibleDays = state.data.days.filter((day) => {
    const alreadyOrdered = state.orderedDates?.has(day.date);
    if (state.menuFilter === "ordered") return alreadyOrdered;
    if (state.menuFilter === "not-ordered") return !alreadyOrdered;
    return true;
  });

  menusEl.innerHTML = visibleDays.map((day) => {
    const alreadyOrdered = state.orderedDates?.has(day.date);
    return `
    <section class="day ${alreadyOrdered ? "already-ordered" : ""}">
      <div class="day-header">
        <h2>${formatDate(day.date)}</h2>
        <p class="meta">${alreadyOrdered ? "Already ordered, still can order again" : `${day.products.length} option${day.products.length === 1 ? "" : "s"}`}</p>
      </div>
      <ul class="menu-list">
        ${day.products.map(renderProduct).join("")}
      </ul>
    </section>
  `;
  }).join("") || `<p class="empty-state">No dates match this filter.</p>`;
  renderBasket();
}

async function loadMenus(refresh = false) {
  setMenuLoading(true, refresh ? "Refreshing menus..." : "Loading cafeteria menus...");

  try {
    state.data = await api(`/api/menus${refresh ? "?refresh=1" : ""}`, { headers: {} });
    renderMenus();
  } catch (error) {
    statusEl.textContent = error.message;
    menusEl.innerHTML = "";
  } finally {
    setMenuLoading(false);
  }
}

async function loadWallet() {
  if (!state.account) return;
  if (state.walletLoading) return;
  state.walletLoading = true;
  try {
    const wallet = await api("/api/wallet", { headers: {} });
    renderWallet(wallet);
  } catch (error) {
    walletBalance.textContent = "-";
  } finally {
    state.walletLoading = false;
  }
}

async function loadOrders({ force = false } = {}) {
  if (!state.account) return;
  if (state.ordersLoading) return;
  if (state.ordersLoaded && !force) return;

  state.ordersLoading = true;
  if (state.activeTab === "orders") {
    ordersList.innerHTML = `<p class="meta">Loading upcoming orders...</p>`;
  }

  try {
    const orders = await api("/api/orders", { headers: {} });
    state.ordersLoaded = true;
    renderOrders(orders);
  } catch (error) {
    ordersList.innerHTML = `<p class="meta">${escapeHtml(error.message)}</p>`;
  } finally {
    state.ordersLoading = false;
  }
}

async function loadUsage({ force = false } = {}) {
  if (!canViewUsage()) return;
  if (state.usageLoading) return;
  if (state.usageLoaded && !force) return;

  state.usageLoading = true;
  usageRefreshButton.disabled = true;
  usageStatus.textContent = "Loading usage log...";

  try {
    const data = await api("/api/usage?limit=100", { headers: {} });
    state.usageLoaded = true;
    renderUsage(data.entries || []);
  } catch (error) {
    usageStatus.textContent = error.message;
    usageList.innerHTML = "";
  } finally {
    state.usageLoading = false;
    usageRefreshButton.disabled = false;
  }
}

async function refreshAccountData({ includeOrders = false, forceOrders = false } = {}) {
  if (!state.account) return;
  await loadWallet();
  if (includeOrders) await loadOrders({ force: forceOrders });
}

async function loadSession() {
  const data = await api("/api/session", { headers: {} });
  state.account = data.account;
  if (!state.account) {
    await loginWithRememberedCredentials();
  }
  renderAccount();
  renderBasket();
  afterFirstPaint(() => {
    loadWallet();
  });
}

refreshButton.addEventListener("click", () => loadMenus(true));

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab;
    renderActiveTab();
    if (state.activeTab === "orders") {
      loadOrders();
    } else if (state.activeTab === "usage") {
      loadUsage();
    }
  });
});

menuFilter.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-button");
  if (!button) return;
  state.menuFilter = button.dataset.filter;
  menuFilter.querySelectorAll(".filter-button").forEach((item) => {
    item.classList.toggle("selected", item === button);
  });
  renderMenus();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  accountStatus.textContent = "Logging in...";

  try {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
    });
    if (rememberInput.checked) {
      rememberCredentials(username, password);
    } else {
      forgetCredentials();
    }
    state.account = data.account;
    renderAccount();
    afterFirstPaint(() => {
      refreshAccountData({ includeOrders: true, forceOrders: true });
    });
  } catch (error) {
    accountStatus.textContent = error.message;
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  state.account = null;
  state.selections.clear();
  state.upcomingOrders = [];
  state.orderedDates = new Set();
  state.walletBalance = "";
  state.ordersLoaded = false;
  state.ordersLoading = false;
  state.usageLoaded = false;
  state.usageLoading = false;
  renderAccount();
  walletBalance.textContent = "-";
  ordersList.innerHTML = "";
  usageList.innerHTML = "";
  usageStatus.textContent = "Recent SooDering activity.";
  renderCredit();
  fillRememberedCredentials();
  renderBasket();
});

usageRefreshButton.addEventListener("click", () => loadUsage({ force: true }));

ordersList.addEventListener("click", async (event) => {
  const button = event.target.closest(".cancel-order-button");
  if (!button) return;
  const confirmed = window.confirm("Cancel this cafeteria order?");
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Cancelling...";
  try {
    const result = await api("/api/order/cancel", {
      method: "POST",
      body: JSON.stringify({ cancelUrl: button.dataset.cancelUrl })
    });
    renderOrders({ orders: result.orders });
    await refreshAccountData({ includeOrders: true, forceOrders: true });
  } catch (error) {
    button.textContent = "Failed";
    ordersList.insertAdjacentHTML("afterbegin", `<p class="meta">${escapeHtml(error.message)}</p>`);
  }
});

menusEl.addEventListener("click", (event) => {
  const button = event.target.closest(".pick-button");
  if (!button || !state.data) return;

  const product = allProducts(state.data.days).find((item) => item.id === button.dataset.productId && item.date === button.dataset.date);
  if (!product) return;

  const existing = state.selections.get(product.date);
  if (existing?.id === product.id) {
    state.selections.delete(product.date);
  } else {
    state.selections.set(product.date, product);
  }
  renderBasket();
});

cartList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-selection-button");
  if (!button) return;
  state.selections.delete(button.dataset.date);
  renderBasket();
});

clearSelectionButton.addEventListener("click", () => {
  state.selections.clear();
  renderBasket();
});

quickChineseButton.addEventListener("click", () => quickOrder("Chinese Stall"));
quickMalayButton.addEventListener("click", () => quickOrder("Malay Stall"));

placeOrderButton.addEventListener("click", async () => {
  const selections = selectedItems();
  if (selections.length === 0) return;

  const summary = selections.map((item) => `${formatDate(item.date)}: ${item.stall} - ${item.item}`).join("\n");
  const confirmed = window.confirm(`Place these cafeteria reservations now?\n\n${summary}\n\nTime: 11:30 - 11:55`);
  if (!confirmed) return;

  setOrderingProgress(true, "Ordering selected meals...");
  try {
    await submitProducts(selections, "Order placed successfully.");
  } catch (error) {
    cartStatus.textContent = error.message || "Order failed. Please refresh and try again.";
  } finally {
    setOrderingProgress(false);
  }
});

fillRememberedCredentials();
renderActiveTab();
loadMenus();
loadSession().catch(() => {});
setInterval(keepCafeteriaSessionAlive, KEEPALIVE_MS);
