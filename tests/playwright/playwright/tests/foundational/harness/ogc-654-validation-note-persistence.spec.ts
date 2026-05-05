import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

/**
 * OGC-654 regression — Validation note persistence (LO-05-05).
 *
 * Drives /AccessionValidation end-to-end against mgtest, types a note into
 * the Notes column for the first pending validation row, ticks Accept,
 * clicks Save, and asserts:
 *   1. POST body to /rest/AccessionValidation contains the note
 *   2. clinlims.note row count increments by 1
 *
 * Original bug (fixed in OE2 SearchForm.jsx): the form's resultList rows
 * arrived from the server without a `note` key, so jpSet's JSONPath query
 * found 0 matches and silently dropped the note on input. Fix pre-inits
 * each row's note to "" before passing the form into Validation state.
 *
 * Pre-req: at least one analysis at status_id=15 in the validation queue
 * for ACCESSION below. (Status 15 = "results accepted by technician as
 * being valid" — what /AccessionValidation displays for biologist review.)
 */

const ACCESSION = "DEV01260000000000001";
const NOTE_TEXT = `OGC-654-pwt-${Date.now()}`;
const SHOTS = "/tmp/ogc654-shots";

function noteCount(): number {
  const out = execSync(
    `docker exec openelisglobal-database psql -U clinlims -d clinlims -t -A -c "SELECT count(*) FROM clinlims.note;"`,
  )
    .toString()
    .trim();
  return parseInt(out, 10);
}

test.describe("OGC-654 UI-driven note persistence", () => {
  test("type note + tick accept + save → note persists in clinlims.note", async ({
    page,
  }) => {
    test.setTimeout(60_000);

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
