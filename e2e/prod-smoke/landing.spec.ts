import { test, expect } from "@playwright/test";

type SmokeWindow = typeof window & { __aegisCspViolations: string[] };

test("production landing enters the demo without CSP violations or page errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as SmokeWindow).__aegisCspViolations = violations;
    document.addEventListener("securitypolicyviolation", event => {
      violations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Try the Demo", exact: true }).click();
  await expect(page.getByTestId("aegis-dashboard")).toBeVisible();

  const violations = await page.evaluate(() => (window as SmokeWindow).__aegisCspViolations);
  expect.soft(violations, "CSP violations during landing and demo navigation").toEqual([]);
  expect.soft(pageErrors, "Uncaught page errors during landing and demo navigation").toEqual([]);
});
