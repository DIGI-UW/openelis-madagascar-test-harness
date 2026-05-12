import { Page, Locator, expect } from "@playwright/test";
import { SHORT_TIMEOUT, UI_TIMEOUT } from "./timeouts";

/**
 * Carbon Design System form-interaction helpers.
 *
 * Encapsulates patterns that recur across Carbon-form Playwright specs:
 *   - TextInput / TextArea: id-based locator + fill + Tab to commit
 *   - Select: native <select> with role=combobox; selectOption by value
 *   - RadioButton: native-setter on `checked` + change event + commit blur
 *   - DatePicker: id="date-picker-default-id" by Carbon convention; uses
 *     dd/mm/yyyy or mm/dd/yyyy slashes (not ISO dashes)
 *
 * Add new helpers here, not inline in specs.
 */

/** Fill a Carbon TextInput / TextArea and commit the value via Tab/blur. */
export async function fillCarbonInput(
  target: Locator | { page: Page; selector: string },
  value: string,
  options: { timeout?: number } = {},
): Promise<void> {
  const locator =
    "page" in target ? target.page.locator(target.selector) : target;
  await expect(locator).toBeVisible({
    timeout: options.timeout ?? UI_TIMEOUT,
  });
  await locator.fill(value);
  await locator.press("Tab");
}

/** Carbon Select: pick an option by exact value attribute. */
export async function pickCarbonSelectByValue(
  target: Locator | { page: Page; selector: string },
  value: string,
  options: { timeout?: number } = {},
): Promise<void> {
  const locator =
    "page" in target ? target.page.locator(target.selector) : target;
  await expect(locator).toBeEnabled({
    timeout: options.timeout ?? UI_TIMEOUT,
  });
  await locator.selectOption(value);
}

/** Pick the first non-empty option in a Carbon Select. Returns the value. */
export async function pickFirstCarbonOption(
  target: Locator | { page: Page; selector: string },
  options: { timeout?: number } = {},
): Promise<string> {
  const locator =
    "page" in target ? target.page.locator(target.selector) : target;
  await expect(locator).toBeEnabled({
    timeout: options.timeout ?? UI_TIMEOUT,
  });
  const optionValues: string[] = await locator.evaluate(
    (el: HTMLSelectElement) =>
      Array.from(el.options)
        .map((o) => o.value)
        .filter(Boolean),
  );
  if (optionValues.length === 0) {
    throw new Error("No non-empty options found in Carbon Select");
  }
  await locator.selectOption(optionValues[0]);
  return optionValues[0];
}

/**
 * Carbon RadioButton: set `checked` via the native HTMLInputElement setter
 * and dispatch a bubbling change event so React's tracker fires onChange.
 *
 * Carbon hides the input off-screen for visual styling, so a normal click
 * won't reach it. The native-setter approach commits the value via React's
 * own change-event mechanism. Pass `commitFocusSelector` to focus another
 * field afterward (some controlled-form libraries require a follow-up
 * interaction before they commit a radio change to bound state).
 */
export async function clickCarbonRadio(
  page: Page,
  inputId: string,
  options: { timeout?: number; commitFocusSelector?: string } = {},
): Promise<void> {
  const label = page.locator(`label[for="${inputId}"]`);
  await expect(label).toHaveCount(1, {
    timeout: options.timeout ?? SHORT_TIMEOUT,
  });
  await label.first().click({ force: true });
  if (options.commitFocusSelector) {
    await page.locator(options.commitFocusSelector).first().focus();
  } else {
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  }
}

/**
 * Carbon Toggle: click via the label wrapper, with `force: true` because
 * Carbon's appearance div sits above the input and intercepts normal pointer
 * events. Matches the shape of `clickCarbonRadio` — pass the toggle's id.
 */
export async function clickCarbonToggle(
  page: Page,
  inputId: string,
  options: { timeout?: number } = {},
): Promise<void> {
  const label = page.locator(`#${inputId}_label, label[for="${inputId}"]`);
  await expect(label.first()).toBeVisible({
    timeout: options.timeout ?? UI_TIMEOUT,
  });
  await label.first().click({ force: true });
}

/**
 * Carbon CustomDatePicker (flatpickr-wrapped). Carbon convention is
 * id="date-picker-default-id"; pass a `scope` locator if multiple date
 * pickers share the page (otherwise .first() picks the visible one).
 *
 * Calls flatpickr's setDate API directly via the instance attached to the
 * input element as `_flatpickr`. Plain .fill() doesn't reliably fire
 * flatpickr's onChange; setDate with the second arg true does.
 *
 * Pass `value` in any flatpickr-parseable format. ISO yyyy-mm-dd is the
 * most reliable.
 */
export async function fillCarbonDatePicker(
  page: Page,
  value: string,
  options: { scope?: Locator; timeout?: number } = {},
): Promise<void> {
  const baseLocator = options.scope ?? page;
  const locator = baseLocator.locator("input#date-picker-default-id").first();
  await expect(locator).toBeVisible({
    timeout: options.timeout ?? UI_TIMEOUT,
  });
  await locator.evaluate((el: HTMLInputElement & { _flatpickr?: any }, v) => {
    if (el._flatpickr) {
      el._flatpickr.setDate(v, true);
    } else {
      // Fallback if flatpickr isn't attached yet — type the value and blur.
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, value);
}

/**
 * Capture form input values + visible errors into a serializable record.
 * Keys are caller-defined; selectors are queried via document.querySelector.
 */
export async function dumpFormState(
  page: Page,
  selectors: Record<string, string>,
): Promise<Record<string, string | null> & { visibleErrors: string[] }> {
  return page.evaluate((sels: Record<string, string>) => {
    const result: Record<string, string | null> = {};
    for (const [key, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      result[key] = el?.value ?? null;
    }
    const errors = Array.from(
      document.querySelectorAll(".error, [role='alert']"),
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean);
    return { ...result, visibleErrors: errors };
  }, selectors) as Promise<
    Record<string, string | null> & { visibleErrors: string[] }
  >;
}
