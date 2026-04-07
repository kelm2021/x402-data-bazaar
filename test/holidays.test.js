const assert = require("node:assert/strict");
const test = require("node:test");

const holidaysRouter = require("../routes/holidays");

test("loadHolidayIndex falls back to a deterministic US calendar when upstream fetch fails", async () => {
  const holidayIndex = await holidaysRouter.loadHolidayIndex(
    "US",
    "2026-07-03",
    async () => {
      throw new Error("offline");
    },
  );

  assert.ok(holidayIndex);
  assert.equal(holidayIndex.source, "Deterministic fallback calendar");
  assert.equal(holidayIndex.holidayMap.get("2026-07-03")?.name, "Independence Day (observed)");
  assert.equal(holidayIndex.holidayMap.get("2026-07-04")?.name, "Independence Day");
});
