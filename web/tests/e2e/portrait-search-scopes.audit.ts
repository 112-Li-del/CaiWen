import { test, expect } from '@playwright/test'

// Seed the demo cohort and provide an administrator's PW_STORAGE_STATE.
test.use({ storageState: process.env.PW_STORAGE_STATE })

test('administrator global search stays global after selecting a teacher', async ({ page }) => {
  await page.goto('/portrait/overview')
  const global = page.getByRole('button', { name: '全校搜索 · 学生 / 教师', exact: true })
  await global.click()
  let dialog = page.getByRole('dialog', { name: '全校人员搜索' })
  const classCount = await dialog.getByLabel('筛选班级').locator('option').count()
  await dialog.getByRole('button', { name: '教师', exact: true }).click()
  await dialog.getByRole('button').filter({ hasText: '演示教师01' }).click()
  await expect(page.getByText('教师所管范围', { exact: true })).toBeVisible()

  const globalResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/portrait/people') && url.searchParams.get('kind') === 'student' && !url.searchParams.has('teacher_id')
  })
  await global.click()
  await globalResponse
  dialog = page.getByRole('dialog', { name: '全校人员搜索' })
  await expect(dialog.getByLabel('筛选班级').locator('option')).toHaveCount(classCount)
  await dialog.getByLabel('搜索人员').fill('stu090')
  await expect(dialog.getByRole('button').filter({ hasText: 'stu090' })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭人员选择' }).click()

  const scopedResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/portrait/people') && url.searchParams.has('teacher_id')
  })
  await page.getByRole('button', { name: '查找该教师的学生', exact: true }).click()
  await scopedResponse
  dialog = page.getByRole('dialog', { name: '所管学生搜索' })
  await expect(dialog.getByRole('button', { name: '教师', exact: true })).toHaveCount(0)
  await dialog.getByLabel('搜索人员').fill('stu090')
  await expect(dialog.getByText('没有符合条件的学生', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭人员选择' }).click()
  await global.click()
  dialog = page.getByRole('dialog', { name: '全校人员搜索' })
  await dialog.getByRole('button').filter({ hasText: 'stu090' }).click()
  await expect(page.getByText('教师所管范围', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '演示学生090', exact: true })).toBeVisible()
})
