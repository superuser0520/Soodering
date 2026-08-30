const CREDENTIALS_KEY = "soodering.credentials";
const LEGACY_CREDENTIALS_KEY = "shimanoLunch.credentials";
const REMEMBERED_USERNAME_KEY = "soodering.rememberedUsername";
const KEEPALIVE_MS = 4 * 60 * 1000;
const MENU_AUTO_REFRESH_MS = 5 * 60 * 1000;

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
  walletLoading: false,
  config: {
    monthlyCredit: 100,
    defaultTimeSlots: ["11:30 - 11:55"],
    quickOrderExcludedItems: "economic rice|nasi padang|vegetarian set",
    hiddenMenuItems: ["vegetarian set", "economic rice set", "nasi padang set"],
    publicHolidays: [],
    sessionIdleTimeoutMs: 30 * 60 * 1000
  },
  lastActivityAt: Date.now(),
  idleTimer: null,
  menuRefreshTimer: null,
  orderKeys: new Map(),
  rowenaNotificationKey: null
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
const rememberHelp = document.querySelector("#rememberHelp");
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
const todayOrdersList = document.querySelector("#todayOrdersList");
const todayOrdersStatus = document.querySelector("#todayOrdersStatus");
const todayOrdersCount = document.querySelector("#todayOrdersCount");
const todayOrdersRefreshButton = document.querySelector("#todayOrdersRefreshButton");
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
const rowenaEditorForm = document.querySelector("#rowenaEditorForm");
const rowenaEditorStatus = document.querySelector("#rowenaEditorStatus");
const notificationRules = document.querySelector("#notificationRules");
const addNotificationRuleButton = document.querySelector("#addNotificationRuleButton");
const saveRowenaMessageButton = document.querySelector("#saveRowenaMessageButton");
const workspaceTitle = document.querySelector("#workspaceTitle");
const workspaceSubtitle = document.querySelector("#workspaceSubtitle");
const rowenaNotification = document.querySelector("#rowenaNotification");
const rowenaNotificationTitle = document.querySelector("#rowenaNotificationTitle");
const rowenaNotificationMessage = document.querySelector("#rowenaNotificationMessage");
const dismissRowenaNotification = document.querySelector("#dismissRowenaNotification");
const systemNotification = document.querySelector("#systemNotification");
const systemNotificationTitle = document.querySelector("#systemNotificationTitle");
const systemNotificationMessage = document.querySelector("#systemNotificationMessage");
const dismissSystemNotification = document.querySelector("#dismissSystemNotification");
let rowenaNotificationTimer = null;
let systemNotificationTimer = null;
let rowenaDismissAttempts = 0;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function clearLegacyBrowserCredentials() {
  localStorage.removeItem(CREDENTIALS_KEY);
  localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
}

function browserPasswordManagerAvailable() {
  return window.isSecureContext
    && typeof window.PasswordCredential === "function"
    && typeof navigator.credentials?.store === "function"
    && typeof navigator.credentials?.get === "function";
}

async function storeBrowserCredentials(username, password) {
  if (!browserPasswordManagerAvailable()) return false;
  await navigator.credentials.store(new PasswordCredential({
    id: username,
    name: username,
    password
  }));
  return true;
}

async function loadBrowserCredentials() {
  if (!browserPasswordManagerAvailable()) return null;
  const saved = await navigator.credentials.get({
    password: true,
    mediation: "optional"
  });
  if (!saved?.id || !saved?.password) return null;
  return { username: saved.id, password: saved.password };
}

async function rememberCredentials(username, password) {
  clearLegacyBrowserCredentials();
  if (!window.sooderingCredentials?.available) {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
    return storeBrowserCredentials(username, password);
  }
  localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  await window.sooderingCredentials.save({ username, password });
  return true;
}

async function forgetCredentials() {
  clearLegacyBrowserCredentials();
  localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  if (window.sooderingCredentials?.available) await window.sooderingCredentials.clear();
}

