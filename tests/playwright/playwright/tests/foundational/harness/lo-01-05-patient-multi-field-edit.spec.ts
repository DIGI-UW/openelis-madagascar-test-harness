import { test, expect } from "../../../helpers/test-base";
import { execSync } from "child_process";
import { resolveDbContainer } from "../../../helpers/db-container";
import {
  fillCarbonInput,
  clickCarbonRadio,
  fillCarbonDatePicker,
  clickCarbonToggle,
} from "../../../helpers/carbon-form";
import {
  UI_TIMEOUT,
  LONG_TIMEOUT,
  NAV_TIMEOUT,
} from "../../../helpers/timeouts";

/**
 * LO-01-05 / LO-01-02 — patient edit must persist every changed field, and
 * the audit trail must record each change.
 *
 * UAT (May 2026) reported: "The audit trail only shows updated date of birth.
 * Does not capture audit trail for any other updated information/field."
 *
 * Root cause was not the audit emit itself (locked at the service layer by
 * PatientMultiFieldAuditTrailIntegrationTest) but the patient form's
 * Formik enableReinitialize + setPatientDetails race: edits to firstName,
 * lastName, etc. were clobbered by the async photo fetch resolving mid-
 * edit, so only the LAST field the user touched (typically DOB) reached
 * the submit body. Audit recorded that single change correctly.
 *
 * This spec drives the full user task at the browser+backend+audit-trail
 * level: fill the form, edit several fields, save, and verify (a) every
 * changed value reaches the DB and (b) the audit history's changes blob
 * carries every prior value. Regression here means either the form fix
 * (state preservation) or the audit emit broke — both are user-visible.
 */

const SUFFIX = Date.now().toString(36).replace(/[0-9]/g, "") || "x";
const FIRST_NAME = `Edit${SUFFIX}`;
const LAST_NAME = `Multi${SUFFIX}`;
const UPDATED_FIRST_NAME = `EditedFirst${SUFFIX}`;
const UPDATED_LAST_NAME = `EditedLast${SUFFIX}`;
const INITIAL_PHONE = "+261 37 11 111 11";
const UPDATED_PHONE = "+261 38 22 222 22";
const INITIAL_EMAIL = "before@example.org";
const UPDATED_EMAIL = "after@example.org";

function sql(s: string): string {
  return execSync(
    `docker exec ${resolveDbContainer()} psql -U clinlims -d clinlims -t -A -c "${s.replace(/\s+/g, " ").trim()}"`,
  )
    .toString()
    .trim();
}

