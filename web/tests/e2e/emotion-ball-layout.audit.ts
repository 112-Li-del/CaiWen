import { test, expect } from "@playwright/test";

// Use AUTH_ENABLED=false on the test server, or supply an authenticated
// Playwright storage-state file through PW_STORAGE_STATE. No chat is submitted.
test.use({ storageState: process.env.PW_STORAGE_STATE });

for (const width of [1800, 1280, 1024, 768, 375]) {
  test(`emotion ball stays visible without overlapping the composer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/chat");
    const ball = page.locator(".cw-ball-visual");
    await expect(ball).toBeVisible();
    const ballBox = (await ball.boundingBox())!;
    const composer = (await page.locator(".cw-composer-host").boundingBox())!;
    expect(ballBox.x).toBeGreaterThanOrEqual(0);
    expect(ballBox.y).toBeGreaterThanOrEqual(0);
    expect(ballBox.x + ballBox.width).toBeLessThanOrEqual(width);
    expect(ballBox.y + ballBox.height).toBeLessThanOrEqual(800);
    const overlaps = ballBox.x < composer.x + composer.width &&
      ballBox.x + ballBox.width > composer.x &&
      ballBox.y < composer.y + composer.height &&
      ballBox.y + ballBox.height > composer.y;
    expect(overlaps, "The mascot must not cover the input or its controls").toBe(false);
    const viewport = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(viewport.scroll).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("textbox").fill("仅检查输入状态，不发送");
    await expect(page.locator(".cw-ball-tip")).toContainText("你说，我听着");
    const listening = (await ball.boundingBox())!;
    expect(Math.abs(listening.x - ballBox.x)).toBeLessThan(0.5);
    expect(Math.abs(listening.y - ballBox.y)).toBeLessThan(0.5);
    await page.getByRole("textbox").fill("");
    await expect(page.locator(".cw-ball-tip")).not.toContainText("你说，我听着");
    const idle = (await ball.boundingBox())!;
    expect(Math.abs(idle.x - ballBox.x)).toBeLessThan(0.5);
    expect(Math.abs(idle.y - ballBox.y)).toBeLessThan(0.5);
  });
}

test("opening a preview uses available pane width rather than viewport width", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/chat");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /上传附件/ }).click();
  await (await choosing).setFiles({ name: "layout-preview.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic layout fixture") });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator('.chat-preview-shell')).toHaveAttribute("data-preview-open", "true");
  const ball = page.locator(".cw-ball-visual");
  await expect(ball).toBeVisible();
  await expect.poll(async () => {
    const b = (await ball.boundingBox())!;
    const c = (await page.locator(".cw-composer-host").boundingBox())!;
    return b.y + b.height <= c.y;
  }).toBe(true);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "移除附件", exact: true }).click();
});