async function fillRememberedCredentials() {
  clearLegacyBrowserCredentials();
  rememberInput.disabled = false;
  const electronStorage = Boolean(window.sooderingCredentials?.available);
  const browserStorage = browserPasswordManagerAvailable();
  rememberInput.title = electronStorage
    ? "Store the login using operating-system encryption."
    : browserStorage
      ? "Store the login in your browser password manager."
      : "Remember the email. Secure password saving requires HTTPS and browser password-manager support.";
  rememberHelp.textContent = rememberInput.title;
  if (!window.sooderingCredentials?.available) {
    const username = localStorage.getItem(REMEMBERED_USERNAME_KEY) || "";
    let saved = null;
    if (username) {
      try {
        saved = await loadBrowserCredentials();
      } catch {
        saved = null;
      }
    }
    if (saved?.username && saved.username.toLowerCase() === username.toLowerCase()) {
      usernameInput.value = saved.username;
      passwordInput.value = saved.password;
    } else if (username) {
      usernameInput.value = username;
    }
    rememberInput.checked = Boolean(username);
    return;
  }
  try {
    const saved = await window.sooderingCredentials.load() || {};
    if (saved.username) usernameInput.value = saved.username;
    if (saved.password) passwordInput.value = saved.password;
    rememberInput.checked = Boolean(saved.username || saved.password);
  } catch {
    await forgetCredentials();
  }
}

async function getRememberedCredentials() {
  if (!window.sooderingCredentials?.available) {
    const rememberedUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY) || "";
    if (!rememberedUsername) return null;
    try {
      const saved = await loadBrowserCredentials();
      return saved?.username.toLowerCase() === rememberedUsername.toLowerCase() ? saved : null;
    } catch {
      return null;
    }
  }
  try {
    const saved = await window.sooderingCredentials.load() || {};
    return saved.username && saved.password ? saved : null;
  } catch {
    await forgetCredentials();
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
  const saved = await getRememberedCredentials();
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
  if (!state.account || document.hidden) return;
  if (Date.now() - state.lastActivityAt >= state.config.sessionIdleTimeoutMs) return;

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
  const amount = Number(value || 0);
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
}

function canViewUsage() {
  return Boolean(state.account?.canViewUsage);
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
  return day !== 0 && day !== 6 && !state.config.publicHolidays.includes(isoDate(date));
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
    dailyCredit: days.length ? state.config.monthlyCredit / days.length : 0
  };
}

function isActiveOrder(order) {
  return !/cancel/i.test(order.status || "") && order.deliveryDate && order.deliveryDate >= todayIso();
}

