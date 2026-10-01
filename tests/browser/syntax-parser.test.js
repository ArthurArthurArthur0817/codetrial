import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSyntaxParser } from "../../web/syntax-parser.js";

const loads = new Map();
let moduleLoads = 0;
let cancel = false;
let clockReads = 0;
const syntax = createSyntaxParser({
  loadModule: async (url) => {
    moduleLoads += 1;
    return import(url.href);
  },
  loadBytes: async (url) => {
    const path = fileURLToPath(url);
    loads.set(path, (loads.get(path) ?? 0) + 1);
    return new Uint8Array(await readFile(url));
  },
  now: () => (cancel ? (clockReads++ === 0 ? 0 : 26) : 0),
});

before(async () => {
  await Promise.all(
    ["c", "cpp", "java", "javascript", "python"].map((language) =>
      syntax.prepareLanguage(language),
    ),
  );
});

test("a language stays unavailable until ready and shares concurrent loads", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const loading = createSyntaxParser({
    loadBytes: async (url) => {
      requests += 1;
      if (url.pathname.endsWith("/tree-sitter-python.wasm")) await gate;
      return new Uint8Array(await readFile(url));
    },
  });
  assert.equal(loading.parseSyntax("if ready:", "python"), null);
  const first = loading.prepareLanguage("python");
  const concurrent = loading.prepareLanguage("python");
  assert.equal(loading.parseSyntax("if ready:", "python"), null);
  release();
  await Promise.all([first, concurrent]);
  await loading.prepareLanguage("python");
  assert.equal(requests, 2);
  const tree = loading.parseSyntax("if ready:", "python");
  try {
    assert.equal(tree.rootNode.type, "module");
    assert.equal(tree.rootNode.descendantsOfType("if_statement").length, 1);
  } finally {
    tree.delete();
  }
});

test("the pinned runtime loads all five grammars and keeps their syntax distinct", async () => {
  const cases = [
    ["c", "int f(void) { /* note */ return 1; }", "comment", "/* note */"],
    [
      "cpp",
      'auto text = R"tag(/*)tag";',
      "raw_string_literal",
      'R"tag(/*)tag"',
    ],
    ["java", 'class A { String text = "/*"; }', "string_literal", '"/*"'],
    [
      "javascript",
      "class A { #return=4; f() { return this.#return / 2; } } /\\/*/.test(text);",
      "regex",
      "/\\/*/",
    ],
    ["python", 'text = """\n/*\n"""\n', "string", '"""\n/*\n"""'],
  ];
  await Promise.all(
    cases.map(([language]) => syntax.prepareLanguage(language)),
  );
  assert.equal(moduleLoads, 1);
  assert.equal(loads.size, 6);
  assert.ok([...loads.values()].every((count) => count === 1));
  for (const [language, code, kind, text] of cases) {
    const tree = syntax.parseSyntax(code, language);
    try {
      assert.equal(tree.rootNode.hasError, false, language);
      assert.deepEqual(
        tree.rootNode.descendantsOfType(kind).map((node) => node.text),
        [text],
        language,
      );
    } finally {
      tree.delete();
    }
  }
});

test("syntax positions match selection positions for multibyte text", () => {
  // The byte width is the point: textarea positions count UTF-16 code units.
  const code = 'const text = "\u03c0\ud83d\ude00";';
  const tree = syntax.parseSyntax(code, "javascript");
  try {
    const [literal] = tree.rootNode.descendantsOfType("string");
    assert.equal(tree.rootNode.endIndex, code.length);
    assert.equal(literal.startIndex, code.indexOf('"'));
    assert.equal(literal.endIndex, code.lastIndexOf('"') + 1);
    assert.equal(
      code.slice(literal.startIndex, literal.endIndex),
      '"\u03c0\ud83d\ude00"',
    );
  } finally {
    tree.delete();
  }
});

test("browser grammar versions match the backend pins", async () => {
  const cargo = await readFile(
    new URL("../../Cargo.toml", import.meta.url),
    "utf8",
  );
  const directories = new Set([...loads.keys()].map(dirname));
  assert.equal(directories.size, 6);
  for (const directory of directories) {
    // The Rust parser and the browser runtime are separate packages; their
    // grammar versions, rather than runtime package versions, must agree.
    const name = basename(directory);
    if (name === "tree-sitter") continue;
    const manifest = await readFile(join(directory, "FETCH"), "utf8");
    const url = manifest
      .split("\n")
      .find((line) => line && !line.startsWith("#"));
    const version = url.match(/(?:@|\/v)(\d+\.\d+\.\d+)\//)[1];
    assert.ok(cargo.split("\n").includes(name + ' = "=' + version + '"'), name);
  }
});

test("unfinished code still produces a syntax tree", () => {
  const code = "function f() {";
  const tree = syntax.parseSyntax(code, "javascript");
  try {
    assert.equal(tree.rootNode.hasError, true);
    assert.equal(tree.rootNode.endIndex, code.length);
  } finally {
    tree.delete();
  }
});

test("a cancelled parse does not resume its source on the next call", () => {
  cancel = true;
  clockReads = 0;
  try {
    assert.equal(
      syntax.parseSyntax("const value = 1;\n".repeat(5000), "javascript"),
      null,
    );
    assert.ok(
      clockReads > 1,
      "the real parser must check the cancellation callback",
    );
  } finally {
    cancel = false;
  }
  const tree = syntax.parseSyntax("const value = 2;", "javascript");
  try {
    assert.equal(tree.rootNode.text, "const value = 2;");
    assert.equal(tree.rootNode.hasError, false);
  } finally {
    tree.delete();
  }
});

test("a failed download stays unavailable without repeated requests", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return new Response("", { status: 404 });
  });
  const failed = createSyntaxParser();
  const first = failed.prepareLanguage("java");
  await assert.rejects(first, /404/);
  await assert.rejects(failed.prepareLanguage("java"), /404/);
  assert.equal(failed.parseSyntax("class A {}", "java"), null);
  assert.equal(requests, 2);
});

test("one failed grammar does not prevent another language from loading", async () => {
  const partial = createSyntaxParser({
    loadBytes: async (url) => {
      if (url.pathname.endsWith("/tree-sitter-java.wasm"))
        throw new Error("missing Java");
      return new Uint8Array(await readFile(url));
    },
  });
  await assert.rejects(partial.prepareLanguage("java"), /missing Java/);
  await partial.prepareLanguage("c");
  assert.equal(partial.parseSyntax("class A {}", "java"), null);
  const tree = partial.parseSyntax("int value = 1;", "c");
  try {
    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.type, "translation_unit");
  } finally {
    tree.delete();
  }
});

test("unsupported languages reject without starting a load", async () => {
  const unexpectedLoad = () => {
    assert.fail("unsupported languages must not load assets");
  };
  const unsupported = createSyntaxParser({
    loadModule: unexpectedLoad,
    loadBytes: unexpectedLoad,
  });
  for (const language of ["unknown", "constructor", "toString", ""]) {
    await assert.rejects(unsupported.prepareLanguage(language), RangeError);
    assert.throws(() => unsupported.parseSyntax("/*", language), RangeError);
  }
});
