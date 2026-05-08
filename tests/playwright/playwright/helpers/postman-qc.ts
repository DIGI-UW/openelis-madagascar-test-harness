import * as fs from "fs";
import * as path from "path";
import { expect, Page } from "@playwright/test";
import type { DemoPresentation } from "./demo-presentation";

type PostmanVariable = { key: string; value?: string };
type PostmanUrl = { raw?: string };
type PostmanBody = { mode?: string; raw?: string };
type PostmanRequest = {
  method?: string;
  url?: PostmanUrl;
  header?: Array<{ key?: string; value?: string }>;
  body?: PostmanBody;
};
type PostmanItem = {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
};
type PostmanCollection = {
  variable?: PostmanVariable[];
  item?: PostmanItem[];
};

type PostmanEnv = {
  values?: Array<{ key?: string; value?: string; enabled?: boolean }>;
};

type ExecuteResult = {
  status: number;
  json: any;
};

export type QcScenario = {
  title: string;
  subtitle: string;
  postmanPath: string[];
  instrumentName: string;
  testName: string;
  expectedRuleCode?: string;
  expectedSeverity?: string;
};

const COLLECTION_PATH = path.resolve(
  __dirname,
  "../../../postman/openelis-mgtest-qc.postman_collection.json",
);
const ENV_PATH = path.resolve(
  __dirname,
  "../../../postman/openelis-mgtest.postman_environment.json",
);

function extractResponseData(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.violations)) return payload.data.violations;
  if (Array.isArray(payload?.violations)) return payload.violations;
  return [];
}

function variableMap(
  collection: PostmanCollection,
  env: PostmanEnv,
  overrides?: Record<string, string>,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const v of collection.variable || []) {
    if (v.key) vars[v.key] = v.value || "";
  }
  for (const v of env.values || []) {
    if (v.key && v.enabled !== false) vars[v.key] = v.value || "";
  }
  return { ...vars, ...(overrides || {}) };
}

function resolveTemplate(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, k) => vars[k.trim()] ?? "");
}

function findPostmanItemInternal(items: PostmanItem[] = [], parts: string[]): PostmanItem {
  const [head, ...rest] = parts;
  const found = items.find((it) => it.name === head);
  if (!found) throw new Error(`Postman item not found: ${parts.join(" / ")}`);
  if (rest.length === 0) return found;
  return findPostmanItemInternal(found.item || [], rest);
}

export function loadPostmanCollection(): PostmanCollection {
  return JSON.parse(fs.readFileSync(COLLECTION_PATH, "utf-8"));
}

export function loadPostmanEnvironment(): PostmanEnv {
  return JSON.parse(fs.readFileSync(ENV_PATH, "utf-8"));
}

export function findPostmanItem(pathParts: string[]): PostmanItem {
  const collection = loadPostmanCollection();
  return findPostmanItemInternal(collection.item || [], pathParts);
}

export function resolvePostmanVariables(
  request: PostmanRequest,
  overrides?: Record<string, string>,
) {
  const collection = loadPostmanCollection();
  const env = loadPostmanEnvironment();
  const vars = variableMap(collection, env, overrides);

  const method = request.method || "GET";
  const url = resolveTemplate(request.url?.raw || "", vars);
  const headers: Record<string, string> = {};
  for (const header of request.header || []) {
    if (header.key) headers[header.key] = resolveTemplate(header.value || "", vars);
  }

  let body: string | undefined;
  if (request.body?.mode === "raw" && request.body.raw) {
    body = resolveTemplate(request.body.raw, vars);
  }
  return { method, url, headers, body };
}

export async function executePostmanItem(
  page: Page,
  pathParts: string[],
  overrides?: Record<string, string>,
): Promise<ExecuteResult> {
  const item = findPostmanItem(pathParts);
  const req = item.request;
  if (!req) throw new Error(`Postman request missing for ${pathParts.join(" / ")}`);
  const resolved = resolvePostmanVariables(req, overrides);
  const resp = await page.request.fetch(resolved.url, {
    method: resolved.method,
    headers: resolved.headers,
    data: resolved.body,
  });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status(), json };
}

export async function pollQcViolations(
  page: Page,
  predicate: (violation: any) => boolean,
  timeoutMs = 90_000,
): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await page.request.get(
      "/api/OpenELIS-Global/rest/qc/violations?unresolved=true",
    );
    expect(response.status()).toBe(200);
    const payload = await response.json().catch(() => []);
    const list = extractResponseData(payload);
    const hit = list.find(predicate);
    if (hit) return hit;
    await page.waitForTimeout(2_000);
  }
  throw new Error("Timed out waiting for matching QC violation");
}

export async function pollQcInstrument(
  page: Page,
  instrumentName: string,
  timeoutMs = 90_000,
): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await page.request.get(
      "/api/OpenELIS-Global/rest/qc/dashboard/instruments",
    );
    expect(response.status()).toBe(200);
    const payload = await response.json().catch(() => []);
    const instruments = extractResponseData(payload);
    const hit = instruments.find((inst: any) =>
      String(inst.instrumentName || "").toLowerCase().includes(instrumentName.toLowerCase()),
    );
    if (hit) return hit;
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Timed out waiting for instrument '${instrumentName}'`);
}

export async function openQcDashboard(
  page: Page,
  presentation: DemoPresentation,
): Promise<void> {
  await presentation.scene("QC Dashboard");
  await page.goto("/analyzers/qc/db", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("qc-dashboard")).toBeVisible();
  await expect(page.getByTestId("qc-summary-tiles")).toBeVisible();
  await expect(page.getByTestId("instruments-table")).toBeVisible();
}

export async function verifyQcDashboardUi(
  page: Page,
  scenario: QcScenario,
  instrument: any,
  presentation: DemoPresentation,
): Promise<void> {
  await expect(page.getByTestId("instruments-table")).toContainText(
    scenario.instrumentName,
  );

  const rowId = String(instrument.instrumentId || instrument.id || "");
  if (rowId) {
    await expect(page.getByTestId(`instrument-row-${rowId}`)).toContainText(
      scenario.testName,
    );
  }

  await page.getByTestId("qc-tab-alerts").click();
  await expect(page.getByTestId("alerts-tab")).toBeVisible();
  await expect(page.getByTestId("alerts-active-section")).toContainText(
    scenario.instrumentName,
  );

  await presentation.evidence(`qc-dashboard-${scenario.instrumentName}`);
}
