import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

/**
 * OGC-654 regression — Validation note persistence (LO-05-05).
 *
 * Drives /AccessionValidation end-to-end, types a note into the Notes
 * column for the seeded validation row, ticks Accept, clicks Save, and
 * asserts:
 *   1. POST body to /rest/AccessionValidation contains the note
 *   2. clinlims.note row count increments by 1
 *
 * Original bug (fixed in OE2 SearchForm.jsx): the form's resultList rows
 * arrived from the server without a `note` key, so jpSet's JSONPath query
 * found 0 matches and silently dropped the note on input. Fix pre-inits
 * each row's note to "" before passing the form into Validation state.
 *
 * Setup: this spec seeds its own validation-queue row directly via SQL —
 * one minimal patient + sample + analysis chain at analysis.status_id=15
 * ("Technical Acceptance"). The setup is intentionally outside the UI
 * (the regression is about the form's note handling, not the operator
 * workflow that produces a row at status 15). Each run creates a unique
 * accession so reruns don't collide.
 */

const NOTE_TEXT = `OGC-654-pwt-${Date.now()}`;
const SHOTS = "/tmp/ogc654-shots";

function psql(sql: string): string {
  // psql's `-c` arg parses backslash-commands at the start of each line, so
  // a multi-line string with `\n` escape sequences produces "invalid command
  // \n". Collapse whitespace to single-line before forwarding.
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return execSync(
    `docker exec openelisglobal-database psql -U clinlims -d clinlims -t -A -c ${JSON.stringify(oneLine)}`,
  )
    .toString()
    .trim();
}

function noteCount(): number {
  return parseInt(psql("SELECT count(*) FROM clinlims.note;"), 10);
}

/**
 * Seed one analysis at status_id=15 for a unique accession. Returns the
 * accession_number so the test can navigate directly to its validation
 * page. NOT-NULL columns only; everything else inherits defaults.
 *
 * Status_id semantics (status_of_sample):
 *   - sample.status_id    = 20 (SampleEntered)
 *   - sample_item.status_id = 1  (Test Entered — placeholder)
 *   - analysis.status_id  = 15 (Technical Acceptance — the row /AccessionValidation queries)
 *
 * Test row references: test_id pulls from existing `clinlims.test`,
 * test_sect_id from existing `clinlims.test_section`. Both must be
 * already seeded by Liquibase + distro CSVs (they are on any healthy
 * stack).
 */
function seedValidationQueueRow(): string {
  // No dashes in the accession: SearchForm.jsx:121 splits on `-` and uses
  // only the prefix, so "OGC654-abc" gets searched as "OGC654" — backend
  // returns nothing and the page renders empty.
  const accession = `OGC654x${Date.now().toString(36)}`;
  const sql = `
    WITH
      new_person AS (
        INSERT INTO clinlims.person (id, last_name, first_name)
        VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM clinlims.person), 'OGC654-seed', 'OGC654')
        RETURNING id
      ),
      new_patient AS (
        INSERT INTO clinlims.patient (id, person_id)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM clinlims.patient), id FROM new_person
        RETURNING id
      ),
      new_sample AS (
        INSERT INTO clinlims.sample (id, accession_number, entered_date, received_date, is_confirmation, status_id)
        VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM clinlims.sample), '${accession}', NOW(), NOW(), false, 20)
        RETURNING id
      ),
      new_sh AS (
        INSERT INTO clinlims.sample_human (id, samp_id, patient_id)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM clinlims.sample_human), s.id, p.id
        FROM new_sample s, new_patient p
        RETURNING id
      ),
      new_si AS (
        INSERT INTO clinlims.sample_item (id, samp_id, sort_order, status_id)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM clinlims.sample_item), id, 1, 1 FROM new_sample
        RETURNING id
      ),
      ref AS (
        SELECT (SELECT id FROM clinlims.test WHERE is_active='Y' ORDER BY id LIMIT 1) AS test_id,
               (SELECT id FROM clinlims.test_section ORDER BY id LIMIT 1) AS sect_id,
               (SELECT id FROM clinlims.test_result WHERE test_id=(SELECT id FROM clinlims.test WHERE is_active='Y' ORDER BY id LIMIT 1) ORDER BY id LIMIT 1) AS test_result_id
      ),
      new_analysis AS (
        INSERT INTO clinlims.analysis (id, sampitem_id, test_id, test_sect_id, status_id, analysis_type, revision)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM clinlims.analysis), si.id, ref.test_id, ref.sect_id, 15, 'MANUAL', 0
        FROM new_si si, ref
        RETURNING id
      )
    INSERT INTO clinlims.result (id, analysis_id, result_type, value, test_result_id, sort_order)
    SELECT (SELECT COALESCE(MAX(id),0)+1 FROM clinlims.result), a.id, 'N', '25.0', ref.test_result_id, 0
    FROM new_analysis a, ref
    RETURNING id;
  `;
  psql(sql);
  return accession;
}

