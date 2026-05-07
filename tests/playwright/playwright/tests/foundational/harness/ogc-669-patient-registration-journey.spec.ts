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
 * OGC-669 / OGC-671 — Madagascar patient registration UX journey.
 *
 * End-to-end test that a Madagascar admin can register a new patient with
 * OGC-671 registration config (optional National ID, Alias, 37/38 phone label,
 * CIN document title) plus the full 5-level address hierarchy and GPS.
 *
 * Exercises the integration between:
 *   - distro `madagascar-levels.csv` (declares 3 dropdown + 2 freetext)
 *   - OE2 `AddressHierarchyConfigurationHandler` (auto-creates org_types,
 *     persists per-level inputType in site_information)
 *   - OE2 `/rest/address-hierarchy/levels` API (exposes inputType per level)
 *   - `CreatePatientForm.jsx` renderer (branches on inputType)
 *   - OE2 PatientManagementUpdate persistence
 *   - generic ADDRESS_HIERARCHY_N patient_identity persistence
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
const ALIAS = `Alias${SUFFIX}`;
const PRIMARY_PHONE = "+261 37 12 345 67"; // OGC-671 Madagascar format
const FOKONTANY = `${RUN_ID}-fkt`;
const HAMLET_OR_LOT = `${RUN_ID}-hml`;
const GPS_LAT = "-18.879190";
const GPS_LONG = "47.507905";
// flatpickr's setDate accepts ISO yyyy-mm-dd most reliably. The
// CustomDatePicker formats the parsed date back to mm/dd/yyyy on commit,
// which is what the Yup validator checks.
const BIRTH_DATE_VALUE = "1990-05-15";

