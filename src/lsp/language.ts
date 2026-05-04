import { extname, basename } from 'node:path';

/**
 * Maps file extensions to LSP server IDs.
 * Multiple server IDs mean all matching servers are tried (first installed wins).
 * Server IDs must match the `id` field in servers.ts.
 */
const EXT_TO_SERVER_IDS: Record<string, string[]> = {
  // TypeScript / JavaScript
  '.ts':    ['typescript'],
  '.tsx':   ['typescript'],
  '.js':    ['typescript'],
  '.jsx':   ['typescript'],
  '.mjs':   ['typescript'],
  '.cjs':   ['typescript'],
  '.mts':   ['typescript'],
  '.cts':   ['typescript'],
  '.d.ts':  ['typescript'],

  // Svelte
  '.svelte': ['svelte'],

  // Vue
  '.vue': ['vue'],

  // Astro
  '.astro': ['astro'],

  // Elm
  '.elm': ['elm'],

  // PureScript
  '.purs': ['purescript'],

  // Python
  '.py':  ['pyright', 'pylsp', 'ruff'],
  '.pyi': ['pyright', 'pylsp', 'ruff'],

  // Go
  '.go': ['gopls'],

  // Rust
  '.rs': ['rust-analyzer'],

  // C / C++ / Objective-C
  '.c':   ['clangd'],
  '.cc':  ['clangd'],
  '.cpp': ['clangd'],
  '.cxx': ['clangd'],
  '.c++': ['clangd'],
  '.h':   ['clangd'],
  '.hh':  ['clangd'],
  '.hpp': ['clangd'],
  '.hxx': ['clangd'],
  '.h++': ['clangd'],
  '.m':   ['clangd'],
  '.mm':  ['clangd'],

  // C# / .NET
  '.cs':    ['csharp'],
  '.csx':   ['csharp'],

  // F#
  '.fs':     ['fsharp'],
  '.fsx':    ['fsharp'],
  '.fsi':    ['fsharp'],
  '.fsproj': ['fsharp'],

  // Kotlin
  '.kt':  ['kotlin'],
  '.kts': ['kotlin'],

  // Scala
  '.scala': ['scala'],
  '.sc':    ['scala'],
  '.sbt':   ['scala'],

  // Swift
  '.swift': ['swift'],

  // Ruby
  '.rb':      ['ruby', 'solargraph'],
  '.rake':    ['ruby', 'solargraph'],
  '.gemspec': ['ruby', 'solargraph'],
  '.ru':      ['ruby', 'solargraph'],
  '.rbw':     ['ruby', 'solargraph'],

  // PHP
  '.php':       ['php'],
  '.phtml':     ['php'],
  '.php3':      ['php'],
  '.php4':      ['php'],
  '.php5':      ['php'],
  '.php7':      ['php'],
  '.php8':      ['php'],

  // Dart
  '.dart': ['dart'],

  // Shell / Bash
  '.sh':      ['bash'],
  '.bash':    ['bash'],
  '.zsh':     ['bash'],
  '.fish':    ['bash'],
  '.ksh':     ['bash'],
  '.bsh':     ['bash'],

  // Lua
  '.lua': ['lua'],

  // Elixir
  '.ex':    ['elixir'],
  '.exs':   ['elixir'],
  '.heex':  ['elixir'],
  '.leex':  ['elixir'],
  '.sface': ['elixir'],

  // Erlang
  '.erl':     ['erlang'],
  '.hrl':     ['erlang'],
  '.escript': ['erlang'],

  // Haskell
  '.hs':  ['haskell'],
  '.lhs': ['haskell'],

  // OCaml
  '.ml':  ['ocaml'],
  '.mli': ['ocaml'],
  '.mly': ['ocaml'],
  '.mll': ['ocaml'],
  '.mlx': ['ocaml'],

  // Clojure
  '.clj':  ['clojure'],
  '.cljs': ['clojure'],
  '.cljc': ['clojure'],
  '.edn':  ['clojure'],

  // Gleam
  '.gleam': ['gleam'],

  // Zig
  '.zig': ['zig'],
  '.zon': ['zig'],

  // Nim
  '.nim':    ['nim'],
  '.nims':   ['nim'],
  '.nimble': ['nim'],

  // D
  '.d':  ['d'],
  '.di': ['d'],

  // Move
  '.move': ['move'],

  // R
  '.r':   ['r'],
  '.R':   ['r'],
  '.Rmd': ['r'],
  '.qmd': ['r'],
  '.Rnw': ['r'],

  // Julia
  '.jl': ['julia'],

  // CMake
  '.cmake': ['cmake'],

  // Fortran
  '.f90': ['fortran'],
  '.f95': ['fortran'],
  '.f03': ['fortran'],
  '.f08': ['fortran'],
  '.f':   ['fortran'],
  '.for': ['fortran'],
  '.fpp': ['fortran'],
  '.F90': ['fortran'],
  '.F95': ['fortran'],

  // Nix
  '.nix': ['nix'],

  // CSS / SCSS / Less
  '.css':  ['css'],
  '.scss': ['css'],
  '.sass': ['css'],
  '.less': ['css'],

  // HTML
  '.html':  ['html'],
  '.htm':   ['html'],
  '.xhtml': ['html'],

  // JSON
  '.json':  ['json'],
  '.jsonc': ['json'],
  '.json5': ['json'],

  // YAML — note: ansible server also handles .yml/.yaml but only in ansible projects
  '.yaml': ['yaml', 'ansible'],
  '.yml':  ['yaml', 'ansible'],

  // TOML
  '.toml': ['toml'],

  // XML / SVG / related
  '.xml':   ['xml'],
  '.xsd':   ['xml'],
  '.xsl':   ['xml'],
  '.xslt':  ['xml'],
  '.svg':   ['xml'],
  '.wsdl':  ['xml'],
  '.plist': ['xml'],

  // Nickel
  '.ncl': ['nickel'],

  // Pkl
  '.pkl': ['pkl'],

  // SQL
  '.sql':   ['sql'],
  '.psql':  ['sql'],
  '.pgsql': ['sql'],
  '.mysql': ['sql'],
  '.sqlite': ['sql'],

  // GraphQL
  '.graphql': ['graphql'],
  '.gql':     ['graphql'],

  // Protocol Buffers
  '.proto': ['proto'],

  // Jsonnet
  '.jsonnet':  ['jsonnet'],
  '.libsonnet': ['jsonnet'],

  // Markdown
  '.md':  ['marksman'],
  '.mdx': ['marksman'],

  // Dockerfile (extension-less handled separately via basename)
  '.dockerfile': ['dockerfile'],

  // Terraform / HCL
  '.tf':     ['terraform'],
  '.tfvars': ['terraform'],
  '.hcl':    ['terraform'],

  // Prisma
  '.prisma': ['prisma'],

  // Solidity
  '.sol': ['solidity'],

  // VHDL
  '.vhd':  ['vhdl'],
  '.vhdl': ['vhdl'],

  // Verilog / SystemVerilog
  '.v':   ['verilog'],
  '.sv':  ['verilog'],
  '.svh': ['verilog'],
  '.vh':  ['verilog'],
};

