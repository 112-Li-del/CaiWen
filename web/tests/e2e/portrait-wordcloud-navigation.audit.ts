import { test, expect } from '@playwright/test'

// Run against seeded portrait data with AUTH_ENABLED=false, or provide an
// authenticated demo user's storage state through PW_STORAGE_STATE.
test.use({ storageState: process.env.PW_STORAGE_STATE })

test('word cloud round trips keep the overview usable without document navigation', async ({ page }) => {
  await page.goto('/portrait/overview')
  const cloud = page.locator('[aria-label="学生标签云"], [aria-label="班级标签云"]')
  await expect(cloud).toBeVisible({ timeout: 20_000 })
  const documentRequests: string[] = []
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentRequests.push(request.url())
    }
  })

  // Cover the page's own back button and the browser's Back action twice.
  for (const back of ['button', 'browser', 'button', 'browser']) {
    await cloud.click()
    await expect(page).toHaveURL(/\/portrait\/wordcloud\//)
    await expect(page.getByRole('heading', { name: '完整画像词云', exact: true })).toBeVisible()
    if (back === 'button') {
      await page.getByRole('button', { name: '返回上一页', exact: true }).click()
    } else {
      await page.goBack()
    }
    await expect(page).toHaveURL(/\/portrait\/overview$/)
    await expect(cloud).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('正在读取画像数据…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '学业表现', exact: true })).toBeVisible()
  }
  // The old window.location.href entry always triggers a document request.
  expect(documentRequests).toEqual([])
})
