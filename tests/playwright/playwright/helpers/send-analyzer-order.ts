import { expect, type Page } from "@playwright/test";
import { UI_TIMEOUT } from "./timeouts";

/**
 * Drive the SendToAnalyzerButton flow on the ModifyOrder page:
 *   1. Click the "Send to analyzer" Carbon Button (data-cy="send-to-analyzer").
 *   2. Wait for the modal to open.
 *   3. Pick the analyzer by display name (matched as substring of the option text).
 *   4. Click the modal's primary "Send" button.
 *   5. Assert the success notification appears with text "Order dispatched".
 *
 * Callers stage the analyzer (createAnalyzerFromProfile) and navigate the page
 * to ModifyOrder?accessionNumber=... before invoking.
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
  const select = page.locator('select#send-order-analyzer-select');
  await select.selectOption({ label: new RegExp(opts.analyzerName, "i") });

  // The modal's primary "Send" button matches name /^Send$/ exactly, so it
  // doesn't collide with the outer "Send to analyzer" trigger.
  await page.getByRole("button", { name: /^Send$/ }).click();

  if (expectSuccess) {
    await expect(page.getByText(/order dispatched/i)).toBeVisible({
      timeout: UI_TIMEOUT,
    });
  }
}
