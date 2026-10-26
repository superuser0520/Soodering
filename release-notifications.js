const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function availableDates(days, today) {
  return [...new Set(days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date)
    && day.date >= today && day.products?.length).map((day) => day.date))].sort();
}

function createReleaseNotifications({ file, webhookUrl, fetchImpl = fetch,
  today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) }) {
  let chain = Promise.resolve();
  const enabled = Boolean(webhookUrl);
  const serial = (fn) => {
    const next = chain.then(fn);
    chain = next.catch(() => {});
    return next;
  };
  async function read() {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return { subscribers: {} }; throw error; }
  }
  async function save(state) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, file);
  }
  const keyFor = (account) => crypto.createHash("sha256").update(account.username.toLowerCase()).digest("hex");
  async function sendEmail(payload) {
    const response = await fetchImpl(webhookUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    });
    await response.body?.cancel();
    return response;
  }
  return {
    enabled,
    sendTest: async (account) => {
      if (!enabled) throw Object.assign(new Error("Email notifications are not configured. Set POWER_AUTOMATE_RELEASE_URL on the server and restart the service."), { status: 503 });
      let response;
      try {
        response = await sendEmail({ email: account.username, username: account.name || account.username,
          subject: "SooDering: test email",
          message: "This is a manual test of SooDering new menu email notifications.\n\nIf you received this email, your Power Automate email connection is working.\n\nNo new lunch release is being announced by this test." });
      } catch {
        throw Object.assign(new Error("The test email response could not be confirmed. Check Power Automate run history and your inbox before trying again."), { status: 502 });
      }
      if (!response.ok) throw Object.assign(new Error(`Power Automate rejected the test email (HTTP ${response.status}). Check the trigger URL and flow run history.`), { status: 502 });
      return { message: `Power Automate accepted the test email request for ${account.username}. Check your inbox and flow run history.` };
    },
    status: (account) => serial(async () => ({ enabled, subscribed: Boolean((await read()).subscribers[keyFor(account)]?.active) })),
    hasSubscribers: () => serial(async () => Object.values((await read()).subscribers).some((entry) => entry.active)),
    subscribe: (account, active, days) => serial(async () => {
      if (active && !enabled) throw Object.assign(new Error("Email notifications are not configured on this server."), { status: 503 });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.username)) {
        throw Object.assign(new Error("Your signed-in account must have a valid email address."), { status: 400 });
      }
      const state = await read();
      const key = keyFor(account);
      const previous = state.subscribers[key];
      state.subscribers[key] = {
        email: account.username, username: account.name || account.username, active,
        seen: [...new Set([...(previous?.seen || []), ...availableDates(days, today())])],
        deliveries: previous?.deliveries || []
      };
      await save(state);
      return { enabled, subscribed: active };
    }),
    observe: (days) => serial(async () => {
      if (!enabled) return;
      const state = await read();
      const dates = availableDates(days, today());
      for (const entry of Object.values(state.subscribers)) {
        if (!entry.active) continue;
        const released = dates.filter((date) => !entry.seen.includes(date));
        if (!released.length) continue;
        const delivery = { dates: released, at: new Date().toISOString(), status: "pending" };
        entry.seen.push(...released);
        entry.deliveries.push(delivery);
        // Persist before sending: an ambiguous HTTP result must never send twice.
        await save(state);
        const labels = released.map((date) => new Intl.DateTimeFormat("en-SG", {
          timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short", year: "numeric"
        }).format(new Date(`${date}T12:00:00+08:00`)));
        try {
          const response = await sendEmail({ email: entry.email, username: entry.username,
              subject: "SooDering: new lunch orders available",
              message: `New lunch orders are now available for:\n\n${labels.join("\n")}\n\nSign in to SooDering to view the menus and place your orders.`
          });
          delivery.status = response.ok ? "accepted" : "failed";
          delivery.httpStatus = response.status;
        } catch {
          delivery.status = "unknown";
        }
        await save(state);
        if (delivery.status !== "accepted") console.warn("Release email was not confirmed; inspect release-notifications.json. It will not be sent again automatically.");
      }
    })
  };
}

module.exports = { createReleaseNotifications, availableDates };
