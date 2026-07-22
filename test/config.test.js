const test = require("node:test");
const assert = require("node:assert/strict");
const { numberFromEnv, publicConfig } = require("../config");

test("uses bounded numeric configuration", () => {
  process.env.TEST_NUMBER = "42";
  assert.equal(numberFromEnv("TEST_NUMBER", 5, { min: 1, max: 100 }), 42);
  process.env.TEST_NUMBER = "999";
  assert.equal(numberFromEnv("TEST_NUMBER", 5, { min: 1, max: 100 }), 5);
  delete process.env.TEST_NUMBER;
});

test("public configuration excludes administrator and logging secrets", () => {
  const exposed = publicConfig();
  assert.equal("usageAdminEmail" in exposed, false);
  assert.equal("usageHashSecret" in exposed, false);
  assert.ok(exposed.sessionIdleTimeoutMs >= 60_000);
  assert.ok(exposed.defaultTimeSlots.length > 0);
});