/**
 * Extension-less filenames that map to a server.
 * These are checked when extname() returns ''.
 */
const BASENAME_TO_SERVER_IDS: Record<string, string[]> = {
  'Dockerfile':          ['dockerfile'],
  'dockerfile':          ['dockerfile'],
  'Makefile':            [],
  'CMakeLists.txt':      ['cmake'],
  'Gemfile':             ['ruby', 'solargraph'],
  'Rakefile':            ['ruby', 'solargraph'],
  'Guardfile':           ['ruby', 'solargraph'],
  'Vagrantfile':         ['ruby', 'solargraph'],
  'Fastfile':            ['ruby', 'solargraph'],
  'Podfile':             ['ruby', 'solargraph'],
  '.bashrc':             ['bash'],
  '.bash_profile':       ['bash'],
  '.zshrc':              ['bash'],
  '.profile':            ['bash'],
  'config.fish':         ['bash'],
};

export function extensionToServerIds(filePath: string): string[] {
  const ext = extname(filePath);
  if (ext) {
    return EXT_TO_SERVER_IDS[ext] ?? EXT_TO_SERVER_IDS[ext.toLowerCase()] ?? [];
  }
  // Extension-less files: try basename
  const base = basename(filePath);
  return BASENAME_TO_SERVER_IDS[base] ?? [];
}