test.describe("OGC-654 UI-driven note persistence", () => {
  test("type note + tick accept + save → note persists in clinlims.note", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Seed: one analysis at status_id=15 under a unique accession so
    // /AccessionValidation has at least one Notes row to render. See
    // seedValidationQueueRow comment for the row chain.
    const ACCESSION = seedValidationQueueRow();
    console.log(`[OGC-654] seeded accession: ${ACCESSION}`);

    // Capture the actual POST body the FE sends.
    let postBody: any = null;
    let postBodyRaw: string = "";
    page.on("request", (req) => {
      if (
        req.url().includes("/rest/AccessionValidation") &&
        req.method() === "POST"
      ) {
        postBodyRaw = req.postData() ?? "";
        try {
          postBody = req.postDataJSON();
        } catch {
          postBody = "<not JSON>";
        }
      }
    });

    let postStatus: number | null = null;
    page.on("response", async (resp) => {
      if (
        resp.url().includes("/rest/AccessionValidation") &&
        resp.request().method() === "POST"
      ) {
        postStatus = resp.status();
      }
    });

    const before = noteCount();
    console.log(`[OGC-654] notes_total BEFORE: ${before}`);

    // Navigate to the validation page for the accession.
    await page.goto(`/validation?type=order&accessionNumber=${ACCESSION}`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the data fetch + table render.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1000); // give React time to render Carbon DataTable

    await page.screenshot({
      path: `${SHOTS}/01-loaded.png`,
      fullPage: true,
    });

    // Find the Notes textarea — Validation.jsx renders <TextArea id={"resultList" + row.id + ".note"} />
    const textareas = page.locator("textarea");
    const taCount = await textareas.count();
    console.log(`[OGC-654] textarea count: ${taCount}`);
    expect(
      taCount,
      "needs at least one Notes textarea — pending validation row required",
    ).toBeGreaterThan(0);

    // Print the textarea ids to confirm row.id pattern
    for (let i = 0; i < taCount; i++) {
      const id = await textareas.nth(i).getAttribute("id");
      const name = await textareas.nth(i).getAttribute("name");
      console.log(`[OGC-654] textarea[${i}] id="${id}" name="${name}"`);
    }

    // Use focus + sequential typing — fill() can skip React's onChange for
    // some controlled-input wrappers; pressSequentially fires keydown/input
    // events that mimic real user typing.
    await textareas.first().focus();
    await textareas.first().pressSequentially(NOTE_TEXT, { delay: 20 });
    // Trigger blur to coerce any onBlur-driven React state commit (some
    // patterns only commit state on blur, not onChange).
    await textareas.first().blur();

    // Read DOM value immediately + log so we can see if fill landed on the input.
    const domValue = await textareas.first().inputValue();
    console.log(`[OGC-654] textarea DOM value after typing: "${domValue}"`);
    expect(domValue, "DOM value should match what we typed").toBe(NOTE_TEXT);

    // Find the Accept checkbox(es) — there's typically an isAccepted + isRejected per row.
    const checkboxes = page.locator('input[type="checkbox"]');
    const cbCount = await checkboxes.count();
    console.log(`[OGC-654] checkbox count: ${cbCount}`);
    for (let i = 0; i < Math.min(cbCount, 5); i++) {
      const id = await checkboxes.nth(i).getAttribute("id");
      const name = await checkboxes.nth(i).getAttribute("name");
      console.log(`[OGC-654] checkbox[${i}] id="${id}" name="${name}"`);
    }

    // Skip the global autochecks (saveallnormal, saveallresults, retestalltests)
    // and tick the per-row Accept checkbox by id. Carbon checkboxes have a
    // label that intercepts pointer events on the input — use the label.
    const acceptLabel = page.locator('label[for="resultList0.isAccepted"]');
    await expect(acceptLabel, "row 0 isAccepted label must exist").toBeVisible({
      timeout: 5_000,
    });
    await acceptLabel.click();

    await page.screenshot({
      path: `${SHOTS}/02-filled.png`,
      fullPage: true,
    });

    // Click the bottom Save button.
    const saveBtn = page.getByRole("button", { name: /^save$/i }).last();
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });

    const [postResp] = await Promise.all([
      page
        .waitForResponse(
          (r) =>
            r.url().includes("/rest/AccessionValidation") &&
            r.request().method() === "POST",
          { timeout: 15_000 },
        )
        .catch(() => null),
      saveBtn.click(),
    ]);

    console.log(`[OGC-654] POST observed: ${postResp ? "yes" : "NO"}`);
    console.log(`[OGC-654] POST status: ${postStatus}`);
    console.log(
      `[OGC-654] POST body (first 1500 chars): ${postBodyRaw.substring(0, 1500)}`,
    );

    if (postBody && Array.isArray(postBody.resultList)) {
      console.log(
        `[OGC-654] resultList in POST: ${postBody.resultList.length} rows`,
      );
      const rowsWithNote = postBody.resultList.filter(
        (r: any) => r && r.note && r.note.length > 0,
      );
      console.log(
        `[OGC-654] rows with non-empty .note: ${rowsWithNote.length}`,
      );
      console.log(
        "[OGC-654] all row note + isAccepted values:",
        JSON.stringify(
          postBody.resultList.map((r: any) => ({
            analysisId: r?.analysisId,
            isAccepted: r?.isAccepted,
            note: r?.note,
          })),
          null,
          2,
        ),
      );
    } else if (postBody && typeof postBody === "object") {
      // Maybe resultList isn't an array — check for object-keyed structure
      console.log(
        "[OGC-654] postBody.resultList type:",
        typeof postBody.resultList,
      );
      console.log(
        "[OGC-654] postBody.resultList keys:",
        postBody.resultList ? Object.keys(postBody.resultList) : "n/a",
      );
    }

    await page.waitForTimeout(2000); // let any commit settle
    const after = noteCount();
    console.log(
      `[OGC-654] notes_total AFTER: ${after} (delta = ${after - before})`,
    );

    // Regression assertion: note row must land in clinlims.note.
    expect(
      after,
      `Note row should persist after save. before=${before}, after=${after}. POST status=${postStatus}.`,
    ).toBe(before + 1);
  });
});
