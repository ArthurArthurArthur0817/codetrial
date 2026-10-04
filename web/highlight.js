// Minimal syntax highlighter for the languages the editor offers.
//
// The Next.js app this replaced used Monaco, which is megabytes and expects a
// bundler. The editor here is a plain textarea, so all that is needed is
// escaped HTML with spans behind it; the palette follows VS Code Dark+ so the
// result matches the captured visual goldens.
//
// Comments, strings and regexps share the indentation tokenizer. Keywords and
// numbers are colored only in code regions; the textarea is the source of truth.

import { escapeHtml } from "./lib.js";
import { tokenize } from "./tokenizer.js";

const JS_KEYWORDS = [
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "yield",
];

const C_KEYWORDS = [
  "auto",
  "break",
  "case",
  "char",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extern",
  "float",
  "for",
  "goto",
  "if",
  "inline",
  "int",
  "long",
  "register",
  "restrict",
  "return",
  "short",
  "signed",
  "sizeof",
  "static",
  "struct",
  "switch",
  "typedef",
  "union",
  "unsigned",
  "void",
  "volatile",
  "while",
];

const CPP_KEYWORDS = [
  ...C_KEYWORDS,
  "alignas",
  "alignof",
  "bool",
  "catch",
  "class",
  "constexpr",
  "decltype",
  "delete",
  "explicit",
  "false",
  "friend",
  "mutable",
  "namespace",
  "new",
  "noexcept",
  "nullptr",
  "operator",
  "private",
  "protected",
  "public",
  "template",
  "this",
  "throw",
  "true",
  "try",
  "typename",
  "using",
  "virtual",
];

const JAVA_KEYWORDS = [
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "void",
  "volatile",
  "while",
];

const PY_KEYWORDS = [
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
];

const JS_LITERALS = ["true", "false", "null", "undefined", "NaN", "Infinity"];
const C_LITERALS = ["NULL"];
const CPP_LITERALS = ["true", "false", "nullptr", "NULL"];
const JAVA_LITERALS = ["true", "false", "null"];
const PY_LITERALS = ["True", "False", "None"];
const LANGUAGES = {
  python: {
    keywords: PY_KEYWORDS,
    literals: PY_LITERALS,
  },
  javascript: {
    keywords: JS_KEYWORDS,
    literals: JS_LITERALS,
  },
  c: {
    keywords: C_KEYWORDS,
    literals: C_LITERALS,
  },
  cpp: {
    keywords: CPP_KEYWORDS,
    literals: CPP_LITERALS,
  },
  java: {
    keywords: JAVA_KEYWORDS,
    literals: JAVA_LITERALS,
  },
};

const NUMBER = String.raw`\b\d(?:[\w.]*\w)?`;
const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;

const CODE_PATTERN = new RegExp(
  `(?<number>${NUMBER})|(?<identifier>${IDENTIFIER})`,
  "g",
);

function highlightCode(code, spec, renderSlice) {
  let html = "";
  let last = 0;
  for (const match of code.matchAll(CODE_PATTERN)) {
    html += renderSlice(last, match.index);
    const text = renderSlice(match.index, match.index + match[0].length);
    const { number, identifier } = match.groups;
    if (number !== undefined) html += `<span class="tok-number">${text}</span>`;
    else if (spec.keywords.includes(identifier))
      html += `<span class="tok-keyword">${text}</span>`;
    else if (spec.literals.includes(identifier))
      html += `<span class="tok-literal">${text}</span>`;
    else html += text;
    last = match.index + match[0].length;
  }
  return html + renderSlice(last, code.length);
}

/// Returns HTML for code. Every branch escapes candidate text.
/// Supplied token ranges let callers reuse an existing classification.
export function highlight(code, language, brackets = [], tokens) {
  const selected = Object.hasOwn(LANGUAGES, language) ? language : "javascript";
  const spec = LANGUAGES[selected];
  const renderSlice = (start, end) => {
    let text = "";
    for (const index of brackets ?? []) {
      if (index < start || index >= end) continue;
      text += escapeHtml(code.slice(start, index));
      text += `<span class="matching-bracket">${escapeHtml(code[index])}</span>`;
      start = index + 1;
    }
    return text + escapeHtml(code.slice(start, end));
  };
  let html = "";
  for (const { start, end, kind } of tokens ??
    tokenize(code, selected).tokens) {
    if (kind === "code") {
      html += highlightCode(code.slice(start, end), spec, (from, to) =>
        renderSlice(start + from, start + to),
      );
    } else {
      const style = kind === "comment" ? "comment" : "string";
      html += `<span class="tok-${style}">${renderSlice(start, end)}</span>`;
    }
  }
  // A trailing newline would otherwise collapse, leaving the last line of the
  // overlay one row above the textarea's caret.
  return code.endsWith("\n") ? `${html}\n` : html;
}