function highestOrderSpendPerDate(orders, cycle) {
  const highestByDate = new Map();
  orders.forEach((order) => {
    if (!isActiveOrder(order) || order.deliveryDate < cycle.start || order.deliveryDate > cycle.end) return;
    const amount = parseMoneyValue(order.total);
    highestByDate.set(order.deliveryDate, Math.max(highestByDate.get(order.deliveryDate) || 0, amount));
  });
  return [...highestByDate.values()].reduce((sum, amount) => sum + amount, 0);
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

function withoutHiddenMenuItems(menuData) {
  const hidden = state.config.hiddenMenuItems.map((item) => item.toLowerCase().trim());
  const days = menuData.days.map((day) => ({
    ...day,
    products: day.products.filter((product) => {
      const item = product.item.toLowerCase().trim();
      return !hidden.some((excluded) => item.includes(excluded));
    })
  })).filter((day) => day.products.length > 0);
  return { ...menuData, days, totalProducts: days.reduce((sum, day) => sum + day.products.length, 0) };
}

function afterFirstPaint(callback) {
  requestAnimationFrame(() => setTimeout(callback, 0));
}

function hideRowenaNotification() {
  clearTimeout(rowenaNotificationTimer);
  rowenaNotification.hidden = true;
  rowenaDismissAttempts = 0;
  rowenaNotification.style.left = "50%";
  rowenaNotification.style.top = "50%";
  rowenaNotification.classList.remove("is-hopping");
  dismissRowenaNotification.setAttribute("aria-label", "Dismiss notification");
}

function attemptRowenaNotificationDismiss(event) {
  if (event.detail === 0) {
    hideRowenaNotification();
    return;
  }

  rowenaDismissAttempts += 1;
  if (rowenaDismissAttempts >= 3) {
    hideRowenaNotification();
    return;
  }

  const bounds = rowenaNotification.getBoundingClientRect();
  const inset = 14;
  const minX = bounds.width / 2 + inset;
  const maxX = Math.max(minX, window.innerWidth - bounds.width / 2 - inset);
  const minY = bounds.height / 2 + inset;
  const maxY = Math.max(minY, window.innerHeight - bounds.height / 2 - inset);
  const targets = [[maxX, minY], [minX, maxY]];
  const [left, top] = targets[rowenaDismissAttempts - 1];
  rowenaNotification.style.left = `${left}px`;
  rowenaNotification.style.top = `${top}px`;
  rowenaNotification.classList.remove("is-hopping");
  void rowenaNotification.offsetWidth;
  rowenaNotification.classList.add("is-hopping");
  dismissRowenaNotification.setAttribute("aria-label", `Dismiss notification, attempt ${rowenaDismissAttempts + 1} of 3`);
  clearTimeout(rowenaNotificationTimer);
  rowenaNotificationTimer = setTimeout(hideRowenaNotification, 15000);
}

async function showRowenaNotification() {
  const accountKey = String(state.account.username || state.account.name || "rowena").toLowerCase();
  if (state.rowenaNotificationKey === accountKey) return;

  try {
    const data = await api("/api/session", { headers: {} });
    if (!data.notification) return;
    rowenaNotificationTitle.textContent = data.notification.title;
    rowenaNotificationMessage.textContent = data.notification.message;
  } catch {
    return;
  }
  state.rowenaNotificationKey = accountKey;
  rowenaDismissAttempts = 0;
  rowenaNotification.style.left = "50%";
  rowenaNotification.style.top = "50%";
  rowenaNotification.hidden = false;
  clearTimeout(rowenaNotificationTimer);
  rowenaNotificationTimer = setTimeout(hideRowenaNotification, 15000);
}

function hideSystemNotification() {
  clearTimeout(systemNotificationTimer);
  systemNotification.hidden = true;
}

function showSystemNotification(title, message, { tone = "error", timeout = 10000 } = {}) {
  systemNotificationTitle.textContent = title;
  systemNotificationMessage.textContent = message;
  systemNotification.dataset.tone = tone;
  systemNotification.hidden = false;
  clearTimeout(systemNotificationTimer);
  systemNotificationTimer = setTimeout(hideSystemNotification, timeout);
}

function renderAccount() {
  if (state.account) {
    const label = `${state.account.name || state.account.username}${state.account.staffId ? ` #${state.account.staffId}` : ""}`;
    signedInLabel.textContent = label;
    loginButton.textContent = "Switch account";
    loginScreen.hidden = true;
    appScreen.hidden = false;
    showRowenaNotification();
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
  const workspaceCopy = {
    menu: ["Menu", "Choose meals across upcoming dates."],
    orders: ["Upcoming orders", "Review or cancel your reserved meals."],
    usage: ["Usage log", "Review recent SooDering activity."]
  }[state.activeTab];
  workspaceTitle.textContent = workspaceCopy[0];
  workspaceSubtitle.textContent = workspaceCopy[1];
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
  renderTodayOrders(upcoming.filter((order) => order.deliveryDate === today));
  renderCredit();
  renderMenus();
}

function renderTodayOrders(orders) {
  const totalMeals = orders.reduce((sum, order) => sum + parseOrderQuantity(order.product), 0);
  todayOrdersCount.textContent = `${totalMeals} meal${totalMeals === 1 ? "" : "s"}`;
  todayOrdersStatus.textContent = `${formatDate(todayIso())} · Signed-in account only.`;
  todayOrdersList.innerHTML = orders.map((order) => {
    const product = String(order.product || "");
    const stall = /chinese/i.test(product)
      ? "Chinese Stall"
      : /malay/i.test(product)
        ? "Malay Stall"
        : "International Stall";
    return `
    <article class="today-order-item">
      <img src="${stallLogoPath(stall)}" alt="" aria-hidden="true">
      <div class="today-order-copy">
        <strong>${escapeHtml(product)}</strong>
        <span>${escapeHtml(order.total || order.status || "Ordered")}</span>
      </div>
      <strong class="today-order-quantity">×${parseOrderQuantity(product)}</strong>
    </article>
  `;
  }).join("") || `<p class="empty-state">You have no cafeteria order for today.</p>`;
}

function renderUsage(entries) {
  usageStatus.textContent = `${entries.length} recent login${entries.length === 1 ? "" : "s"}.`;
  usageList.innerHTML = entries.map((entry) => `
    <div class="usage-row">
      <div>
        <strong>${escapeHtml(entry.user || "Unknown user")}</strong>
        <p class="meta">Wallet balance: ${escapeHtml(entry.balance || "-")}</p>
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
  const excludedItems = new RegExp(state.config.quickOrderExcludedItems, "i");
  return state.data.days
    .filter((day) => isWeekday(day.date))
    .filter((day) => !state.orderedDates?.has(day.date))
    .map((day) => day.products.find((product) => {
      const productName = `${product.title} ${product.item}`;
      return product.stall.toLowerCase() === stallName.toLowerCase()
        && !excludedItems.test(productName);
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
        <img class="basket-stall-logo" src="${stallLogoPath(item.stall)}" alt="" aria-hidden="true">
        <div class="basket-copy">
          <strong>${escapeHtml(formatDate(item.date))}</strong>
          <span>${escapeHtml(item.stall)} - ${escapeHtml(item.item)} ${escapeHtml(item.price)}</span>
        </div>
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
    <p class="order-reminder">${active ? "The server is ordering day by day. You may close this browser." : "Ordering progress"}</p>
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

function addNotificationRule(rule = {}) {
  const row = document.createElement("div");
  row.className = "notification-rule";
  row.dataset.id = rule.id || crypto.randomUUID();
  row.innerHTML = `
    <label>Username
      <input class="notification-match" maxlength="100" value="${escapeHtml(rule.match || "")}" placeholder="Username" required>
    </label>
    <label>Title
      <input class="notification-title" maxlength="80" value="${escapeHtml(rule.title || "")}" required>
    </label>
    <label>Message
      <textarea class="notification-message" maxlength="500" rows="3" required>${escapeHtml(rule.message || "")}</textarea>
    </label>
    <button class="secondary remove-notification-rule" type="button">Remove</button>
  `;
  notificationRules.appendChild(row);
}

function renderNotificationRules(rules) {
  notificationRules.innerHTML = "";
  (rules || []).forEach(addNotificationRule);
}

function orderOperationKey(item) {
  const selectionKey = `${item.date}|${item.id}`;
  if (!state.orderKeys.has(selectionKey)) {
    state.orderKeys.set(selectionKey, crypto.randomUUID().replaceAll("-", ""));
  }
  return state.orderKeys.get(selectionKey);
}

async function submitProducts(products, successMessage) {
  const progressItems = progressItemsFor(products);
  progressItems.forEach((item) => {
    item.status = "pending";
    item.label = "Queued";
    item.message = "The server will continue if this browser closes.";
  });
  renderOrderProgress(progressItems, { active: true });
  cartStatus.textContent = `Sending ${products.length} date${products.length === 1 ? "" : "s"} to the server queue...`;

  const response = await apiWithRelogin("/api/order/queue", {
    method: "POST",
    body: JSON.stringify({
      selections: products.map((item) => ({ productId: item.id, date: item.date, quantity: 1 })),
      timeSlot: state.config.defaultTimeSlots[0],
      notes: "",
      idempotencyKey: `queue_${orderOperationKey(products[0])}_${products.length}`
    })
  });
  const jobId = response.job.id;
  localStorage.setItem("sooderingActiveOrderJob", jobId);
  const acceptedMessage = `Orders for ${products.length} selected date${products.length === 1 ? "" : "s"} are accepted. You can close this browser.`;
  cartStatus.textContent = acceptedMessage;
  showSystemNotification("Orders accepted", acceptedMessage, { tone: "success", timeout: 30000 });

  let job = response.job;
  while (["queued", "running"].includes(job.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    job = (await apiWithRelogin(`/api/order/job?id=${encodeURIComponent(jobId)}`, { headers: {} })).job;
    const jobItems = new Map(job.items.map((item) => [`${item.date}|${item.productId}`, item]));
    progressItems.forEach((item) => {
      const queued = jobItems.get(`${item.date}|${item.id}`);
      if (!queued) return;
      item.status = queued.status;
      item.label = queued.status === "done" ? "Ordered" : queued.status === "ordering" ? "Ordering" : queued.status === "failed" ? "Failed" : "Queued";
      item.message = queued.message;
    });
    renderOrderProgress(progressItems, { active: true });
  }

  localStorage.removeItem("sooderingActiveOrderJob");
  const placedKeys = new Set(job.placed.map((item) => `${item.date}|${item.productId}`));
  progressItems.forEach((item) => {
    const key = `${item.date}|${item.id}`;
    if (placedKeys.has(key)) {
      state.selections.delete(item.date);
      state.orderKeys.delete(key);
    }
  });
  const successCount = job.placed.length;
  const failureCount = job.failed.length;

  cartStatus.textContent = failureCount
    ? `${successCount} ordered, ${failureCount} failed. Check the progress list.`
    : successMessage;
  renderBasket();
  renderOrderProgress(progressItems);
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
  const confirmed = window.confirm(`Quick order ${stallName} for ${products.length} weekday${products.length === 1 ? "" : "s"}?\n\n${summary}\n\nTime: ${state.config.defaultTimeSlots[0]}`);
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
      <a class="thumb" href="${escapeHtml(product.productUrl)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(product.title)}"><img class="stall-logo" src="${stallLogoPath(product.stall)}" alt="" aria-hidden="true"></a>
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

function stallLogoPath(stall = "") {
  const normalized = stall.toLowerCase();
  if (normalized.includes("chinese")) return "/stall-logos/chinese-stall.png";
  if (normalized.includes("malay")) return "/stall-logos/malay-stall.png";
  return "/stall-logos/international-stall.png";
}

function renderCredit() {
  if (!state.account) {
    creditPanel.hidden = true;
    return;
  }

  const cycle = creditCycle();
  const upcomingSpend = highestOrderSpendPerDate(state.upcomingOrders, cycle);
  const wallet = parseMoneyValue(state.walletBalance);
  const projected = wallet - upcomingSpend;

  creditPanel.hidden = false;
  creditDaily.textContent = `${formatMoney(cycle.dailyCredit)} / workday`;
  creditDetails.textContent = `${formatDate(cycle.start)} to ${formatDate(cycle.end)} has ${cycle.workingDays} credited workdays. One payment per date; duplicates use the highest total.`;
  creditRefresh.textContent = `${cycle.calendarDaysLeft} day${cycle.calendarDaysLeft === 1 ? "" : "s"}`;
  creditUpcoming.textContent = formatMoney(upcomingSpend);
  creditProjected.textContent = formatMoney(projected);
}

function renderMenus() {
  if (!state.data) return;
  const lastDay = state.data.days[state.data.days.length - 1];
  const scanEnd = state.data.discoveredThrough;
  const scanCopy = scanEnd ? ` Direct-date scan checked through ${formatDate(scanEnd)}.` : "";
  const failureCopy = state.data.discovery?.failed
    ? ` ${state.data.discovery.failed} date${state.data.discovery.failed === 1 ? "" : "s"} could not be checked; Refresh to retry.`
    : "";
  statusEl.textContent = lastDay
    ? `Orders are available until ${formatDate(lastDay.date)}.${scanCopy}${failureCopy}`
    : `No order dates available.${scanCopy}${failureCopy}`;

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
        <p class="meta">${alreadyOrdered ? "Ordered" : `${day.products.length} option${day.products.length === 1 ? "" : "s"}`}</p>
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
    state.data = withoutHiddenMenuItems(await api(`/api/menus${refresh ? "?refresh=1" : ""}`, { headers: {} }));
    renderMenus();
    clearTimeout(state.menuRefreshTimer);
    state.menuRefreshTimer = setTimeout(() => loadMenus(false), state.data.refreshing ? 1500 : MENU_AUTO_REFRESH_MS);
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
  todayOrdersRefreshButton.disabled = true;
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
    todayOrdersRefreshButton.disabled = false;
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
    renderNotificationRules(data.rules);
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
  await Promise.all([
    loadWallet(),
    includeOrders ? loadOrders({ force: forceOrders }) : Promise.resolve()
  ]);
}

async function loadSession() {
  const data = await api("/api/session", { headers: {} });
  if (data.idleTimeoutMs) state.config.sessionIdleTimeoutMs = data.idleTimeoutMs;
  state.account = data.account;
  if (!state.account) {
    await loginWithRememberedCredentials();
  }
  renderAccount();
  renderBasket();
  recordActivity();
  afterFirstPaint(() => {
    refreshAccountData({ includeOrders: true, forceOrders: true });
  });
}

function resetSignedOutState(message = "Sign in to order lunch.") {
  state.account = null;
  state.rowenaNotificationKey = null;
  hideRowenaNotification();
  state.selections.clear();
  state.orderKeys.clear();
  state.upcomingOrders = [];
  state.orderedDates = new Set();
  state.walletBalance = "";
  state.ordersLoaded = false;
  state.ordersLoading = false;
  state.usageLoaded = false;
  state.usageLoading = false;
  accountStatus.textContent = message;
  renderAccount();
  walletBalance.textContent = "-";
  ordersList.innerHTML = "";
  todayOrdersList.innerHTML = "";
  todayOrdersCount.textContent = "0 meals";
  todayOrdersStatus.textContent = "Loading your cafeteria order...";
  usageList.innerHTML = "";
  usageStatus.textContent = "Recent SooDering activity.";
  renderCredit();
  renderBasket();
}

async function logout({ message, notifyServer = true } = {}) {
  clearTimeout(state.idleTimer);
  if (notifyServer) {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
    } catch {
      // Local state must still be cleared when the server session has expired.
    }
  }
  resetSignedOutState(message);
  await fillRememberedCredentials();
}

function scheduleIdleTimeout() {
  clearTimeout(state.idleTimer);
  if (!state.account) return;
  const remaining = Math.max(0, state.config.sessionIdleTimeoutMs - (Date.now() - state.lastActivityAt));
  state.idleTimer = setTimeout(() => {
    logout({ message: "Signed out after being inactive for too long." });
  }, remaining);
}

function recordActivity() {
  if (!state.account) return;
  state.lastActivityAt = Date.now();
  scheduleIdleTimeout();
}

async function bootstrap() {
  clearLegacyBrowserCredentials();
  try {
    state.config = { ...state.config, ...await api("/api/config", { headers: {} }) };
  } catch {
    // Safe defaults keep the login screen usable if configuration cannot load.
  }
  await fillRememberedCredentials();
  renderActiveTab();
  loadMenus();
  await loadSession();
}

refreshButton.addEventListener("click", async () => {
  await Promise.all([
    loadMenus(true),
    state.account ? loadOrders({ force: true }) : Promise.resolve()
  ]);
});

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
    let credentialWarning = "";
    try {
      if (rememberInput.checked) {
        const passwordStored = await rememberCredentials(username, password);
        if (!passwordStored && !window.sooderingCredentials?.available) {
          credentialWarning = "Your email was remembered, but this browser cannot securely save the password on this connection. Use HTTPS and enable the browser password manager.";
        }
      } else {
        await forgetCredentials();
      }
    } catch {
      credentialWarning = "Login succeeded, but the password could not be saved by the credential manager.";
    }
    state.account = data.account;
    recordActivity();
    renderAccount();
    afterFirstPaint(() => {
      refreshAccountData({ includeOrders: true, forceOrders: true });
    });
    if (credentialWarning) {
      showSystemNotification("Password not saved", credentialWarning, { tone: "warning", timeout: 12000 });
    }
  } catch (error) {
    accountStatus.textContent = error.message;
    showSystemNotification("Login unsuccessful", error.message);
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await logout();
});

usageRefreshButton.addEventListener("click", () => loadUsage({ force: true }));
rowenaEditorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveRowenaMessageButton.disabled = true;
  rowenaEditorStatus.textContent = "Saving...";
  try {
    const rules = [...notificationRules.querySelectorAll(".notification-rule")].map((row) => ({
      id: row.dataset.id,
      match: row.querySelector(".notification-match").value,
      title: row.querySelector(".notification-title").value,
      message: row.querySelector(".notification-message").value
    }));
    await api("/api/usage", {
      method: "POST",
      body: JSON.stringify({ rules })
    });
    rowenaEditorStatus.textContent = "All custom notifications saved.";
    state.rowenaNotificationKey = null;
    await showRowenaNotification();
  } catch (error) {
    rowenaEditorStatus.textContent = error.message;
  } finally {
    saveRowenaMessageButton.disabled = false;
  }
});
addNotificationRuleButton.addEventListener("click", () => addNotificationRule());
notificationRules.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-notification-rule");
  if (button) button.closest(".notification-rule").remove();
});
todayOrdersRefreshButton.addEventListener("click", () => loadOrders({ force: true }));
dismissRowenaNotification.addEventListener("click", attemptRowenaNotificationDismiss);
dismissSystemNotification.addEventListener("click", hideSystemNotification);

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
  const anchor = button.closest(".menu-item");
  const anchorTop = anchor?.getBoundingClientRect().top;

  const product = allProducts(state.data.days).find((item) => item.id === button.dataset.productId && item.date === button.dataset.date);
  if (!product) return;

  const existing = state.selections.get(product.date);
  if (existing?.id === product.id) {
    state.selections.delete(product.date);
  } else {
    state.selections.set(product.date, product);
  }
  renderBasket();
  if (anchor && Number.isFinite(anchorTop)) {
    requestAnimationFrame(() => {
      const movedBy = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(movedBy) > 1) window.scrollBy(0, movedBy);
    });
  }
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
  const confirmed = window.confirm(`Place these cafeteria reservations now?\n\n${summary}\n\nTime: ${state.config.defaultTimeSlots[0]}`);
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

for (const eventName of ["pointerdown", "keydown", "touchstart"]) {
  document.addEventListener(eventName, recordActivity, { passive: true });
}

bootstrap().catch((error) => {
  accountStatus.textContent = error.message || "Unable to start SooDering.";
});
setInterval(keepCafeteriaSessionAlive, KEEPALIVE_MS);
