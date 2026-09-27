const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

test("quick weekday orders choose each date's first eligible stall and skip ordered dates and weekends", () => {
  const app = readFileSync(require.resolve("../public/app.js"), "utf8");
  const selector = app.match(/function weekdayProductsForStalls\(stallNames\) \{[\s\S]*?\n\}/)[0];
  const weekday = app.match(/function isWeekday\(date\) \{[\s\S]*?\n\}/)[0];
  const meal = (stall, item = "Chicken", id = stall) => ({ stall: `${stall} Stall`, title: item, item, id });
  const state = {
    config: { quickOrderExcludedItems: "economic rice|nasi padang|vegetarian set" },
    orderedDates: new Set(["2026-09-28"]),
    data: { days: [
      { date: "2026-09-28", products: [meal("Chinese"), meal("Malay")] },
      { date: "2026-09-29", products: [meal("International"), meal("Chinese"), meal("Malay")] },
      { date: "2026-09-30", products: [meal("International"), meal("Chinese", "Economic Rice"), meal("Malay", "Nasi Padang")] },
      { date: "2026-10-01", products: [meal("Malay")] },
      { date: "2026-10-02", products: [meal("Chinese")] },
      { date: "2026-10-03", products: [meal("Malay"), meal("Chinese")] }
    ] }
  };
  const context = vm.createContext({ state });
  vm.runInContext(`${weekday}\n${selector}`, context);
  const selected = (priorities) => Array.from(context.weekdayProductsForStalls(priorities.map((name) => `${name} Stall`)), (meal) => meal.id);
  assert.deepEqual(selected(["Malay", "International"]), ["Malay", "International", "Malay"]);
  assert.deepEqual(selected(["Chinese", "International", "Malay"]), ["Chinese", "International", "Malay", "Chinese"]);
});