// Fetch the saved patient row by name and return the address fields.
function fetchPersonByName(first: string, last: string) {
  const sql = `
    SELECT pe.first_name, pe.last_name,
           ah0.identity_data AS address_hierarchy_0,
           ah3.identity_data AS address_hierarchy_3,
           ah4.identity_data AS address_hierarchy_4,
           pe.gps_latitude::text, pe.gps_longitude::text
    FROM clinlims.person pe
    JOIN clinlims.patient p ON p.person_id = pe.id
    LEFT JOIN clinlims.patient_identity ah0
      ON ah0.patient_id = p.id
     AND ah0.identity_type_id = (
       SELECT id FROM clinlims.patient_identity_type
       WHERE identity_type = 'ADDRESS_HIERARCHY_0'
     )
    LEFT JOIN clinlims.patient_identity ah3
      ON ah3.patient_id = p.id
     AND ah3.identity_type_id = (
       SELECT id FROM clinlims.patient_identity_type
       WHERE identity_type = 'ADDRESS_HIERARCHY_3'
     )
    LEFT JOIN clinlims.patient_identity ah4
      ON ah4.patient_id = p.id
     AND ah4.identity_type_id = (
       SELECT id FROM clinlims.patient_identity_type
       WHERE identity_type = 'ADDRESS_HIERARCHY_4'
     )
    WHERE pe.first_name = '${first}' AND pe.last_name = '${last}'
    ORDER BY pe.id DESC
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
    addressHierarchy0,
    addressHierarchy3,
    addressHierarchy4,
    gpsLatitude,
    gpsLongitude,
  ] = out.split("|");
  return {
    firstName,
    lastName,
    addressHierarchy0: addressHierarchy0 || null,
    addressHierarchy3: addressHierarchy3 || null,
    addressHierarchy4: addressHierarchy4 || null,
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
    await expect(
      page.locator('label[for="nationalId"] .requiredlabel'),
      "National ID should be optional for Madagascar",
    ).toHaveCount(0);
    await fillCarbonInput({ page, selector: "input#firstName" }, FIRST_NAME);
    await fillCarbonInput({ page, selector: "input#lastName" }, LAST_NAME);
    await expect(page.locator("input#aka"), "Alias field should render").toBeVisible();
    await fillCarbonInput({ page, selector: "input#aka" }, ALIAS);
    await expect(page.locator('label[for="primaryPhone"]')).toContainText(
      "+261 37 XX XXX XX",
    );
    await expect(page.locator('label[for="primaryPhone"]')).toContainText(
      "+261 38 XX XXX XX",
    );
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

    await expect(
      page.getByRole("button", { name: /identification documents \(e\.g\. cin\)/i }),
    ).toBeVisible();

    await expect(page.locator("#addressHierarchy_3")).toBeVisible();
    await expect(page.locator("#addressHierarchy_4")).toBeVisible();
    const addressFieldOrder = await page.evaluate(() => {
      const ids = [
        "addressHierarchy_3",
        "addressHierarchy_4",
        "address_hierarchy_0",
        "address_hierarchy_1",
        "address_hierarchy_2",
      ];
      return ids
        .map((id) => {
          const el = document.getElementById(id);
          if (!el) return { id, top: Number.POSITIVE_INFINITY };
          return { id, top: el.getBoundingClientRect().top };
        })
        .sort((left, right) => left.top - right.top)
        .map((entry) => entry.id);
    });
    expect(addressFieldOrder).toEqual([
      "addressHierarchy_3",
      "addressHierarchy_4",
      "address_hierarchy_0",
      "address_hierarchy_1",
      "address_hierarchy_2",
    ]);

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
    await fillCarbonInput({ page, selector: "#addressHierarchy_3" }, FOKONTANY);
    await fillCarbonInput({ page, selector: "#addressHierarchy_4" }, HAMLET_OR_LOT);

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
    page.on("pageerror", (err) =>
      console.log(`[pageerror] ${err.message}`),
    );
    page.on("request", (req) => {
      if (req.method() === "POST") {
        console.log(`[POST request] ${req.url()}`);
      }
    });
    page.on("requestfailed", (req) =>
      console.log(`[network failed] ${req.method()} ${req.url()}`),
    );

    const formState = await dumpFormState(page, {
      firstName: "input#firstName",
      lastName: "input#lastName",
      nationalId: "input#nationalId",
      aka: "input#aka",
      birthDate: "input#date-picker-default-id",
      primaryPhone: "input#primaryPhone",
      genderM: 'input#radio-1:checked',
      genderF: 'input#radio-2:checked',
      addressHierarchy3: "#addressHierarchy_3",
      addressHierarchy4: "#addressHierarchy_4",
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

    // If no POST fired, dump everything we can about why.
    if (!postResp) {
      await page.waitForTimeout(2000);
      const postClickState = await page.evaluate(() => {
        const errorDivs = Array.from(
          document.querySelectorAll("div, span, p, label"),
        )
          .map((el) => ({
            cls: (el.className as string) || "",
            text: el.textContent?.trim() ?? "",
          }))
          .filter(
            (x) =>
              typeof x.cls === "string" &&
              (x.cls.includes("error") ||
                x.cls.includes("invalid") ||
                x.cls.includes("required")) &&
              x.text &&
              x.text.length < 200,
          );
        const submitBtn = document.querySelector("#submit") as HTMLButtonElement;
        return {
          submitDisabled: submitBtn?.disabled,
          submitVisible: submitBtn?.offsetParent !== null,
          errorElements: errorDivs.slice(0, 10),
        };
      });
      console.log(
        `[${RUN_ID}] post-click diagnostic:`,
        JSON.stringify(postClickState, null, 2),
      );
    }

    expect(
      postResp,
      "Save must fire POST /rest/PatientManagement",
    ).not.toBeNull();

    // Capture response body so failures show backend error detail.
    const respBody = await postResp!.text().catch(() => "");
    if (postResp!.status() >= 400) {
      console.log(
        `[${RUN_ID}] POST ${postResp!.status()} body (first 800 chars): ${respBody.substring(0, 800)}`,
      );
    }

    expect(
      postResp!.status(),
      `Save POST should succeed (got ${postResp!.status()}). Body: ${respBody.substring(0, 500)}`,
    ).toBeLessThan(400);

    // 12. Allow persistence to settle, then read back.
    await page.waitForTimeout(1500);

    const row = fetchPersonByName(FIRST_NAME, LAST_NAME);
    console.log(`[${RUN_ID}] persisted row:`, JSON.stringify(row));

    expect(row, `person row for ${FIRST_NAME} ${LAST_NAME} must exist`)
      .not.toBeNull();
    expect(row!.addressHierarchy3, "ADDRESS_HIERARCHY_3 must persist").toBe(
      FOKONTANY,
    );
    expect(row!.addressHierarchy4, "ADDRESS_HIERARCHY_4 must persist").toBe(
      HAMLET_OR_LOT,
    );
    expect(
      row!.addressHierarchy0,
      "ADDRESS_HIERARCHY_0 must persist non-null",
    ).not.toBeNull();
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
