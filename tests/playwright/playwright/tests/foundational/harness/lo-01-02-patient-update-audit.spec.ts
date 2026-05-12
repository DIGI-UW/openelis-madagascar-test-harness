import { test, expect } from "../../../helpers/test-base";
import { execSync } from "child_process";
import { resolveDbContainer } from "../../../helpers/db-container";
import {
  fillCarbonInput,
  clickCarbonRadio,
  fillCarbonDatePicker,
  clickCarbonToggle,
} from "../../../helpers/carbon-form";
import { UI_TIMEOUT, LONG_TIMEOUT, NAV_TIMEOUT } from "../../../helpers/timeouts";

const SUFFIX = Date.now().toString(36).replace(/[0-9]/g, "") || "x";
const FIRST_NAME = `Aud${SUFFIX}`;
const LAST_NAME = `Trl${SUFFIX}`;
const INITIAL_PHONE = "+261 37 11 111 11";
const UPDATED_PHONE = "+261 38 22 222 22";
const UPDATED_GPS_LAT = "-18.111111";
const UPDATED_GPS_LONG = "47.222222";

function sql(s: string): string {
  return execSync(
    `docker exec ${resolveDbContainer()} psql -U clinlims -d clinlims -t -A -c "${s.replace(/\s+/g, " ").trim()}"`,
  )
    .toString()
    .trim();
}

test.describe("LO-01-02: patient update writes history rows", () => {
  test("create → edit → save: history table records the update + the changes blob carries the edited fields", async ({
    page,
  }) => {
    test.setTimeout(LONG_TIMEOUT * 2);

    // ----- 1. CREATE a patient via the UI form ------------------------
    await page.goto("/PatientManagement", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.locator("#newPatient").click();
    await expect(page.locator('input[name="firstName"]')).toBeVisible({ timeout: UI_TIMEOUT });

    await fillCarbonInput({ page, selector: "input#firstName" }, FIRST_NAME);
    await fillCarbonInput({ page, selector: "input#lastName" }, LAST_NAME);
    await fillCarbonInput({ page, selector: "input#primaryPhone" }, INITIAL_PHONE);
    await clickCarbonRadio(page, "radio-1", { commitFocusSelector: "input#date-picker-default-id" });
    await fillCarbonDatePicker(page, "1990-05-15");

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/rest/PatientManagement") && r.request().method() === "POST",
        { timeout: LONG_TIMEOUT },
      ),
      page.locator("#submit").click(),
    ]);
    expect(createResp.status(), `create POST should succeed; body: ${await createResp.text()}`).toBeLessThan(400);
    await page.waitForTimeout(1000);

    const patientId = sql(
      `SELECT p.id::text FROM clinlims.patient p JOIN clinlims.person pe ON p.person_id = pe.id WHERE pe.first_name = '${FIRST_NAME}' AND pe.last_name = '${LAST_NAME}' ORDER BY p.id DESC LIMIT 1;`,
    );
    expect(patientId, "Patient row should exist after create").toMatch(/^\d+$/);
    const personId = sql(
      `SELECT pe.id::text FROM clinlims.person pe JOIN clinlims.patient p ON p.person_id = pe.id WHERE p.id = ${patientId} LIMIT 1;`,
    );

    // ----- 2. Re-open the patient via the Search tab + RadioButton ----
    await page.goto("/PatientManagement", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForLoadState("networkidle").catch(() => {});

    // Default tab is "Search for Patient" (#searchPatient is active). Fill
    // the SearchPatientForm's lastName field and submit.
    await fillCarbonInput({ page, selector: "input#lastName" }, LAST_NAME);
    await page.locator('[data-cy="searchPatientButton"]').click();
    await page.waitForTimeout(3000);

    // Click the RadioButton on the row whose Carbon-assigned id matches our
    // patientId. SearchPatientForm renders <RadioButton id={row.id} ...> per
    // result; row.id is the patient PK.
    await clickCarbonRadio(page, patientId, {
      commitFocusSelector: "input#date-picker-default-id",
    });
    await page.waitForTimeout(2000);

    // Now we're on the CreatePatientForm with the patient loaded. firstName
    // is the create-form's input now (search tab is no longer active).
    await expect(page.locator('input[name="firstName"]')).toHaveValue(FIRST_NAME, { timeout: UI_TIMEOUT });

    // Toggle the edit lock open via the Carbon Toggle helper.
    await clickCarbonToggle(page, "patient-edit-toggle");

    // Change primaryPhone
    await fillCarbonInput({ page, selector: "input#primaryPhone" }, UPDATED_PHONE);

    // Open the Additional Information accordion and set GPS
    await page.getByRole("button", { name: /additional information/i }).click();
    if (await page.locator("#gpsLatitude").isVisible().catch(() => false)) {
      await fillCarbonInput({ page, selector: "#gpsLatitude" }, UPDATED_GPS_LAT);
      await fillCarbonInput({ page, selector: "#gpsLongitude" }, UPDATED_GPS_LONG);
    }

    const [updateResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/rest/PatientManagement") && r.request().method() === "POST",
        { timeout: LONG_TIMEOUT },
      ),
      page.locator("#submit").click(),
    ]);
    expect(updateResp.status(), `update POST should succeed; body: ${await updateResp.text()}`).toBeLessThan(400);
    await page.waitForTimeout(1500);

    // ----- 3. Verify the DB actually got the new values ---------------
    const dbState = sql(
      `SELECT pe.primary_phone || '|' || COALESCE(pe.gps_latitude::text,'') || '|' || COALESCE(pe.gps_longitude::text,'') FROM clinlims.person pe WHERE pe.id = ${personId};`,
    );
    expect(dbState, `Person ${personId} should reflect the edit; got '${dbState}'`).toContain(UPDATED_PHONE);

    // ----- 4. Verify the history table captured the UPDATE -----------
    const historyRows = sql(
      `SELECT h.id::text || '|' || h.activity || '|' || COALESCE(LENGTH(h.changes)::text,'null') FROM clinlims.history h LEFT JOIN clinlims.reference_tables rt ON rt.id::numeric = h.reference_table WHERE (rt.name='PERSON' AND h.reference_id::text = '${personId}') OR (rt.name='PATIENT' AND h.reference_id::text = '${patientId}') ORDER BY h.timestamp DESC;`,
    );
    expect(
      historyRows,
      `Expected at least one update (activity='U') history row for patient ${patientId} / person ${personId}; got rows: ${historyRows}`,
    ).toMatch(/\|U\|/);

    // ----- 5. Inspect the changes XML on the UPDATE row(s) ------------
    const updateChanges = sql(
      `SELECT encode(h.changes,'escape') FROM clinlims.history h LEFT JOIN clinlims.reference_tables rt ON rt.id::numeric = h.reference_table WHERE h.activity='U' AND ((rt.name='PERSON' AND h.reference_id::text = '${personId}') OR (rt.name='PATIENT' AND h.reference_id::text = '${patientId}')) ORDER BY h.timestamp DESC LIMIT 1;`,
    );
    console.log(`[LO-01-02] UPDATE history changes XML:\n${updateChanges}`);
    expect(
      updateChanges,
      `UPDATE history row's changes blob should carry the old primaryPhone value '${INITIAL_PHONE}'`,
    ).toContain(INITIAL_PHONE);
  });
});
