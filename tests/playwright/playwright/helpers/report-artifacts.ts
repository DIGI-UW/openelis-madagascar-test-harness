import type { TestInfo } from "@playwright/test";

/**
 * Attach a PNG to the Playwright HTML report when TestInfo is available.
 */
export async function attachScreenshot(
  testInfo: TestInfo | undefined,
  name: string,
  screenshot: Buffer,
): Promise<void> {
  if (!testInfo) return;
  await testInfo.attach(name, {
    body: screenshot,
    contentType: "image/png",
  });
}
