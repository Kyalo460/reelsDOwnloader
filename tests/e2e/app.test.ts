// E2E Tests

import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load successfully', async ({ page }) => {
    await expect(page).toHaveTitle(/ReelDownloader/);
  });

  test('should display hero section', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Download Instagram Reels');
  });

  test('should have URL input', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', /instagram\.com\/reel/);
  });

  test('should have paste button', async ({ page }) => {
    const pasteButton = page.locator('button[aria-label="Paste from clipboard"]');
    await expect(pasteButton).toBeVisible();
  });
});

test.describe('URL Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show error for invalid URL', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');

    await input.fill('https://example.com/invalid');
    await submitButton.click();

    await expect(page.locator('text=Only Instagram URLs are supported')).toBeVisible();
  });

  test('should show error for empty URL', async ({ page }) => {
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    await expect(page.locator('text=URL is required')).toBeVisible();
  });

  test('should show error for non-HTTPS URL', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');

    await input.fill('http://www.instagram.com/reel/ABC123/');
    await submitButton.click();

    await expect(page.locator('text=Only HTTPS URLs are allowed')).toBeVisible();
  });
});

test.describe('Reel Resolution', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show loading state during resolution', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');

    await input.fill('https://www.instagram.com/reel/ABC123/');

    // Mock API response
    await page.route('/api/reels/resolve', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test123',
            title: 'Test Reel',
            thumbnail: 'https://example.com/thumb.jpg',
            duration: 30,
            media: [
              { quality: 'hd', format: 'mp4', downloadUrl: '/api/reels/download/test123/hd' },
              { quality: 'sd', format: 'mp4', downloadUrl: '/api/reels/download/test123/sd' },
            ],
            shortCode: 'ABC123',
          },
        }),
      });
    });

    await submitButton.click();

    // Should show loading state
    await expect(page.locator('button:has-text("Resolving...")')).toBeVisible();
  });

  test('should display preview after successful resolution', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');

    await input.fill('https://www.instagram.com/reel/ABC123/');

    await page.route('/api/reels/resolve', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test123',
            title: 'Test Reel',
            thumbnail: 'https://example.com/thumb.jpg',
            duration: 30,
            media: [
              { quality: 'hd', format: 'mp4', downloadUrl: '/api/reels/download/test123/hd' },
              { quality: 'sd', format: 'mp4', downloadUrl: '/api/reels/download/test123/sd' },
            ],
            shortCode: 'ABC123',
          },
        }),
      });
    });

    await submitButton.click();

    // Wait for preview to appear
    await expect(page.locator('h2:has-text("Test Reel")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('img[alt*="Test Reel"]')).toBeVisible();
  });

  test('should show error for private content', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');

    await input.fill('https://www.instagram.com/reel/PRIVATE123/');

    await page.route('/api/reels/resolve', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            code: 'PRIVATE_CONTENT',
            message: 'This content is from a private account',
          },
        }),
      });
    });

    await submitButton.click();

    await expect(page.locator('text=This content is from a private account')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show error for not found content', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');

    await input.fill('https://www.instagram.com/reel/NOTFOUND/');

    await page.route('/api/reels/resolve', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Reel not found or has been deleted',
          },
        }),
      });
    });

    await submitButton.click();

    await expect(page.locator('text=Reel not found or has been deleted')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Download', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Mock successful resolution
    await page.route('/api/reels/resolve', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test123',
            title: 'Test Reel',
            thumbnail: 'https://example.com/thumb.jpg',
            duration: 30,
            media: [
              { quality: 'hd', format: 'mp4', downloadUrl: '/api/reels/download/test123/hd' },
              { quality: 'sd', format: 'mp4', downloadUrl: '/api/reels/download/test123/sd' },
            ],
            shortCode: 'ABC123',
          },
        }),
      });
    });

    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');
    await input.fill('https://www.instagram.com/reel/ABC123/');
    await submitButton.click();
    await expect(page.locator('h2:has-text("Test Reel")')).toBeVisible({ timeout: 10000 });
  });

  test('should show download options', async ({ page }) => {
    await expect(page.locator('text=Available Downloads')).toBeVisible();
    await expect(page.locator('text=HD')).toBeVisible();
    await expect(page.locator('text=SD')).toBeVisible();
  });

  test('should trigger download on button click', async ({ page }) => {
    // Mock download endpoint
    await page.route('/api/reels/download/test123/hd', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: {
          'Content-Disposition': 'attachment; filename="test-reel-hd.mp4"',
        },
        body: Buffer.from('fake video content'),
      });
    });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("HD")').first().click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('.mp4');
  });
});

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should toggle between light and dark mode', async ({ page }) => {
    // Check initial theme (should be system preference)
    const html = page.locator('html');

    // Click dark mode button
    await page.locator('button[aria-label="Switch to dark mode"]').click();
    await expect(html).toHaveClass(/dark/);

    // Click light mode button
    await page.locator('button[aria-label="Switch to light mode"]').click();
    await expect(html).toHaveClass(/light/);

    // Click system mode button
    await page.locator('button[aria-label="Switch to system mode"]').click();
  });
});

test.describe('Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('input[type="url"]')).toBeVisible();
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('nav')).toBeVisible();
  });
});

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have proper heading hierarchy', async ({ page }) => {
    const h1 = page.locator('h1');
    const h2 = page.locator('h2');

    await expect(h1).toHaveCount(1);
    await expect(h2.first()).toBeVisible();
  });

  test('should have proper form labels', async ({ page }) => {
    const input = page.locator('input[type="url"]');
    await expect(input).toHaveAttribute('aria-label', 'Instagram Reel URL');
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.locator('input[type="url"]')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('button[type="submit"]')).toBeFocused();
  });

  test('should have alt text for images', async ({ page }) => {
    // Mock resolution to show preview with image
    await page.route('/api/reels/resolve', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test123',
            title: 'Test Reel',
            thumbnail: 'https://example.com/thumb.jpg',
            duration: 30,
            media: [
              { quality: 'hd', format: 'mp4', downloadUrl: '/api/reels/download/test123/hd' },
            ],
            shortCode: 'ABC123',
          },
        }),
      });
    });

    const input = page.locator('input[type="url"]');
    const submitButton = page.locator('button[type="submit"]');
    await input.fill('https://www.instagram.com/reel/ABC123/');
    await submitButton.click();

    await expect(page.locator('img[alt*="Test Reel"]')).toBeVisible({ timeout: 10000 });
  });
});
