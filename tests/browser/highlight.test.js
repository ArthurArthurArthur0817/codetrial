// Run with: node --test tests/browser/*.test.js
//
// The highlighter turns candidate code into HTML, so escaping is the property
// that matters most: the textarea is the source of truth and the overlay must
// never be able to introduce markup or lose a character.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { tokenize } from "../../web/tokenizer.js";
import { highlight } from "../../web/highlight.js";
import { indentNewline } from "../../web/editor.js";
import { createSyntaxParser } from "../../web/syntax-parser.js";

const syntax = createSyntaxParser({
  loadBytes: async (url) => new Uint8Array(await readFile(url)),
});

before(async () => {
  await Promise.all(
    ["python", "javascript", "c", "cpp", "java"].map((language) =>
      syntax.prepareLanguage(language),
    ),
  );
});

/// The overlay must render exactly the characters the textarea holds, or the
/// painted text drifts out of line with the caret.
const textOf = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/// Trailing newlines are compared loosely: highlight() deliberately appends one
/// so the overlay renders the same final empty line the textarea shows.
const roundTrips = (code, language) =>
  assert.equal(
    textOf(highlight(code, language)).replace(/\n+$/, ""),
    code.replace(/\n+$/, ""),
    "highlighting changed the text",
  );

test("python keywords, strings, comments, and numbers are marked", () => {
  const html = highlight(
    'def f(n):\n    # add\n    return n + 1 if n else "x"',
    "python",
  );

  assert.match(html, /<span class="tok-keyword">def<\/span>/);
  assert.match(html, /<span class="tok-keyword">return<\/span>/);
  assert.match(html, /<span class="tok-comment"># add<\/span>/);
  assert.match(html, /<span class="tok-number">1<\/span>/);
  assert.match(html, /<span class="tok-string">&quot;x&quot;<\/span>/);
  assert.doesNotMatch(
    html,
    /<span class="tok-keyword">f<\/span>/,
    "a plain name is not a keyword",
  );
});

test("python literals and triple-quoted strings", () => {
  const html = highlight('x = True\ns = """a\nb"""\n', "python");

  assert.match(html, /<span class="tok-literal">True<\/span>/);
  assert.match(
    html,
    /<span class="tok-string">(?:&quot;){3}a\nb(?:&quot;){3}<\/span>/,
    "triple quotes span lines",
  );
});

test("javascript keywords, template strings, and both comment forms", () => {
  const html = highlight(
    "const a = `t${x}`; // note\n/* block */ let b = 0x1f;",
    "javascript",
  );

  assert.match(html, /<span class="tok-keyword">const<\/span>/);
  assert.match(html, /<span class="tok-keyword">let<\/span>/);
  assert.match(html, /<span class="tok-comment">\/\/ note<\/span>/);
  assert.match(html, /<span class="tok-comment">\/\* block \*\/<\/span>/);
  assert.match(html, /<span class="tok-number">0x1f<\/span>/);
});

test("compiled language keywords, literals, strings, and comments are marked", () => {
  const c = highlight("int f(char* s) { // return\n  return NULL;\n}", "c");
  assert.match(c, /<span class="tok-keyword">int<\/span>/);
  assert.match(c, /<span class="tok-keyword">return<\/span>/);
  assert.match(c, /<span class="tok-literal">NULL<\/span>/);
  assert.match(c, /<span class="tok-comment">\/\/ return<\/span>/);

  const cpp = highlight(
    'class Solution { int f() { string s = "return"; return 1; } };',
    "cpp",
  );
  assert.match(cpp, /<span class="tok-keyword">class<\/span>/);
  assert.match(cpp, /<span class="tok-keyword">return<\/span>/);
  assert.match(cpp, /<span class="tok-string">&quot;return&quot;<\/span>/);

  const java = highlight(
    "public class Solution { boolean ok = true; }",
    "java",
  );
  assert.match(java, /<span class="tok-keyword">public<\/span>/);
  assert.match(java, /<span class="tok-keyword">boolean<\/span>/);
  assert.match(java, /<span class="tok-literal">true<\/span>/);
});

test("a keyword inside a string or comment stays part of it", () => {
  const html = highlight('s = "return 1"  # def g', "python");

  assert.match(html, /<span class="tok-string">&quot;return 1&quot;<\/span>/);
  assert.match(html, /<span class="tok-comment"># def g<\/span>/);
  assert.doesNotMatch(
    html,
    /tok-keyword/,
    "no keyword escapes its enclosing token",
  );

  for (const language of ["c", "cpp", "java"]) {
    const compiled = highlight('value = "return"; // class', language);
    assert.match(
      compiled,
      /<span class="tok-string">&quot;return&quot;<\/span>/,
    );
    assert.match(compiled, /<span class="tok-comment">\/\/ class<\/span>/);
    assert.doesNotMatch(
      compiled,
      /tok-keyword/,
      `${language} keyword escaped its enclosing token`,
    );
  }
});

test("markup in code is escaped, never emitted", () => {
  const html = highlight('x = "<img src=q onerror=alert(1)>"', "python");

  assert.doesNotMatch(
    html,
    /<img/,
    "candidate code must not become live markup",
  );
  assert.match(html, /&lt;img src=q onerror=alert\(1\)&gt;/);
});

test("ampersands and angle brackets outside strings are escaped too", () => {
  const html = highlight("a && b < c > d", "javascript");

  assert.match(html, /&amp;&amp;/);
  assert.match(html, /&lt;/);
  assert.match(html, /&gt;/);
});

test("every character survives highlighting", () => {
  roundTrips(
    "def two_sum(nums, target):\n    seen = {}\n    return []\n",
    "python",
  );
  roundTrips("const f = (a) => a ?? `x${a}`;\n\n// tail\n", "javascript");
  roundTrips("int f(char* s) {\n    return 0;\n}\n", "c");
  roundTrips("vector<int> f(vector<int>& nums) { return {}; }\n", "cpp");
  roundTrips("class Solution { public int f() { return 0; } }\n", "java");
  roundTrips("", "python");
  roundTrips("   \n\n\t", "python");
  roundTrips("no tokens here", "python");
});

test("a trailing newline gains the extra line the textarea shows", () => {
  // <pre> drops the final empty line, so the caret would sit one row below the
  // painted text without this.
  assert.equal(highlight("a", "python"), "a");
  assert.ok(highlight("a\n", "python").endsWith("a\n\n"));
  assert.ok(highlight("a\n\n", "python").endsWith("a\n\n\n"));
});

test("an unterminated string does not swallow the rest of the buffer", () => {
  const html = highlight('s = "oops\nreturn 1\n', "python");

  assert.match(
    html,
    /<span class="tok-keyword">return<\/span>/,
    "code after it still highlights",
  );
  roundTrips('s = "oops\nreturn 1\n', "python");
});

test("an unknown language falls back instead of throwing", () => {
  const html = highlight("const x = 1;", "brainfuck");
  assert.match(html, /tok-keyword/);
  roundTrips("const x = 1;", "brainfuck");
});

const marked = (html, kind) =>
  [
    ...html.matchAll(
      new RegExp(`<span class="tok-${kind}">([\\s\\S]*?)</span>`, "g"),
    ),
  ].map((match) => textOf(match[1]));

for (const [mode, parse] of [
  ["scanner", () => null],
  ["parser", syntax.parseSyntax],
]) {
  const render = (code, language, brackets = []) =>
    highlight(code, language, brackets, tokenize(code, language, parse).tokens);

  test(`${mode}: matching brackets preserve offsets across string and comment regions`, () => {
    const code = 'const text = "\u03b1\ud83d\ude00"; if (ready) { /* text */ }';
    const html = render(code, "javascript", [
      code.indexOf("{"),
      code.lastIndexOf("}"),
    ]);
    assert.equal((html.match(/class="matching-bracket"/g) ?? []).length, 2);
    assert.deepEqual(marked(html, "string"), ['"\u03b1\ud83d\ude00"']);
    assert.deepEqual(marked(html, "comment"), ["/* text */"]);
    assert.ok(marked(html, "keyword").includes("if"));
    assert.equal(textOf(html), code);
  });

  test(`${mode}: matching brackets preserve template interpolation colors`, () => {
    const code = "const text = `value ${call(true)}`;";
    const html = render(code, "javascript", [
      code.indexOf("("),
      code.indexOf(")"),
    ]);
    assert.equal((html.match(/class="matching-bracket"/g) ?? []).length, 2);
    assert.deepEqual(marked(html, "literal"), ["true"]);
    assert.equal(textOf(html), code);
  });
  test(`${mode}: an unfinished block comment is colored and does not increase indentation`, () => {
    const code = "/*\n    if (ready) {";
    for (const language of ["javascript", "c", "cpp", "java"]) {
      const html = render(code, language);
      assert.deepEqual(marked(html, "comment"), [code], language);
      assert.deepEqual(marked(html, "keyword"), [], language);
      assert.equal(textOf(html), code, language);
      const expected = code + "\n    ";
      assert.deepEqual(
        indentNewline(code, code.length, code.length, language, parse),
        { value: expected, start: expected.length, end: expected.length },
        language,
      );
    }
  });

  test(`${mode}: code after a closing block comment is colored and indented`, () => {
    const comment = "/*\n * setup {\n */";
    const code = comment + " if (ready) {";
    for (const language of ["javascript", "c", "cpp", "java"]) {
      const html = render(code, language);
      assert.deepEqual(marked(html, "comment"), [comment], language);
      assert.deepEqual(marked(html, "keyword"), ["if"], language);
      const expected = code + "\n     ";
      assert.deepEqual(
        indentNewline(code, code.length, code.length, language, parse),
        { value: expected, start: expected.length, end: expected.length },
        language,
      );
    }
  });

  test(`${mode}: block markers in multiline strings do not hide later code`, () => {
    for (const [language, prefix, literal] of [
      ["javascript", "const text = ", "`\n/*\n`"],
      ["cpp", "auto text = ", 'R"tag(\n/*\n)tag"'],
      ["java", "String text = ", '"""\n/*\n"""'],
      ["python", "text = ", '"""\n/*\n"""'],
    ]) {
      const code =
        prefix +
        literal +
        ";\n" +
        (language === "python" ? "if ready:" : "if (ready) {");
      const html = render(code, language);
      assert.deepEqual(marked(html, "string"), [literal], language);
      assert.deepEqual(marked(html, "comment"), [], language);
      assert.ok(marked(html, "keyword").includes("if"), language);
      assert.equal(textOf(html), code, language);
      const expected = code + "\n    ";
      assert.deepEqual(
        indentNewline(code, code.length, code.length, language, parse),
        { value: expected, start: expected.length, end: expected.length },
        language,
      );
    }
  });

  test(`${mode}: regexp contents are colored as a literal while division stays code`, () => {
    const literal = String.raw`/\/*/`;
    const code = `const re = ${literal};\nconst value = total / count / size;\nif (ready) {`;
    const html = render(code, "javascript");
    assert.deepEqual(marked(html, "string"), [literal]);
    assert.deepEqual(marked(html, "comment"), []);
    assert.ok(marked(html, "keyword").includes("if"));
    assert.equal(textOf(html), code);
    const expected = code + "\n    ";
    assert.deepEqual(
      indentNewline(code, code.length, code.length, "javascript", parse),
      { value: expected, start: expected.length, end: expected.length },
    );
  });

  test(`${mode}: template interpolation is colored as code`, () => {
    const code = 'const text = `start ${ready ? true : "no"} end`;';
    const html = render(code, "javascript");
    assert.deepEqual(marked(html, "string"), ["`start ", '"no"', " end`"]);
    assert.deepEqual(marked(html, "literal"), ["true"]);
    assert.equal(textOf(html), code);
  });

  test(`${mode}: nested templates return to their enclosing string`, () => {
    const code = "const text = `a ${`b ${true}`} c`;";
    const html = render(code, "javascript");
    assert.deepEqual(marked(html, "string"), ["`a ", "`b ", "`", " c`"]);
    assert.deepEqual(marked(html, "literal"), ["true"]);
    assert.equal(textOf(html), code);
  });

  test(`${mode}: code regions retain each language's keyword, literal and number colors`, () => {
    // Mixed-width Unicode fixtures check source-range offsets.
    for (const [language, code, keyword, literal] of [
      [
        "python",
        'if True: text = "\u03b1\ud83d\ude00"; count = 42',
        "if",
        "True",
      ],
      [
        "javascript",
        'const text = "\u03b1\ud83d\ude00"; if (true) count = 42;',
        "const",
        "true",
      ],
      [
        "c",
        'int f() { char *text = "\u03b1\ud83d\ude00"; return NULL; int count = 42; }',
        "int",
        "NULL",
      ],
      [
        "cpp",
        'auto text = "\u03b1\ud83d\ude00"; bool ready = NULL; int count = 42;',
        "bool",
        "NULL",
      ],
      [
        "java",
        'class A { String text = "\u03b1\ud83d\ude00"; boolean ready = true; int count = 42; }',
        "class",
        "true",
      ],
    ]) {
      const html = render(code, language);
      assert.ok(marked(html, "keyword").includes(keyword), language);
      assert.deepEqual(marked(html, "literal"), [literal], language);
      assert.deepEqual(marked(html, "number"), ["42"], language);
      assert.deepEqual(
        marked(html, "string"),
        ['"\u03b1\ud83d\ude00"'],
        language,
      );
      assert.equal(textOf(html), code, language);
    }
  });

  test(`${mode}: a trailing newline inside an unfinished region preserves the final editor line`, () => {
    for (const [language, code] of [
      ["javascript", "/*\n"],
      ["javascript", "const text = `\n"],
      ["cpp", 'auto text = R"(\n'],
      ["java", 'String text = """\n'],
      ["python", 'text = """\n'],
    ]) {
      assert.equal(textOf(render(code, language)), code + "\n", language);
    }
  });

  test(`${mode}: unfinished regions escape markup and preserve non-ASCII characters`, () => {
    for (const [language, code] of [
      ["javascript", "/* <img src=x onerror=alert(1)> & \u03b1 \ud83d\ude00"],
      ["javascript", 'const text = `<>&" \u03b1 \ud83d\ude00'],
      ["cpp", 'auto text = R"(<>&" \u03b1 \ud83d\ude00'],
      ["java", 'String text = """\n<>&" \u03b1 \ud83d\ude00'],
      ["python", 'text = """<>&" \u03b1 \ud83d\ude00'],
    ]) {
      const html = render(code, language);
      assert.doesNotMatch(html, /<img/);
      assert.equal(textOf(html), code, language);
    }
  });

  test(`${mode}: another language's comment and template syntax stays code`, () => {
    const python = render("/*\nif ready:", "python");
    assert.deepEqual(marked(python, "comment"), []);
    assert.deepEqual(marked(python, "keyword"), ["if"]);
    for (const language of ["c", "java"]) {
      const html = render("`return`", language);
      assert.deepEqual(marked(html, "string"), [], language);
      assert.deepEqual(marked(html, "keyword"), ["return"], language);
    }
  });
}

test("parsed regexps after declarations do not hide later code", () => {
  for (const declaration of ["function f() {}", "class A {}"]) {
    const literal = String.raw`/\/*/`;
    const code = `${declaration}\n${literal}.test(text);\nif (ready) {`;
    const html = highlight(
      code,
      "javascript",
      [],
      tokenize(code, "javascript", syntax.parseSyntax).tokens,
    );
    assert.deepEqual(marked(html, "string"), [literal], declaration);
    assert.deepEqual(marked(html, "comment"), [], declaration);
    assert.ok(marked(html, "keyword").includes("if"), declaration);
    const expected = code + "\n    ";
    assert.deepEqual(
      indentNewline(
        code,
        code.length,
        code.length,
        "javascript",
        syntax.parseSyntax,
      ),
      { value: expected, start: expected.length, end: expected.length },
      declaration,
    );
  }
});

test("parsed Python f-string expressions retain literal and number colors", () => {
  const code = 'text = f"value {True} {42}"';
  const html = highlight(
    code,
    "python",
    [],
    tokenize(code, "python", syntax.parseSyntax).tokens,
  );
  assert.deepEqual(marked(html, "literal"), ["True"]);
  assert.deepEqual(marked(html, "number"), ["42"]);
  assert.equal(textOf(html), code);
});

test("matching bracket spans preserve escaping, syntax colors, and newlines", () => {
  const code = '(value < 2 && "<script>")\n';
  const html = highlight(code, "cpp", [0, code.indexOf(")")]);
  assert.equal((html.match(/class="matching-bracket"/g) || []).length, 2);
  assert.match(html, /class="tok-string"/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(textOf(html), code + "\n");
  assert.equal(highlight(code, "cpp", null), highlight(code, "cpp"));
});

test("matching brackets remain visible inside template interpolation", () => {
  const code = "`value: ${(value)}`";
  const html = highlight(code, "javascript", [10, 16]);
  assert.equal((html.match(/class="matching-bracket"/g) || []).length, 2);
  assert.equal(textOf(html), code);
});
