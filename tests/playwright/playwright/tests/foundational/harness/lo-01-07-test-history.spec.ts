import { test, expect } from "../../../helpers/test-base";
import { execSync } from "child_process";
import { resolveDbContainer } from "../../../helpers/db-container";
import { NAV_TIMEOUT, UI_TIMEOUT } from "../../../helpers/timeouts";

/**
 * LO-01-07 — Patient Test History page.
 *
 * UAT Round 2: "See how the UI renders and make sure we test the
 * workflows properly" + CSV note "Screen resolution for smaller screens
 * needs to be checked."
 */

interface SeededPatient {
  id: string;
  firstName: string;
  lastName: string;
}

function fetchAnyPatient(): SeededPatient | null {
  const sql = `
    SELECT p.id::text || '|' || pe.first_name || '|' || pe.last_name
    FROM clinlims.patient p
    JOIN clinlims.person pe ON p.person_id = pe.id
    ORDER BY p.id ASC LIMIT 1;
  `;
  const out = execSync(
    `docker exec ${resolveDbContainer()} psql -U clinlims -d clinlims -t -A -c "${sql.replace(/\s+/g, " ").trim()}"`,
  )
    .toString()
    .trim();
  if (!out) return null;
  const [id, firstName, lastName] = out.split("|");
  return { id, firstName, lastName };
}

const SMALL_SCREEN_VIEWPORTS = [
  { name: "mobile (375x812)", width: 375, height: 812 },
  { name: "tablet (768x1024)", width: 768, height: 1024 },
];

test.describe("LO-01-07: patient test history page", () => {
  test("workflow — page loads with patient header at /PatientResults/:id", async ({
    page,
  }) => {
    const seed = fetchAnyPatient();
    test.skip(
      !seed,
      "No patient rows in DB — re-run after seeding a patient.",
    );

    await page.goto(`/PatientResults/${seed!.id}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForLoadState("networkidle").catch(() => {});

    await expect(
      page.getByText(seed!.firstName, { exact: false }),
      `Patient first name '${seed!.firstName}' should appear on the test history page`,
    ).toBeVisible({ timeout: UI_TIMEOUT });
    await expect(
      page.getByText(seed!.lastName, { exact: false }),
      `Patient last name '${seed!.lastName}' should appear on the test history page`,
    ).toBeVisible({ timeout: UI_TIMEOUT });
  });

  for (const vp of SMALL_SCREEN_VIEWPORTS) {
    test(`smaller-screen rendering — patient header still visible at ${vp.name}`, async ({
      page,
    }) => {
      const seed = fetchAnyPatient();
      test.skip(!seed, "No patient rows in DB.");

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/PatientResults/${seed!.id}`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      });
      await page.waitForLoadState("networkidle").catch(() => {});

      await expect(
        page.getByText(seed!.firstName, { exact: false }),
        `Patient first name should still be visible at ${vp.name}`,
      ).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(
        page.getByText(seed!.lastName, { exact: false }),
        `Patient last name should still be visible at ${vp.name}`,
      ).toBeVisible({ timeout: UI_TIMEOUT });
    });
  }
});
