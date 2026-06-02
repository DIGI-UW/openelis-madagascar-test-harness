import { expect, type Page } from "@playwright/test";
import { UI_TIMEOUT } from "./timeouts";

/**
 * Drive the SendToAnalyzerButton flow on the accession results page:
 *   1. Click the "Send to analyzer" Carbon Button (data-cy="send-to-analyzer").
 *   2. Wait for the modal to open.
 *   3. Pick the analyzer by display name (matched as substring of the option text).
 *   4. Click the modal's primary "Send" button.
 *   5. Assert the success notification appears with text "Order dispatched".
 *
 * Callers stage the analyzer (createAnalyzerFromProfile) and navigate the page
 * to AccessionResults?accessionNumber=... before invoking.
 */
export async function sendOrderToAnalyzer(
  page: Page,
  opts: { analyzerName: string; expectSuccess?: boolean },
) {
  const expectSuccess = opts.expectSuccess ?? true;

  await page.locator('[data-cy="send-to-analyzer"]').click();

  const modalHeading = page.getByText(/send order to analyzer/i);
  await expect(modalHeading).toBeVisible({ timeout: UI_TIMEOUT });

  // Carbon <Select> exposes a native <select>; pick the option whose visible
  // label contains the analyzer name (the option text is
  // "<name> (<protocolVersion>)").
  // Read the native <select>'s options directly (robust for native selects) and
  // pick the one whose text contains the analyzer name; select by value.
  const select = page.locator('select#send-order-analyzer-select');
  await expect(select).toBeVisible({ timeout: UI_TIMEOUT });
  const options = await select.evaluate((el: HTMLSelectElement) =>
    Array.from(el.options).map((o) => ({ value: o.value, text: o.textContent || "" })),
  );
  const match = options.find((o) =>
    o.text.toLowerCase().includes(opts.analyzerName.toLowerCase()),
  );
  if (!match) {
    throw new Error(
      `No analyzer option matching "${opts.analyzerName}" in send-order dropdown. ` +
        `Available options: ${JSON.stringify(options)}`,
    );
  }
  await select.selectOption(match.value);

  // The modal's primary "Send" button matches name /^Send$/ exactly, so it
  // doesn't collide with the outer "Send to analyzer" trigger.
  await page.getByRole("button", { name: /^Send$/ }).click();

  if (expectSuccess) {
    await expect(page.getByText(/order dispatched/i)).toBeVisible({
      timeout: UI_TIMEOUT,
    });
  }
}
