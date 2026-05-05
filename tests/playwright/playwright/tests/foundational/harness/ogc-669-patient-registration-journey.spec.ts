import { test, expect } from "../../../helpers/test-base";
import { resolveDbContainer } from "../../../helpers/db-container";
import {
  SHORT_TIMEOUT,
  UI_TIMEOUT,
  LONG_TIMEOUT,
  NAV_TIMEOUT,
} from "../../../helpers/timeouts";
import {
  fillCarbonInput,
  pickFirstCarbonOption,
  clickCarbonRadio,
  fillCarbonDatePicker,
  dumpFormState,
} from "../../../helpers/carbon-form";
import { execSync } from "child_process";

/**
 * OGC-669 — Madagascar patient registration UX journey.
 *
 * End-to-end test that a Madagascar admin can register a new patient with
 * the full 5-level address hierarchy (Province / Region / District / Fokontany
 * / Hamlet/Lot) plus GPS coordinates, save, and have all values land in
 * `clinlims.person`.
 *
 * Exercises the integration between:
 *   - distro `madagascar-levels.csv` (declares 3 dropdown + 2 freetext)
 *   - OE2 `AddressHierarchyConfigurationHandler` (auto-creates org_types,
 *     persists per-level inputType in site_information)
 *   - OE2 `/rest/address-hierarchy/levels` API (exposes inputType per level)
 *   - `CreatePatientForm.jsx` renderer (branches on inputType)
 *   - OE2 PatientManagementUpdate persistence
 *   - Postgres `clinlims.person` schema (province / fokontany / hamlet_or_lot
 *     columns)
 *
 * The journey, not the wiring, is what's tested here. Wiring regressions
 * are caught by the vitest specs in OE2.
 */

const RUN_ID = `OGC669-J-${Date.now()}`;
// FIRST_NAME / LAST_NAME must pass `configurationProperties.FIRST_NAME_REGEX`
// — Madagascar distro typically restricts to letters only. Any digit in the
// value triggers handleFirstNameChange to reset the input to "" silently.
// Use a letter-only suffix so each test run is unique without digits.
function letterSuffix(): string {
  // Hex-of-timestamp gives a-f letters; strip 0-9 digits.
  return Date.now().toString(36).replace(/[0-9]/g, "") || "x";
}
const SUFFIX = letterSuffix();
const FIRST_NAME = `Reg${SUFFIX}`;
const LAST_NAME = `Journey${SUFFIX}`;
const NATIONAL_ID = `NID-${Date.now()}`;
const PRIMARY_PHONE = "+261-33-456-76-98"; // Madagascar format
const FOKONTANY = `${RUN_ID}-fkt`;
const HAMLET_OR_LOT = `${RUN_ID}-hml`;
const GPS_LAT = "-18.879190";
const GPS_LONG = "47.507905";
// Yup validator at CreatePatientValidationShema:8 requires `dd/mm/yyyy` or
// `mm/dd/yyyy` — must be slash-separated, NOT ISO dashes.
const BIRTH_DATE_VALUE = "15/05/1990";

// Fetch the saved patient row by name and return the address fields.
function fetchPersonByName(first: string, last: string) {
  const sql = `
    SELECT first_name, last_name, province, fokontany, hamlet_or_lot,
           gps_latitude::text, gps_longitude::text
    FROM clinlims.person
    WHERE first_name = '${first}' AND last_name = '${last}'
    ORDER BY id DESC
    LIMIT 1;
  `;
  const out = execSync(
    `docker exec ${resolveDbContainer()} psql -U clinlims -d clinlims -t -A -F'|' -c "${sql.replace(/\s+/g, " ").trim()}"`,
  )
    .toString()
    .trim();
  if (!out) return null;
  const [
    firstName,
    lastName,
    province,
    fokontany,
    hamletOrLot,
    gpsLatitude,
    gpsLongitude,
  ] = out.split("|");
  return {
    firstName,
    lastName,
    province: province || null,
    fokontany: fokontany || null,
    hamletOrLot: hamletOrLot || null,
    gpsLatitude: gpsLatitude || null,
    gpsLongitude: gpsLongitude || null,
  };
}

