import { test, expect } from "@playwright/test";

/**
 * OGC-650 end-to-end validation — confirm the PATCO (Patient Coordinates)
 * program seed is fully wired on mgtest:
 *
 *   1. /rest/user-programs returns PATCO in the program list
 *   2. /rest/programs/{id}/questionnaire (or whatever ProgramSection.jsx
 *      fetches) returns the FHIR Questionnaire with Latitude + Longitude items
 *   3. Order entry form actually renders the program in its picker
 *
 * If any of these fail, the seed isn't fully active even though the
 * configs/programs/PatientGPS.json file exists in distro and the program
 * row is in clinlims.program. Reload of the distro program loader may be needed.
 */

test.describe("OGC-650 PATCO program end-to-end validation", () => {
  test("PATCO appears in /rest/user-programs", async ({ request }) => {
    const resp = await request.get("/api/OpenELIS-Global/rest/user-programs");
    expect(resp.status()).toBe(200);
    const programs = await resp.json();
    console.log(
      "[OGC-650] /rest/user-programs returned:",
      JSON.stringify(programs, null, 2),
    );
    // /rest/user-programs returns IdValuePair shape: {id, value}.
    // PATCO program's display name is "Patient Coordinates".
    const patco = programs.find((p: any) => p.value === "Patient Coordinates");
    expect(
      patco,
      `PATCO program should be in the user-programs list. Got: ${JSON.stringify(programs)}`,
    ).toBeTruthy();
    console.log("[OGC-650] PATCO entry:", JSON.stringify(patco));
  });

  test("PATCO program's questionnaire has Latitude + Longitude items", async ({
    request,
  }) => {
    // First get the program list to extract PATCO's id (which the
    // questionnaire endpoint expects).
    const programsResp = await request.get(
      "/api/OpenELIS-Global/rest/user-programs",
    );
    const programs = await programsResp.json();
    const patco = programs.find((p: any) => p.value === "Patient Coordinates");
    if (!patco) {
      test.skip(true, "PATCO program not in user-programs list (covered by other test)");
      return;
    }

    // Try a few candidate endpoint shapes for fetching the questionnaire.
    // ProgramSection.jsx fetches questionnaire data when a program is selected;
    // need to find the right URL pattern.
    const candidates = [
      `/api/OpenELIS-Global/rest/programs/${patco.id}/questionnaire`,
      `/api/OpenELIS-Global/rest/program/${patco.id}/questionnaire`,
      `/api/OpenELIS-Global/rest/program-questionnaire?programId=${patco.id}`,
      `/api/OpenELIS-Global/rest/program/${patco.id}`,
    ];

    let foundQuestionnaire: any = null;
    for (const url of candidates) {
      const r = await request.get(url);
      console.log(`[OGC-650 candidate] ${url} -> ${r.status()}`);
      if (r.ok()) {
        const body = await r.json();
        console.log(
          `[OGC-650 candidate body 0..600]:`,
          JSON.stringify(body).substring(0, 600),
        );
        // Look for FHIR Questionnaire shape with item[]
        if (body && (body.item || body.additionalOrderEntryQuestions)) {
          foundQuestionnaire = body.additionalOrderEntryQuestions ?? body;
          break;
        }
      }
    }

    expect(
      foundQuestionnaire,
      "Could not find a working endpoint to fetch PATCO's questionnaire — likely requires an order context or different URL shape; spec may need adjustment",
    ).toBeTruthy();

    if (foundQuestionnaire) {
      const items = foundQuestionnaire.item ?? [];
      const latItem = items.find((i: any) =>
        /latitude/i.test(i.text || i.linkId || ""),
      );
      const longItem = items.find((i: any) =>
        /longitude/i.test(i.text || i.linkId || ""),
      );
      console.log(
        "[OGC-650] Questionnaire items count:",
        items.length,
        "latItem:",
        JSON.stringify(latItem),
        "longItem:",
        JSON.stringify(longItem),
      );
      expect(latItem, "Questionnaire should include a Latitude item").toBeTruthy();
      expect(longItem, "Questionnaire should include a Longitude item").toBeTruthy();
    }
  });
});
