import { test, expect } from "../../../helpers/test-base";
import { execSync } from "child_process";
import { resolveDbContainer } from "../../../helpers/db-container";
import {
  fillCarbonInput,
  clickCarbonRadio,
  fillCarbonDatePicker,
} from "../../../helpers/carbon-form";
import { SHORT_TIMEOUT, UI_TIMEOUT, LONG_TIMEOUT } from "../../../helpers/timeouts";

/**
 * LO-01-01 — Identification document (CIN) upload during initial patient
 * registration.
 *
 * UAT Round 2 (May 2026): "Step 3 in the test script fails as there is no
 * way to upload a CIN document. Test result: User can upload CIN document."
 * The UAT-fix flow is: open the "Identification Documents (e.g. CIN)"
 * accordion on the new-patient form, click Add Document, pick category
 * NATIONAL_ID (CIN), upload a file, save the patient → the doc must
 * persist and be retrievable via `/rest/patient-id-documents/{patientId}`.
 *
 * Grounding from frontend/backend:
 *   - CreatePatientForm.jsx:1989-1996 embeds IdentificationDocuments with
 *     pre-save buffering (pendingDocuments queue + Formik wiring).
 *   - IdentificationDocuments.jsx:152-162 handleUploadSubmit appends to
 *     pendingDocuments via onDocumentsChange.
 *   - PatientManagementRestController.savepatient:92-99 iterates
 *     patientInfo.getIdDocuments() and calls idDocumentService.saveDocument
 *     for each pending doc after patient persistence.
 *
 * This spec drives the full UI flow (CSRF-aware via browser DOM) and asserts
 * persistence via GET /rest/patient-id-documents/{id}.
 */

// Smallest valid PNG (1x1 transparent pixel) used as the CIN doc body so
// the test stays light and doesn't depend on external fixture files.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function letterSuffix(): string {
  return Date.now().toString(36).replace(/[0-9]/g, "") || "x";
}

function fetchPatientIdByName(first: string, last: string): string | null {
  const sql = `
    SELECT p.id::text FROM clinlims.patient p
    JOIN clinlims.person pe ON p.person_id = pe.id
    WHERE pe.first_name = '${first}' AND pe.last_name = '${last}'
    ORDER BY p.id DESC LIMIT 1;
  `;
  const out = execSync(
    `docker exec ${resolveDbContainer()} psql -U clinlims -d clinlims -t -A -c "${sql.replace(/\s+/g, " ").trim()}"`,
  )
    .toString()
    .trim();
  return out || null;
}

test.describe("LO-01-01: CIN document upload during initial registration", () => {
  test("Add Document → NATIONAL_ID upload → patient save → doc retrievable", async ({
    page,
  }) => {
    test.setTimeout(LONG_TIMEOUT * 2);

    const suffix = letterSuffix();
    const firstName = `Cin${suffix}`;
    const lastName = `Doc${suffix}`;
    const description = `Test CIN doc ${suffix}`;

    // 1. Open the new-patient form.
    await page.goto("/PatientManagement", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.locator("#newPatient").click();
    await expect(page.locator('input[name="firstName"]')).toBeVisible({
      timeout: UI_TIMEOUT,
    });

    // 2. Fill required fields. Match OGC-669 patterns.
    await fillCarbonInput({ page, selector: "input#firstName" }, firstName);
    await fillCarbonInput({ page, selector: "input#lastName" }, lastName);
    await fillCarbonInput(
      { page, selector: "input#primaryPhone" },
      "+261 37 12 345 67",
    );
    await clickCarbonRadio(page, "radio-1", {
      commitFocusSelector: "input#date-picker-default-id",
    });
    await fillCarbonDatePicker(page, "1990-05-15");

    // 3. Expand the "Additional Information" accordion (idDocuments lives
    //    inside it).
    await page
      .getByRole("button", { name: /additional information/i })
      .click();

    // 4. Expand the Identification Documents accordion.
    const idDocsAccordion = page.getByRole("button", {
      name: /identification documents \(e\.g\. cin\)/i,
    });
    await expect(idDocsAccordion).toBeVisible({ timeout: UI_TIMEOUT });
    await idDocsAccordion.click();

    // 5. Click Add Document (the only button inside .id-documents-header).
    await page.locator(".id-documents-header button").click();

    // 6. Carbon Modal renders both Add and Edit Document modals into the
    //    DOM; aria-label disambiguates. Scope all subsequent interactions
    //    to the Add Document modal specifically.
    const addModal = page.getByLabel("Add Document").locator("..");
    const categorySelect = addModal.locator("#new-doc-category");
    await expect(categorySelect).toBeVisible({ timeout: UI_TIMEOUT });

    // 7. Confirm NATIONAL_ID is selectable + default (the "CIN" equivalent).
    await categorySelect.selectOption("NATIONAL_ID");

    // 8. Upload the file via the hidden file input. setInputFiles bypasses
    //    the dropzone click; the onChange handler runs processFile() which
    //    sets newDocData and unlocks the Upload primary button.
    await page.setInputFiles(
      'input[type="file"][accept*="application/pdf"]',
      {
        name: "cin-test.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      },
    );

    // 9. Wait for the preview to render (FileReader is async) — scoped to
    //    the Add modal to avoid colliding with the Edit modal's preview div.
    await expect(addModal.locator(".id-doc-file-preview")).toBeVisible({
      timeout: UI_TIMEOUT,
    });

    // 10. Submit the modal — Carbon Modal renders its primary button with
    //     class cds--btn--primary in the footer.
    await addModal
      .locator(".cds--modal-footer button.cds--btn--primary")
      .click();

    // 11. Modal should close (category select no longer visible in the Add
    //     modal).
    await expect(categorySelect).not.toBeVisible({ timeout: UI_TIMEOUT });

    // 12. Submit the patient form.
    const [postResp] = await Promise.all([
      page
        .waitForResponse(
          (r) =>
            r.url().includes("/rest/PatientManagement") &&
            r.request().method() === "POST",
          { timeout: LONG_TIMEOUT },
        )
        .catch(() => null),
      page.locator("#submit").click(),
    ]);

    expect(postResp, "Save POST must fire").not.toBeNull();
    const respBody = await postResp!.text().catch(() => "");
    expect(
      postResp!.status(),
      `Save POST should succeed. Body: ${respBody.substring(0, 500)}`,
    ).toBeLessThan(400);

    // 13. Let persistence settle, then resolve patientId from the DB.
    await page.waitForTimeout(1500);
    const patientId = fetchPatientIdByName(firstName, lastName);
    expect(
      patientId,
      `Patient row for ${firstName} ${lastName} must exist after save`,
    ).not.toBeNull();

    // 14. Fetch the persisted documents and assert the CIN doc landed.
    const docsResp = await page.request.get(
      `/api/OpenELIS-Global/rest/patient-id-documents/${patientId}`,
    );
    expect(docsResp.status(), "GET patient-id-documents must return 200").toBe(
      200,
    );
    const docs = await docsResp.json();
    await docsResp.dispose();

    expect(
      Array.isArray(docs) && docs.length,
      `Expected at least one document, got: ${JSON.stringify(docs)}`,
    ).toBeGreaterThan(0);
    const nationalIdDoc = docs.find(
      (d: { category?: string }) => d.category === "NATIONAL_ID",
    );
    expect(
      nationalIdDoc,
      `Expected a NATIONAL_ID document, got categories: ${JSON.stringify(docs.map((d: { category?: string }) => d.category))}`,
    ).toBeDefined();
  });
});
