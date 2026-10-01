import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RUNTIME_CONFIG,
  launchChromium,
  startStaticServer,
} from "./source.js";

let browser;
let server;
let base;

before(async () => {
  browser = await launchChromium();
  if (browser)
    ({ server, base } = await startStaticServer({
      runtimeConfig:
        DEFAULT_RUNTIME_CONFIG +
        `
globalThis.CODETRIAL_COMPILER_EXPLORER_ENABLED = true;
globalThis.CODETRIAL_COMPILER_EXPLORER_BASE_URL = "https://compiler.invalid";
`,
    }));
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("an interview loads only selected grammars and Enter works during a switch", async (t) => {
  if (!browser) return t.skip("Chromium is not installed");
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  let release;
  const download = new Promise((resolve) => {
    release = resolve;
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/tree-sitter") && path.endsWith(".wasm"))
      requests.push(path.split("/").at(-1));
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/tree-sitter-javascript.wasm", async (route) => {
    await download;
    await route.continue();
  });
  const select = (language) =>
    page.evaluate((language) => {
      document.querySelector(`[data-language="${language}"]`).click();
      document.querySelector("#editor").focus();
    }, language);
  const setCode = (value) =>
    page.evaluate((value) => {
      const editor = document.querySelector("#editor");
      editor.value = value;
      editor.setSelectionRange(value.length, value.length);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.focus();
    }, value);
  const snapshot = () =>
    page.evaluate(() => {
      const editor = document.querySelector("#editor");
      return {
        value: editor.value,
        start: editor.selectionStart,
        end: editor.selectionEnd,
      };
    });
  try {
    await page.goto(base + "/interview.html?problem=chargeback-pair-match", {
      waitUntil: "domcontentloaded",
    });
    // C becomes selectable only after the judge callback has run.
    await page.waitForSelector('[data-language="c"]:not([disabled])');
    await page.waitForSelector("#editor:not([disabled])");
    await page.evaluate(async () => {
      const { prepareLanguage } = await import("/syntax-parser.js");
      await prepareLanguage("python");
    });
    assert.deepEqual(requests.toSorted(), [
      "tree-sitter-python.wasm",
      "tree-sitter.wasm",
    ]);

    const python = "    if ready:";
    await setCode(python);
    await select("javascript");
    const code = "const text = `\n/*\n`;\n    if (ready) {";
    await setCode(code);
    await page.keyboard.press("Enter");
    const expected = code + "\n        ";
    assert.deepEqual(await snapshot(), {
      value: expected,
      start: expected.length,
      end: expected.length,
    });
    assert.equal(
      await page.evaluate(async () => {
        const { parseSyntax } = await import("/syntax-parser.js");
        return parseSyntax("const value = 1;", "javascript");
      }),
      null,
    );

    await select("python");
    assert.equal((await snapshot()).value, python);
    await select("javascript");
    assert.equal((await snapshot()).value, expected);
    release();
    await page.evaluate(async () => {
      const { prepareLanguage } = await import("/syntax-parser.js");
      await prepareLanguage("javascript");
    });
    const parsedCode = "function f() {}\n/\\/*/.test(text);\n    if (ready) {";
    await setCode(parsedCode);
    await page.keyboard.press("Enter");
    const parsedExpected = parsedCode + "\n        ";
    assert.deepEqual(await snapshot(), {
      value: parsedExpected,
      start: parsedExpected.length,
      end: parsedExpected.length,
    });
    assert.deepEqual(requests.toSorted(), [
      "tree-sitter-javascript.wasm",
      "tree-sitter-python.wasm",
      "tree-sitter.wasm",
    ]);
    assert.deepEqual(errors, []);
  } finally {
    release();
    await page.close();
  }
});

test("the browser loads all grammars locally and reuses prepared languages", async (t) => {
  if (!browser) return t.skip("Chromium is not installed");
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  page.on("request", (request) => {
    requests.push(request.url());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await page.route("**/syntax-parser-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'",
      },
      body: "<!doctype html><title>Syntax parser</title>",
    }),
  );
  try {
    await page.goto(base + "/syntax-parser-probe");
    const cases = [
      ["c", "int value = 1;", "translation_unit"],
      ["cpp", 'auto text = R"tag(/*)tag";', "translation_unit"],
      ["java", "class A {}", "program"],
      [
        "javascript",
        "class A { #return=4; f() { return this.#return / 2; } }",
        "program",
      ],
      ["python", "value = 1\n", "module"],
    ];
    const parsed = await page.evaluate(async (cases) => {
      const { prepareLanguage, parseSyntax } =
        await import("/syntax-parser.js");
      await Promise.all(cases.map(([language]) => prepareLanguage(language)));
      await prepareLanguage("javascript");
      return cases.map(([language, code]) => {
        const tree = parseSyntax(code, language);
        try {
          return [
            language,
            tree.rootNode.type,
            tree.rootNode.hasError,
            tree.rootNode.endIndex,
          ];
        } finally {
          tree?.delete();
        }
      });
    }, cases);
    assert.deepEqual(
      parsed,
      cases.map(([language, code, root]) => [
        language,
        root,
        false,
        code.length,
      ]),
    );
    assert.deepEqual(errors, []);
    assert.ok(requests.every((url) => url.startsWith(base + "/")));
    const assets = requests.filter((url) => url.includes("/vendor/"));
    assert.equal(assets.length, 7);
    assert.equal(new Set(assets).size, 7);
  } finally {
    await page.close();
  }
});
