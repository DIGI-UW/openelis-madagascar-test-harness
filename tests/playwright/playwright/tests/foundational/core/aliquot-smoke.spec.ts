import { test, expect } from "@playwright/test";
import path from "path";

/**
 * LO-03-08 Aliquoting smoke — captures three screenshots that document
 * where the Aliquot navigation entry actually lives on this stack.
 *
 *   1) home page after login
 *   2) opened main side-nav (proves "Aliquot" is a top-level entry,
 *      not nested under "Order" as the GRIST step says)
 *   3) /Aliquot landing page (Search Sample panel)
 *
 * Per OGC-54 the entry is meant to be a top-level Sample/Aliquot menu;
 * this spec records the on-screen reality so MedX's "No Aliquot option
 * shown" V2 finding can be reconciled with the live UI.
 */

const SHOTS = path.resolve(__dirname, "../../../../test-results/aliquot-smoke");

test.describe("LO-03-08 aliquot smoke", () => {
  test("home → side-nav → /Aliquot direct route", async ({ page }) => {
    test.setTimeout(60_000);

    // 1) Home
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });

    // 2) Open the main side-nav. Carbon SideNav is toggled by a header
    // button identified by aria-label ("Open menu") in OE.
    const navToggle = page
      .getByRole("button", { name: /open menu|side\s*nav/i })
      .first();
    if (await navToggle.isVisible().catch(() => false)) {
      await navToggle.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({
      path: `${SHOTS}/02-sidenav-open.png`,
      fullPage: true,
    });

    // Look for the Aliquot link wherever it lives. It should be a
    // top-level entry per OGC-54 — but log whatever we find.
    const aliquotLink = page.getByRole("link", { name: /^aliquot/i }).first();
    const aliquotVisible = await aliquotLink.isVisible().catch(() => false);
    console.log(`[aliquot-smoke] menu link visible: ${aliquotVisible}`);

    // 3) Navigate to /Aliquot directly (regardless of menu shape) and
    // capture the landing page.
    await page.goto("/Aliquot", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.screenshot({
      path: `${SHOTS}/03-aliquot-page.png`,
      fullPage: true,
    });

    // Sanity: the page title from <Heading><FormattedMessage id="aliquot"/>
    // resolves to "Aliquot" in en.json.
    await expect(
      page.getByRole("heading", { name: /aliquot/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
