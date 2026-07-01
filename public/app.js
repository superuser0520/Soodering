const DEFAULT_TIME_SLOTS = [
  "11:30 - 11:55",
  "12:00 - 12:25",
  "12:30 - 12:55",
  "13:00 - 13:25",
  "13:30 - 13:55"
];
const CREDENTIALS_KEY = "soodering.credentials";
const LEGACY_CREDENTIALS_KEY = "shimanoLunch.credentials";

const state = {
  account: null,
  data: null,
  activeTab: "menu",
  menuFilter: "all",
  selections: new Map(),
  upcomingOrders: []
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
const ordersList = document.querySelector("#ordersList");
const ordersTabCount = document.querySelector("#ordersTabCount");
const cartStatus = document.querySelector("#cartStatus");
const cartList = document.querySelector("#cartList");
const clearSelectionButton = document.querySelector("#clearSelectionButton");
const placeOrderButton = document.querySelector("#placeOrderButton");
const menuFilter = document.querySelector(".menu-filter");
const tabButtons = document.querySelectorAll(".tab-button");
const menuView = document.querySelector("#menuView");
const ordersView = document.querySelector("#ordersView");

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
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

function allProducts(days) {
  return days.flatMap((day) => day.products.map((product) => ({ ...product, label: day.label })));
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
}

function renderWallet(wallet) {
  walletBalance.textContent = wallet.balance || "-";
}

function renderActiveTab() {
  tabButtons.forEach((button) => {
    button.classList.toggle("selected", button.dataset.tab === state.activeTab);
  });
  menuView.hidden = state.activeTab !== "menu";
  ordersView.hidden = state.activeTab !== "orders";
}

function renderOrders(payload) {
  const today = todayIso();
  const upcoming = payload.orders
    .filter((order) => order.deliveryDate && order.deliveryDate >= today)
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));

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
  renderMenus();
}

function selectedItems() {
  return [...state.selections.values()].sort((a, b) => a.date.localeCompare(b.date));
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

function renderProduct(product) {
  const image = product.imageUrl
    ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" loading="lazy">`
    : `<span class="food-logo">🍽️</span>`;

  return `
    <li class="menu-item">
      <a class="thumb" href="${escapeHtml(product.productUrl)}" target="_blank" rel="noreferrer">${image}</a>
      <div class="menu-copy">
        <p class="stall">${escapeHtml(product.stall)}</p>
        <h3>${escapeHtml(product.item)}</h3>
        <p class="meta">${escapeHtml(product.price)}${product.stock ? ` · ${escapeHtml(product.stock)}` : ""}</p>
        ${product.description ? `<p class="description">${escapeHtml(product.description)}</p>` : ""}
      </div>
      <button class="secondary pick-button" type="button" data-product-id="${escapeHtml(product.id)}" data-date="${escapeHtml(product.date)}" aria-label="Pick meal">+</button>
    </li>
  `;
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
  refreshButton.disabled = true;
  statusEl.textContent = refresh ? "Refreshing menus..." : "Loading cafeteria menus...";

  try {
    state.data = await api(`/api/menus${refresh ? "?refresh=1" : ""}`, { headers: {} });
    renderMenus();
  } catch (error) {
    statusEl.textContent = error.message;
    menusEl.innerHTML = "";
  } finally {
    refreshButton.disabled = false;
  }
}

async function refreshAccountData() {
  if (!state.account) return;
  try {
    const [wallet, orders] = await Promise.all([
      api("/api/wallet", { headers: {} }),
      api("/api/orders", { headers: {} })
    ]);
    renderWallet(wallet);
    renderOrders(orders);
  } catch (error) {
    ordersList.innerHTML = `<p class="meta">${escapeHtml(error.message)}</p>`;
  }
}

async function loadSession() {
  const data = await api("/api/session", { headers: {} });
  state.account = data.account;
  renderAccount();
  renderBasket();
  await refreshAccountData();
}

refreshButton.addEventListener("click", () => loadMenus(true));

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab;
    renderActiveTab();
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
    await refreshAccountData();
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
  renderAccount();
  walletBalance.textContent = "-";
  ordersList.innerHTML = "";
  fillRememberedCredentials();
  renderBasket();
});

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
    await refreshAccountData();
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

placeOrderButton.addEventListener("click", async () => {
  const selections = selectedItems();
  if (selections.length === 0) return;

  const summary = selections.map((item) => `${formatDate(item.date)}: ${item.stall} - ${item.item}`).join("\n");
  const confirmed = window.confirm(`Place these cafeteria reservations now?\n\n${summary}\n\nTime: 11:30 - 11:55`);
  if (!confirmed) return;

  placeOrderButton.disabled = true;
  cartStatus.textContent = "Placing selected orders...";
  try {
    const result = await api("/api/order/bulk", {
      method: "POST",
      body: JSON.stringify({
        selections: selections.map((item) => ({
          productId: item.id,
          date: item.date,
          quantity: 1
        })),
        timeSlot: DEFAULT_TIME_SLOTS[0],
        notes: ""
      })
    });
    state.selections.clear();
    cartStatus.textContent = "Order placed successfully.";
    renderBasket();
    renderOrders({ orders: result.orders });
    await refreshAccountData();
  } catch (error) {
    cartStatus.textContent = error.message;
  } finally {
    placeOrderButton.disabled = false;
  }
});

fillRememberedCredentials();
renderActiveTab();
loadSession().catch(() => {});
loadMenus();