test.describe("OGC-669 patient registration UX journey", () => {
  test("Madagascar admin registers a patient with full address + GPS", async ({
    page,
  }) => {
    test.setTimeout(NAV_TIMEOUT * 2);

    // 1. Navigate to PatientManagement.
    await page.goto("/PatientManagement", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForLoadState("networkidle").catch(() => {});

    // 2. Switch to the New Patient tab.
    await page.locator("#newPatient").click();

    // 3. Wait for the form to render — firstName is a stable required
    //    field that's always visible on the new patient form.
    await expect(page.locator('input[name="firstName"]')).toBeVisible({
      timeout: UI_TIMEOUT,
    });

    // 4. Required fields — helpers in `carbon-form.ts` encapsulate Carbon's
    //    fill+commit, radio-via-label, and date-picker quirks.
    await fillCarbonInput({ page, selector: "input#firstName" }, FIRST_NAME);
    await fillCarbonInput({ page, selector: "input#lastName" }, LAST_NAME);
    await fillCarbonInput({ page, selector: "input#nationalId" }, NATIONAL_ID);
    await fillCarbonInput(
      { page, selector: "input#primaryPhone" },
      PRIMARY_PHONE,
    );

    // Gender: radio-1 is the Male radio on the patient form.
    await clickCarbonRadio(page, "radio-1", {
      commitFocusSelector: "input#date-picker-default-id",
    });

    // Birth date — Carbon CustomDatePicker. Format must be dd/mm/yyyy or
    // mm/dd/yyyy with slashes (Yup validator rejects ISO dashes).
    await fillCarbonDatePicker(page, BIRTH_DATE_VALUE);

    // 5. Expand the "Additional Information" accordion — address + GPS
    //    fields live inside it and are hidden until expanded.
    await page
      .getByRole("button", { name: /additional information/i })
      .click();

    // 6-8. Cascading address dropdowns (3 levels: Province, Region, District).
    //      Each has id `address_hierarchy_${i}`. Cascade-disabled until parent
    //      is picked, so pick sequentially.
    const provinceValue = await pickFirstCarbonOption({
      page,
      selector: "#address_hierarchy_0",
    });
    const regionValue = await pickFirstCarbonOption({
      page,
      selector: "#address_hierarchy_1",
    });
    const districtValue = await pickFirstCarbonOption({
      page,
      selector: "#address_hierarchy_2",
    });
    console.log(
      `[${RUN_ID}] address picks Province=${provinceValue} Region=${regionValue} District=${districtValue}`,
    );

    // 9. Freetext sub-fokontany fields (rendered by CSV-driven inputType=freetext).
    await fillCarbonInput({ page, selector: "#fokontany" }, FOKONTANY);
    await fillCarbonInput({ page, selector: "#hamletOrLot" }, HAMLET_OR_LOT);

    // 10. GPS Lat/Long (gated by PATIENT_GPS_CAPTURE_ENABLED=true distro-side).
    await fillCarbonInput({ page, selector: "#gpsLatitude" }, GPS_LAT);
    await fillCarbonInput({ page, selector: "#gpsLongitude" }, GPS_LONG);

    // 11. Save. Button has id="submit" + type="submit"; text is just "Save"
    //     (FormattedMessage label.button.save → "Save").
    const saveBtn = page.locator("#submit");
    await expect(saveBtn).toBeEnabled({ timeout: UI_TIMEOUT });

    // Pre-save diagnostic: dump form-input values + any visible error
    // messages so failures surface what's missing without a trace dive.
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        console.log(`[browser ${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("requestfailed", (req) =>
      console.log(`[network failed] ${req.method()} ${req.url()}`),
    );

    const formState = await dumpFormState(page, {
      firstName: "input#firstName",
      lastName: "input#lastName",
      nationalId: "input#nationalId",
      birthDate: "input#date-picker-default-id",
      primaryPhone: "input#primaryPhone",
      genderM: 'input#radio-1:checked',
      genderF: 'input#radio-2:checked',
      fokontany: "#fokontany",
      hamletOrLot: "#hamletOrLot",
      gpsLatitude: "#gpsLatitude",
      gpsLongitude: "#gpsLongitude",
      addr0: "#address_hierarchy_0",
      addr1: "#address_hierarchy_1",
      addr2: "#address_hierarchy_2",
    });
    console.log(`[${RUN_ID}] pre-save form state:`, JSON.stringify(formState));

    const [postResp] = await Promise.all([
      page
        .waitForResponse(
          (r) =>
            r.url().includes("/rest/PatientManagement") &&
            r.request().method() === "POST",
          { timeout: LONG_TIMEOUT },
        )
        .catch(() => null),
      saveBtn.click(),
    ]);

    expect(
      postResp,
      "Save must fire POST /rest/PatientManagement",
    ).not.toBeNull();
    expect(
      postResp!.status(),
      `Save POST should succeed, got ${postResp!.status()}`,
    ).toBeLessThan(400);

    // 12. Allow persistence to settle, then read back.
    await page.waitForTimeout(1500);

    const row = fetchPersonByName(FIRST_NAME, LAST_NAME);
    console.log(`[${RUN_ID}] persisted row:`, JSON.stringify(row));

    expect(row, `person row for ${FIRST_NAME} ${LAST_NAME} must exist`)
      .not.toBeNull();
    expect(row!.fokontany, "fokontany column must persist").toBe(FOKONTANY);
    expect(row!.hamletOrLot, "hamlet_or_lot column must persist").toBe(
      HAMLET_OR_LOT,
    );
    // Province column is set via the cascade's typeName-based sync at
    // CreatePatientForm.jsx:1531-1551 — non-null is the meaningful assertion.
    expect(row!.province, "province column must persist non-null").not.toBeNull();
    expect(
      Number(row!.gpsLatitude),
      "gps_latitude must round-trip as numeric",
    ).toBeCloseTo(Number(GPS_LAT), 4);
    expect(
      Number(row!.gpsLongitude),
      "gps_longitude must round-trip as numeric",
    ).toBeCloseTo(Number(GPS_LONG), 4);
  });
});
