import { expect, type Page } from '@playwright/test';
import axeCore from 'axe-core';

export async function expectNoSeriousAxeViolations(
  page: Page,
  selector = 'main',
) {
  await page.addScriptTag({ content: axeCore.source });
  const violations = await page.evaluate(async (contextSelector) => {
    type AxeResult = {
      violations: Array<{ id: string; impact: string | null; help: string }>;
    };
    type AxeWindow = Window & {
      axe: { run(context: Element): Promise<AxeResult> };
    };
    const context = document.querySelector(contextSelector);
    if (!context) throw new Error(`Accessibility context ${contextSelector} was not found.`);
    return (window as unknown as AxeWindow).axe.run(context);
  }, selector);
  expect(
    violations.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    ),
  ).toEqual([]);
}
