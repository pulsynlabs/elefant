import { plugin } from "bun";
import path from "path";
import fs from "fs";

// Transform Svelte 5 runes to plain JavaScript for testing.
//
// Strategy: strip $state<T>(value) → value, and replace $derived(expr) with
// an object that has a getter re-evaluating expr on every property access.
// This avoids the proxy-based approach which broke === comparisons and
// truthiness checks (e.g. activeProjectId === id always failed because the
// proxy was never === to a string).

function transformRunes(source: string): string {
  let code = source;

  // 1. Strip $state<T>(value) → value  OR  $state(value) → value
  //    We need to handle both typed and untyped $state calls.
  //    Strategy: find each $state occurrence after a variable declaration,
  //    then manually locate the matching ) by counting parens (and angle
  //    brackets if a generic type is present).
  let result = "";
  let lastIndex = 0;
  const stateRegex = /((?:let|const|var)\s+\w+\s*=\s*)\$state\s*/g;
  let match;

  while ((match = stateRegex.exec(code)) !== null) {
    result += code.slice(lastIndex, match.index);

    const prefix = match[1];
    let i = match.index + match[0].length;

    // Skip optional generic type <...>
    if (code[i] === "<") {
      let depth = 1;
      i++;
      while (i < code.length && depth > 0) {
        if (code[i] === "<") depth++;
        else if (code[i] === ">") depth--;
        i++;
      }
      // Skip whitespace before '('
      while (i < code.length && code[i] !== "(") i++;
    }

    // Now we should be at '(' — find matching ')'
    if (code[i] === "(") {
      let depth = 1;
      i++;
      const parenStart = i;
      while (i < code.length && depth > 0) {
        if (code[i] === "(") depth++;
        else if (code[i] === ")") depth--;
        i++;
      }
      const init = code.slice(parenStart, i - 1).trim();
      result += `${prefix}${init};`;
    } else {
      // Unexpected — just pass through
      result += match[0];
    }

    lastIndex = i;
  }

  result += code.slice(lastIndex);
  code = result;

  // 2. Transform $derived(expr) and $derived.by(fn) into a getter object.
  //    For $derived(expr), `expr` is an expression evaluated lazily on read.
  //    For $derived.by(fn), `fn` is a thunk we call on read.
  const derivedRegex = /((?:let|const|var)\s+(\w+)\s*=\s*)\$derived(\.by)?\s*\(/g;
  result = "";
  lastIndex = 0;

  while ((match = derivedRegex.exec(code)) !== null) {
    result += code.slice(lastIndex, match.index);

    const prefix = match[1];
    const isByForm = match[3] === ".by";
    const startIdx = match.index + match[0].length;

    // Find matching closing paren
    let depth = 1;
    let i = startIdx;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
      i++;
    }

    const content = code.slice(startIdx, i - 1);
    // For $derived.by(fn), the body is a thunk we invoke; for $derived(expr)
    // the body is a value-returning expression we splice directly.
    const evalExpr = isByForm ? `(${content})()` : content;

    // Create a getter-based derived that properly returns null/undefined
    // when the expression evaluates to a falsy value, and forwards property
    // access when it evaluates to an object. For primitive-returning
    // deriveds we expose Symbol.toPrimitive / valueOf so equality and
    // truthiness checks behave like the underlying value.
    result += `${prefix}(function() {
      const _get = () => ${evalExpr};
      return new Proxy({}, {
        get(_t, prop) {
          if (prop === '__raw') return _get();
          if (prop === Symbol.toStringTag) return 'Derived';
          if (prop === Symbol.toPrimitive) return () => _get();
          if (prop === 'valueOf') return () => _get();
          if (prop === 'toString') return () => String(_get());
          const val = _get();
          if (val && typeof val === 'object') return val[prop];
          return undefined;
        },
        has(_t, prop) {
          const val = _get();
          return val ? prop in val : false;
        }
      });
    })()`;

    lastIndex = i;
  }

  result += code.slice(lastIndex);
  code = result;

  return code;
}

plugin({
  name: "svelte-runes-test",
  async setup(build) {
    // Handle .svelte.ts files
    build.onLoad({ filter: /\.svelte\.ts$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf-8");
      
      // Transform runes (no runtime needed — plain values + getter proxies)
      const transformed = transformRunes(source);
      
      return {
        contents: transformed,
        loader: "ts",
      };
    });

    // Handle $lib path aliases
    build.onResolve({ filter: /^\$lib\// }, (args) => {
      const relativePath = args.path.replace("$lib/", "");
      const resolved = path.resolve("./src/lib", relativePath);

      // Try different extensions
      const extensions = [".ts", ".js", ".svelte.ts", ".svelte.js"];
      for (const ext of extensions) {
        const fullPath = resolved + ext;
        if (fs.existsSync(fullPath)) {
          return { path: fullPath };
        }
      }

      // Try as directory with index
      const indexPath = path.join(resolved, "index.ts");
      if (fs.existsSync(indexPath)) {
        return { path: indexPath };
      }

      return { path: resolved };
    });

    // Handle $lib bare import
    build.onResolve({ filter: /^\$lib$/ }, () => {
      const indexPath = path.resolve("./src/lib/index.ts");
      if (fs.existsSync(indexPath)) {
        return { path: indexPath };
      }
      return { path: path.resolve("./src/lib") };
    });
  },
});
