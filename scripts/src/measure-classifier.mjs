/** Local classifier-only probe: no microphone, authentication, audio or paid API.
 * Pass a verified public app URL and its versioned classifier asset path.
 * CHROMIUM_PATH may select the locally installed Chromium binary. */
import { chromium } from 'playwright-core';
const [origin, asset] = process.argv.slice(2);
if (!origin || !asset || !asset.startsWith('/assets/')) throw new Error('Usage: node src/measure-classifier.mjs https://host /assets/speech-classifier-<hash>.js');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium',
  headless: true, args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.goto(origin);
  for (let iteration = 0; iteration < 3; iteration++) {
    const result = await page.evaluate(async ({ asset, iteration }) => {
      const began = performance.now();
      const { createSpeechClassifier } = await import(asset);
      const phases = {};
      const classifier = await createSpeechClassifier(new AbortController().signal, async (phase, operation) => {
        const start = performance.now();
        try { return await operation(); } finally { phases[phase] = performance.now() - start; }
      });
      const initializedMs = performance.now() - began;
      await classifier.close();
      return { iteration, initializedMs, phases };
    }, { asset, iteration });
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); }
