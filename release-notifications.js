const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function availableDates(days, today) {
  return [...new Set(days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date)
    && day.date >= today && day.products?.length).map((day) => day.date))].sort();
}

// Singapore is UTC+8 year round: 08:00 Singapore is 00:00 UTC.
function nextReleaseCheck(now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

function availableDateRange(dates) {
  if (!dates.length) return "No available dates.";
  const sorted = [...dates].sort();
  const format = (date) => new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric"
  }).format(new Date(`${date}T12:00:00+08:00`));
  return `Available dates: ${format(sorted[0])} to ${format(sorted.at(-1))}.`;
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
  const activeCampaigns = new Set();
  const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
  function preview(state, month, audience, days) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "") || !["subscribers", "customers"].includes(audience)) {
      throw Object.assign(new Error("Choose a valid month and recipient group."), { status: 400 });
    }
    const dates = availableDates(days, today()).filter((date) => date.startsWith(`${month}-`));
    const source = audience === "subscribers" ? Object.values(state.subscribers).filter((entry) => entry.active) : Object.values(state.customers || {});
    const eligible = [...new Map(source.filter((entry) => validEmail(entry.email)).map((entry) => [entry.email.toLowerCase(), entry])).values()];
    const recipients = eligible.filter((entry) => !state.announcements?.[month]?.[keyFor({ username: entry.email })]);
    const label = new Intl.DateTimeFormat("en-SG", { month: "long", year: "numeric", timeZone: "Asia/Singapore" }).format(new Date(`${month}-01T12:00:00+08:00`));
    const subject = `SooDering: ${label} lunch menu is available`;
    const message = `The new lunch menu for ${label} is now available.\n\n${availableDateRange(dates)}\n\nSign in to SooDering to view the menus and place your orders.`;
    const token = crypto.createHash("sha256").update(JSON.stringify({ month, audience, dates, emails: recipients.map((entry) => entry.email.toLowerCase()).sort() })).digest("hex");
    return { month, audience, dates, subject, message, token, recipients, recipientCount: recipients.length, skippedCount: eligible.length - recipients.length };
  }
  function publicCampaign(campaign) {
    return { id: campaign.id, month: campaign.month, audience: campaign.audience,
      status: campaign.status === "sending" && !activeCampaigns.has(campaign.id) ? "interrupted" : campaign.status,
      createdAt: campaign.createdAt, total: campaign.recipients.length,
      accepted: campaign.recipients.filter((entry) => entry.status === "accepted").length,
      failed: campaign.recipients.filter((entry) => entry.status === "failed").length,
      unknown: campaign.recipients.filter((entry) => entry.status === "unknown").length,
      pending: campaign.recipients.filter((entry) => entry.status === "pending").length };
  }
  async function deliverCampaign(id) {
    try {
      const campaign = await serial(async () => (await read()).campaigns[id]);
      for (let index = 0; index < campaign.recipients.length; index++) {
        const recipient = campaign.recipients[index];
        let status = "unknown";
        try {
          const response = await sendEmail({ email: recipient.email, username: recipient.username,
            subject: campaign.subject, message: campaign.message });
          status = response.ok ? "accepted" : "failed";
        } catch { /* A lost response must not trigger another send. */ }
        await serial(async () => {
          const state = await read();
          state.campaigns[id].recipients[index].status = status;
          await save(state);
        });
      }
      await serial(async () => { const state = await read(); state.campaigns[id].status = "completed"; await save(state); });
    } catch { console.warn("Manual announcement stopped. Check announcement delivery records before retrying."); }
    finally { activeCampaigns.delete(id); }
  }
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
    recordCustomer: (account) => serial(async () => {
      if (!enabled || !account || !validEmail(account.username)) return;
      const state = await read();
      state.customers ||= {};
      const key = keyFor(account);
      state.customers[key] = { email: account.username, username: account.name || account.username,
        firstRecordedAt: state.customers[key]?.firstRecordedAt || new Date().toISOString() };
      await save(state);
    }),
    adminList: () => serial(async () => {
      const state = await read();
      return { enabled,
        subscribers: Object.values(state.subscribers).filter((entry) => entry.active).map(({ email, username }) => ({ email, username })).sort((a, b) => a.email.localeCompare(b.email)),
        customerCount: Object.keys(state.customers || {}).length,
        campaigns: Object.values(state.campaigns || {}).map(publicCampaign).reverse() };
    }),
    previewAnnouncement: (month, audience, days) => serial(async () => {
      const { recipients, ...result } = preview(await read(), month, audience, days);
      return result;
    }),
    announce: async (month, audience, days, token) => {
      const result = await serial(async () => {
        if (!enabled) throw Object.assign(new Error("Email notifications are not configured on this server."), { status: 503 });
        const state = await read();
        const planned = preview(state, month, audience, days);
        if (planned.token !== token) throw Object.assign(new Error("The recipient list or available dates changed. Preview the announcement again."), { status: 409 });
        if (!planned.dates.length || !planned.recipientCount) throw Object.assign(new Error("No available dates or unsent recipients for this announcement."), { status: 400 });
        const id = crypto.randomUUID();
        const campaign = { id, month, audience, subject: planned.subject, message: planned.message,
          createdAt: new Date().toISOString(), status: "sending",
          recipients: planned.recipients.map(({ email, username }) => ({ email, username, status: "pending" })) };
        state.announcements ||= {};
        state.announcements[month] ||= {};
        for (const recipient of campaign.recipients) state.announcements[month][keyFor({ username: recipient.email })] = id;
        state.campaigns ||= {};
        state.campaigns[id] = campaign;
        activeCampaigns.add(id);
        try { await save(state); } catch (error) { activeCampaigns.delete(id); throw error; }
        return publicCampaign(campaign);
      });
      void deliverCampaign(result.id);
      return result;
    },
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
        try {
          const response = await sendEmail({ email: entry.email, username: entry.username,
              subject: "SooDering: new lunch orders available",
              message: `New lunch orders are now available.\n\n${availableDateRange(released)}\n\nSign in to SooDering to view the menus and place your orders.`
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

module.exports = { createReleaseNotifications, availableDates, nextReleaseCheck };
