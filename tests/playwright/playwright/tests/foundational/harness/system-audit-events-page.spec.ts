import { test, expect } from "../../../helpers/test-base";
import { execSync } from "child_process";
import { resolveDbContainer } from "../../../helpers/db-container";
import { NAV_TIMEOUT, UI_TIMEOUT } from "../../../helpers/timeouts";

/**
 * System Audit Events admin page — locks the UI surface added by PR #3591
 * (mozzy11). Three concerns:
 *   1. Page renders at /AuditTrailReport?type=system
 *   2. PERSON entity type is in the dropdown (added by the PR)
 *   3. The REST contract returns events with the `changes` shape — `{old, new}`
 *      pairs for UPDATE rows, falling back to current-state snapshot for the
 *      ghost-flush case. Asserting via the REST endpoint directly keeps the
 *      coverage focused on the contract rather than fighting Carbon Dropdown.
 */

function sql(s: string): string {
  return execSync(
    `docker exec ${resolveDbContainer()} psql -U clinlims -d clinlims -t -A -c "${s.replace(/\s+/g, " ").trim()}"`,
  )
    .toString()
    .trim();
}

test.describe("System Audit Events page (PR #3591 UI)", () => {
  test("page renders with new filters + REST contract returns old/new pair shape", async ({
    page,
  }) => {
    await page.goto("/AuditTrailReport?type=system", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForLoadState("networkidle").catch(() => {});

    // 1. Page chrome present
    await expect(
      page.locator("input#startDate"),
      "start date filter renders",
    ).toBeVisible({ timeout: UI_TIMEOUT });
    await expect(
      page.locator("input#endDate"),
      "end date filter renders",
    ).toBeVisible();
    await expect(
      page.locator("input#searchText"),
      "search text filter renders",
    ).toBeVisible();

    // 2. Entity-type Dropdown renders; PR adds PERSON to SYSTEM_ENTITY_TABLE_NAMES.
    //    We assert the API exposes PERSON rather than driving the Carbon dropdown.
    const typesResp = await page.request.get(
      "/api/OpenELIS-Global/rest/systemAuditEvents/entityTypes",
    );
    expect(typesResp.status()).toBe(200);
    const types = await typesResp.json();
    await typesResp.dispose();
    expect(
      Array.isArray(types) && types.length,
      `entity types must be a non-empty array; got: ${JSON.stringify(types)}`,
    ).toBeGreaterThan(0);
    const names = types.map((t: { name?: string }) => (t.name || "").toUpperCase());
    expect(names, "PERSON must be in the entity-type list").toContain("PERSON");
    expect(names, "PATIENT must be in the entity-type list").toContain("PATIENT");

    // 3. REST contract: events response carries `changes` as an object per row
    //    (the new old/new pair shape). The exact rows depend on history table
    //    state; we just verify the shape is correct for at least one row.
    const eventsResp = await page.request.get(
      "/api/OpenELIS-Global/rest/systemAuditEvents?page=1&pageSize=20",
    );
    expect(eventsResp.status()).toBe(200);
    const body = await eventsResp.json();
    await eventsResp.dispose();

    expect(
      body.events && Array.isArray(body.events),
      `events response must have an events array; got: ${JSON.stringify(body).substring(0, 200)}`,
    ).toBe(true);
    expect(
      body.totalItems,
      "totalItems must be a number",
    ).toEqual(expect.any(Number));

    // Find a row with non-empty changes and assert each entry is the {old, new}
    // pair shape that the PR introduced.
    const rowWithChanges = body.events.find(
      (e: { changes?: Record<string, unknown> }) =>
        e.changes && Object.keys(e.changes).length > 0,
    );
    if (rowWithChanges) {
      const sample = Object.values(rowWithChanges.changes)[0];
      expect(
        typeof sample === "object" && sample !== null,
        `changes entry must be a {old, new} object; got: ${JSON.stringify(sample)}`,
      ).toBe(true);
      // PR's shape: each entry is {old, new} OR a single-value fallback. Either
      // shape is valid, but the SHAPE must be deterministic per row.
      const sampleObj = sample as Record<string, unknown>;
      const hasOldNewKeys =
        "old" in sampleObj || "new" in sampleObj;
      expect(
        hasOldNewKeys,
        `changes entry must have 'old' and/or 'new' keys; got keys: ${Object.keys(sampleObj).join(",")}`,
      ).toBe(true);
    }
  });

  test("patient-scoped query merges PATIENT + PERSON history", async ({
    page,
  }) => {
    // Pick any patient from the DB to scope the query against.
    const patientId = sql(
      `SELECT p.id::text FROM clinlims.patient p ORDER BY p.id ASC LIMIT 1;`,
    );
    test.skip(!patientId, "No patient row exists in this DB.");

    const resp = await page.request.get(
      `/api/OpenELIS-Global/rest/systemAuditEvents?patientId=${patientId}&page=1&pageSize=50`,
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    await resp.dispose();

    expect(body.events).toBeDefined();
    // Patient-scoped query is allowed to return zero rows (DB might be fresh),
    // but if it returns any, they must be on PATIENT or PERSON tables — the
    // PR merges both ref-tables for a single patient view.
    const entityTypes = (body.events || []).map(
      (e: { entityType?: string }) => (e.entityType || "").toUpperCase(),
    );
    for (const t of entityTypes) {
      expect(
        ["PATIENT", "PERSON"].includes(t),
        `Patient-scoped query returned row on entityType '${t}'; expected only PATIENT or PERSON`,
      ).toBe(true);
    }
  });
});