test.describe("LO-01-05: editing multiple patient fields persists all changes and audits all changes", () => {
  test("create → edit firstName + lastName + phone + email → all reach DB; audit blob carries every prior value", async ({
    page,
  }) => {
    test.setTimeout(LONG_TIMEOUT * 2);

    // ---- 1. CREATE a patient with several distinguishable values --------
    await page.goto("/PatientManagement", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.locator("#newPatient").click();
    await expect(page.locator('input[name="firstName"]')).toBeVisible({
      timeout: UI_TIMEOUT,
    });

    await fillCarbonInput({ page, selector: "input#firstName" }, FIRST_NAME);
    await fillCarbonInput({ page, selector: "input#lastName" }, LAST_NAME);
    await fillCarbonInput(
      { page, selector: "input#primaryPhone" },
      INITIAL_PHONE,
    );
    await fillCarbonInput({ page, selector: "input#email" }, INITIAL_EMAIL);
    await clickCarbonRadio(page, "radio-1", {
      commitFocusSelector: "input#date-picker-default-id",
    });
    await fillCarbonDatePicker(page, "1990-05-15");

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/rest/PatientManagement") &&
          r.request().method() === "POST",
        { timeout: LONG_TIMEOUT },
      ),
      page.locator("#submit").click(),
    ]);
    expect(
      createResp.status(),
      `create POST should succeed; body: ${await createResp.text()}`,
    ).toBeLessThan(400);
    await page.waitForTimeout(1000);

    const patientId = sql(
      `SELECT p.id::text FROM clinlims.patient p JOIN clinlims.person pe ON p.person_id = pe.id WHERE pe.first_name = '${FIRST_NAME}' AND pe.last_name = '${LAST_NAME}' ORDER BY p.id DESC LIMIT 1;`,
    );
    expect(patientId, "patient row must exist after create").toMatch(/^\d+$/);
    const personId = sql(
      `SELECT pe.id::text FROM clinlims.person pe JOIN clinlims.patient p ON p.person_id = pe.id WHERE p.id = ${patientId} LIMIT 1;`,
    );

    // ---- 2. Reopen the patient via search --------------------------------
    await page.goto("/PatientManagement", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await fillCarbonInput({ page, selector: "input#lastName" }, LAST_NAME);
    await page.locator('[data-cy="searchPatientButton"]').click();
    await page.waitForTimeout(3000);

    await clickCarbonRadio(page, patientId, {
      commitFocusSelector: "input#date-picker-default-id",
    });
    await page.waitForTimeout(2000);

    // Confirm form rendered with the original values — this is also the
    // window during which the OLD form's async photo fetch would clobber
    // typing, so the first edit happens immediately.
    await expect(page.locator('input[name="firstName"]')).toHaveValue(
      FIRST_NAME,
      { timeout: UI_TIMEOUT },
    );
    await expect(page.locator('input[name="lastName"]')).toHaveValue(
      LAST_NAME,
    );

    // ---- 3. Edit MULTIPLE fields ----------------------------------------
    await clickCarbonToggle(page, "patient-edit-toggle");

    await fillCarbonInput(
      { page, selector: "input#firstName" },
      UPDATED_FIRST_NAME,
    );
    await fillCarbonInput(
      { page, selector: "input#lastName" },
      UPDATED_LAST_NAME,
    );
    await fillCarbonInput(
      { page, selector: "input#primaryPhone" },
      UPDATED_PHONE,
    );
    await fillCarbonInput({ page, selector: "input#email" }, UPDATED_EMAIL);

    // Right before save, assert the inputs ACTUALLY hold the edits — if
    // the form clobbered them this fails here and tells us exactly which
    // field was lost.
    await expect(
      page.locator('input[name="firstName"]'),
      "firstName must still show user's edit immediately before save",
    ).toHaveValue(UPDATED_FIRST_NAME);
    await expect(
      page.locator('input[name="lastName"]'),
      "lastName must still show user's edit immediately before save",
    ).toHaveValue(UPDATED_LAST_NAME);
    await expect(
      page.locator("input#primaryPhone"),
      "primaryPhone must still show user's edit immediately before save",
    ).toHaveValue(UPDATED_PHONE);
    await expect(
      page.locator("input#email"),
      "email must still show user's edit immediately before save",
    ).toHaveValue(UPDATED_EMAIL);

    const [updateResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/rest/PatientManagement") &&
          r.request().method() === "POST",
        { timeout: LONG_TIMEOUT },
      ),
      page.locator("#submit").click(),
    ]);
    expect(
      updateResp.status(),
      `update POST should succeed; body: ${await updateResp.text()}`,
    ).toBeLessThan(400);
    await page.waitForTimeout(1500);

    // ---- 4. DB must reflect every change ---------------------------------
    const dbState = sql(
      `SELECT pe.first_name || '|' || pe.last_name || '|' || pe.primary_phone || '|' || COALESCE(pe.email,'') FROM clinlims.person pe WHERE pe.id = ${personId};`,
    );
    expect(
      dbState,
      `Person ${personId} must reflect every edited field. got: '${dbState}'`,
    ).toBe(
      `${UPDATED_FIRST_NAME}|${UPDATED_LAST_NAME}|${UPDATED_PHONE}|${UPDATED_EMAIL}`,
    );

    // ---- 5. Audit history must capture every prior value -----------------
    const updateChangesXml = sql(
      `SELECT encode(h.changes,'escape') FROM clinlims.history h LEFT JOIN clinlims.reference_tables rt ON rt.id::numeric = h.reference_table WHERE h.activity='U' AND rt.name='PERSON' AND h.reference_id::text = '${personId}' ORDER BY h.timestamp DESC LIMIT 1;`,
    );
    console.log(`[LO-01-05] UPDATE history changes XML:\n${updateChangesXml}`);

    expect(
      updateChangesXml,
      `audit XML must contain prior firstName '${FIRST_NAME}'`,
    ).toContain(FIRST_NAME);
    expect(
      updateChangesXml,
      `audit XML must contain prior lastName '${LAST_NAME}'`,
    ).toContain(LAST_NAME);
    expect(
      updateChangesXml,
      `audit XML must contain prior primaryPhone '${INITIAL_PHONE}'`,
    ).toContain(INITIAL_PHONE);
    expect(
      updateChangesXml,
      `audit XML must contain prior email '${INITIAL_EMAIL}'`,
    ).toContain(INITIAL_EMAIL);
  });
});
