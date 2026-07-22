const path = require("node:path");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const SG_PUBLIC_HOLIDAYS = [
  "2026-01-01", "2026-02-17", "2026-02-18", "2026-03-21", "2026-04-03",
  "2026-05-01", "2026-05-27", "2026-05-31", "2026-06-01", "2026-08-09",
  "2026-08-10", "2026-11-08", "2026-11-09", "2026-12-25", "2027-01-01",
  "2027-02-06", "2027-02-07", "2027-02-08", "2027-03-10", "2027-03-26",
  "2027-05-01", "2027-05-17", "2027-05-20", "2027-08-09", "2027-10-28",
  "2027-12-25"
];

function numberFromEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function listFromEnv(name, fallback) {
  const value = process.env[name];
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : fallback;
}

const config = {
  port: numberFromEnv("PORT", 3000, { min: 1, max: 65535 }),
  host: process.env.HOST || "127.0.0.1",
  siteOrigin: process.env.CAFETERIA_ORIGIN || "https://ssip-cafeteria.whew.life",
  menuCacheMs: numberFromEnv("MENU_CACHE_MS", 5 * 60 * 1000),
  sessionIdleTimeoutMs: numberFromEnv("SESSION_IDLE_TIMEOUT_MS", 30 * 60 * 1000, { min: 60_000 }),
  sessionCookieMaxAgeMs: numberFromEnv("SESSION_COOKIE_MAX_AGE_MS", 24 * 60 * 60 * 1000, { min: 60_000 }),
  usageAdminEmail: (process.env.USAGE_ADMIN_EMAIL || "soolihjing@shimano.com.sg").toLowerCase(),
  usageLogMaxBytes: numberFromEnv("USAGE_LOG_MAX_BYTES", 2 * 1024 * 1024, { min: 1024 }),
  usageLogRetentionDays: numberFromEnv("USAGE_LOG_RETENTION_DAYS", 30, { min: 1, max: 365 }),
  usageHashSecret: process.env.USAGE_HASH_SECRET || "soodering-local-usage",
  monthlyCredit: numberFromEnv("MONTHLY_CREDIT", 100),
  defaultTimeSlots: listFromEnv("DEFAULT_TIME_SLOTS", [
    "11:30 - 11:55",
    "12:00 - 12:25",
    "12:30 - 12:55",
    "13:00 - 13:25",
    "13:30 - 13:55"
  ]),
  quickOrderExcludedItems: process.env.QUICK_ORDER_EXCLUDED_ITEMS || "economic rice|nasi padang|vegetarian set",
  hiddenMenuItems: listFromEnv("HIDDEN_MENU_ITEMS", ["vegetarian set", "economic rice set", "nasi padang set"]),
  publicHolidays: listFromEnv("PUBLIC_HOLIDAYS", SG_PUBLIC_HOLIDAYS)
};

function publicConfig() {
  return {
    monthlyCredit: config.monthlyCredit,
    defaultTimeSlots: config.defaultTimeSlots,
    quickOrderExcludedItems: config.quickOrderExcludedItems,
    hiddenMenuItems: config.hiddenMenuItems,
    publicHolidays: config.publicHolidays,
    sessionIdleTimeoutMs: config.sessionIdleTimeoutMs
  };
}

module.exports = { config, numberFromEnv, publicConfig };
