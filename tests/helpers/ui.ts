import type { Page, TestInfo } from '@playwright/test'

/** The iPhone project uses the phone shell (tab bar, sheets, no header import button). */
export const isPhone = (info: TestInfo) => info.project.name === 'mobile-webkit'

/**
 * The header's import button doubles as the "library connected" signal. On phones it is not shown, so tests read
 * it by class: its enabled state is the same either way.
 */
export const importButton = (page: Page) => page.locator('.topbar .import-top')

/** Desktop rows have a quick "add to queue" button; phones add from the song's options sheet. */
export async function addToQueue(page: Page, info: TestInfo, title: string) {
  if (!isPhone(info)) return page.getByRole('button', { name: `Añadir a la cola: ${title}`, exact: true }).click()
  await page.getByRole('button', { name: `Opciones de ${title}`, exact: true }).first().click()
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Añadir a la cola', exact: true }).click()
}
