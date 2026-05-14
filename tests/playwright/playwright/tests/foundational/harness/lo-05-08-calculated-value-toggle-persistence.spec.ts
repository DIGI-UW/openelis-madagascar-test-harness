import { expect, test } from "@playwright/test";

/**
 * LO-05-08 / OGC-655 — the Calculated Value rule editor's "Toggle Rule"
 * control had no persistence path: clicking it only mutated local React
 * state and the GET endpoint clobbered `toggled` back to false on every
 * read. A lab admin could "deactivate" a rule, see it visually collapse,
 * and the rule would keep firing on real results.
 *
 * Fix surfaces two BE endpoints:
 *   POST /rest/deactivate-test-calculation/{id}
 *   POST /rest/activate-test-calculation/{id}
 * and GET /rest/test-calculations now seeds `toggled` from the persisted
 * `active` flag.
 *
 * This spec exercises the API round-trip end-to-end. It is layered above
 * the FE vitest (which locks the click-handler contract) and the BE
 * MockMvc test (which locks the persistence contract) — together they
 * cover the three layers the bug touched.
 */

const ENDPOINT_LIST = "/api/OpenELIS-Global/rest/test-calculations";
const ENDPOINT_DEACTIVATE = (id: number) =>
  `/api/OpenELIS-Global/rest/deactivate-test-calculation/${id}`;
const ENDPOINT_ACTIVATE = (id: number) =>
  `/api/OpenELIS-Global/rest/activate-test-calculation/${id}`;

async function fetchRules(request: ReturnType<typeof test.extend> | any) {
  const res = await request.get(ENDPOINT_LIST);
  expect(res.status(), "calculation list endpoint must be reachable").toBe(200);
  const body = await res.json();
  await res.dispose();
  return body as Array<{ id: number; active: boolean; toggled: boolean }>;
}

test.describe("LO-05-08 / OGC-655: Toggle Rule round-trip persistence", () => {
  test("toggled mirrors persisted active across deactivate → reload", async ({
    page,
  }) => {
    const rules = await fetchRules(page.request);
    test.skip(
      rules.length === 0,
      "no calculated-value rules seeded on this instance; nothing to round-trip",
    );

    const target = rules.find((r) => r.active === true) || rules[0];

    // Snapshot original state so we can restore it whether the test passes
    // or fails — leaving the instance with a deactivated rule would surprise
    // anyone running the next spec or the UAT harness.
    const originalActive = target.active;

    try {
      const deactivate = await page.request.post(ENDPOINT_DEACTIVATE(target.id));
      expect(deactivate.status(), "deactivate must succeed").toBe(200);
      await deactivate.dispose();

      const afterDeactivate = await fetchRules(page.request);
      const reloaded = afterDeactivate.find((r) => r.id === target.id);
      expect(reloaded, "rule must still exist after deactivate").toBeDefined();
      expect(reloaded!.active, "OGC-655: active must flip to false").toBe(false);
      expect(
        reloaded!.toggled,
        "OGC-655: GET must seed toggled from active so reload reflects persisted state",
      ).toBe(false);

      const reactivate = await page.request.post(ENDPOINT_ACTIVATE(target.id));
      expect(reactivate.status(), "activate must succeed").toBe(200);
      await reactivate.dispose();

      const afterActivate = await fetchRules(page.request);
      const flipped = afterActivate.find((r) => r.id === target.id);
      expect(flipped!.active, "OGC-655: activate must flip back to true").toBe(true);
      expect(flipped!.toggled, "OGC-655: toggled must follow active back to true").toBe(true);
    } finally {
      // Restore whatever the rule's active flag was when we arrived.
      const restoreUrl = originalActive
        ? ENDPOINT_ACTIVATE(target.id)
        : ENDPOINT_DEACTIVATE(target.id);
      const cleanup = await page.request.post(restoreUrl);
      await cleanup.dispose().catch(() => {});
    }
  });

  test("unknown rule id returns 404 (no silent swallow)", async ({ page }) => {
    // Pre-OGC-655 the deactivate endpoint silently returned 200 for any id
    // because the catch block swallowed every error. Lock the new behavior.
    const bogus = 99999999;
    const res = await page.request.post(ENDPOINT_DEACTIVATE(bogus));
    expect(res.status(), "missing rule must be 404, not silent 200").toBe(404);
    await res.dispose();
  });
});
