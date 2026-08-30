/**
 * Fails if the 3x3 grid ends up behind the iPhone keyboard in typed mode.
 *
 *   npx expo export --platform web --output-dir dist/web-check --clear
 *   npx http-server dist/web-check -p 8099 -s &
 *   node scripts/check-keyboard-layout.mjs 8099
 *
 * Needs playwright, which is not a project dependency — install it wherever
 * you run this (`npm i playwright && npx playwright install chromium`).
 *
 * **Why this is not a jest test.** The bug is a flexbox resolution rule:
 * `flex: 1` compiles to `flex: 1 1 0%`, and flex-basis beats an explicit
 * `height` on a flex item, so pinning the screen to the visual viewport did
 * nothing and the grid went on filling the whole window. React Native's test
 * renderer does no layout at all, so nothing in the jest suite can see it.
 * A real engine has to lay it out.
 *
 * **Why it does not just resize the window.** iOS Safari draws the keyboard
 * over the page: the LAYOUT viewport stays the full window height and only
 * the VISUAL viewport shrinks. Resizing a desktop window shrinks both, which
 * hides the bug completely — the first version of this check passed against
 * the very build the phone was failing on. The fake below pins the window and
 * moves `visualViewport.height` alone.
 */
import { chromium } from 'playwright';

/** What a keyboard actually leaves: screen minus URL bar, keys, accessory row. */
const KEYBOARD_HEIGHTS = [400, 360, 330, 300];
const WINDOW = { width: 390, height: 780 };

const fakeVisualViewport = () => {
  const listeners = {};
  let height = window.innerHeight;
  const viewport = {
    get height() {
      return height;
    },
    get offsetTop() {
      return 0;
    },
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: () => {},
  };
  Object.defineProperty(window, 'visualViewport', {
    get: () => viewport,
    configurable: true,
  });
  window.__keyboard = (n) => {
    height = n;
    (listeners.resize || []).forEach((fn) => fn());
  };
};

const port = process.argv[2] || '8099';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: WINDOW });
await page.addInitScript(fakeVisualViewport);
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

await page.getByTestId('series-capital-call').click();
await page.getByTestId('warmup-start').click();
await page.waitForSelector('[data-testid="cell-8"]', { timeout: 15000 });

let failed = 0;
for (const visible of [WINDOW.height, ...KEYBOARD_HEIGHTS]) {
  await page.evaluate((n) => window.__keyboard(n), visible);
  await page.waitForTimeout(300);

  const boxes = [];
  for (let i = 0; i < 9; i++) {
    boxes.push(await page.locator(`[data-testid="cell-${i}"]`).boundingBox());
  }
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const clipped = boxes.filter((b) => b.y + b.height > visible + 0.5).length;
  if (clipped) failed++;

  console.log(
    `visible=${String(visible).padEnd(3)}  cell=${String(Math.round(boxes[0].width)).padStart(3)}px  ` +
      `grid bottom=${String(Math.round(bottom)).padStart(3)}  ` +
      (clipped ? `FAIL ${clipped}/9 behind the keyboard` : 'ok'),
  );
}

await browser.close();
process.exit(failed ? 1 : 0);
