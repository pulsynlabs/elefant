/**
 * LSP server registry.
 *
 * Each ServerInfo defines:
 *   - id:         unique server identifier
 *   - extensions: file extensions this server handles
 *   - root():     walks up from the file to find the project root
 *   - spawn():    spawns the server process (returns undefined if binary missing)
 *   - install?:   how to auto-install the server on first use
 *
 * Servers are tried in ALL_SERVERS order. Multiple servers per language
 * (e.g. pyright + pylsp for Python) are all attempted — whichever binary
 * is found first wins per project root.
 *
 * All spawn() calls are graceful: if the binary is not installed AND no
 * auto-installer is configured, the server is silently skipped.
 */

import { dirname, join, resolve } from 'node:path';

import { LSP_BIN_DIR, LSP_NPM_DIR } from './installer.js';
import type { Handle, ServerInfo } from './types.js';

type WhichBinary = (binary: string) => string | null | undefined;
type SpawnProcess = (cmd: string[], options: Bun.SpawnOptions.OptionsObject<'pipe', 'pipe', 'pipe'>) => ReturnType<typeof Bun.spawn>;

let whichBinary: WhichBinary = (binary) => Bun.which(binary);
let spawnProcess: SpawnProcess = (cmd, options) => Bun.spawn(cmd, options);

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

export async function walkUpForRoot(
  startPath: string,
  markers: readonly string[],
): Promise<string | undefined> {
  let current = dirname(resolve(startPath));

  while (true) {
    for (const marker of markers) {
      if (await fileExists(join(current, marker))) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function createRootDetector(markers: readonly string[]): (filePath: string) => Promise<string | undefined> {
  return (filePath) => walkUpForRoot(filePath, markers);
}

/**
 * Resolve a binary using the overridable whichBinary (honours test overrides)
 * then fall back to Elefant-managed install directories.
 * Returns the full path, or undefined if not found anywhere.
 */
async function resolveOrNull(binary: string): Promise<string | undefined> {
  // 1. System PATH (overridable for tests)
  const fromPath = whichBinary(binary);
  if (fromPath) return fromPath;

  // 2. Elefant-managed npm dir
  const npmBin = join(LSP_NPM_DIR, 'node_modules', '.bin', binary);
  if (await Bun.file(npmBin).exists()) return npmBin;

  // 3. Elefant-managed bin dir (cargo/go/pip/gem/download installs)
  const managedBin = join(LSP_BIN_DIR, binary);
  if (await Bun.file(managedBin).exists()) return managedBin;

  return undefined;
}

function createSpawner(
  binary: string,
  args: readonly string[],
): (root: string) => Promise<Handle | undefined> {
  return async (root) => {
    const resolved = await resolveOrNull(binary);
    if (!resolved) return undefined;

    const process = spawnProcess([resolved, ...args], {
      cwd: root,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { process };
  };
}

function defineServer(config: {
  id: string;
  extensions: string[];
  markers: readonly string[];
  binary: string;
  args: readonly string[];
  install?: ServerInfo['install'];
}): ServerInfo {
  return {
    id: config.id,
    extensions: config.extensions,
    root: createRootDetector(config.markers),
    spawn: createSpawner(config.binary, config.args),
    install: config.install,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// JavaScript / TypeScript ecosystem
// ═══════════════════════════════════════════════════════════════════════════════

export const typescript = defineServer({
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.d.ts'],
  markers: ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'tsconfig.json', 'jsconfig.json'],
  binary: 'typescript-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: 'typescript-language-server' },
});

export const svelte = defineServer({
  id: 'svelte',
  extensions: ['.svelte'],
  markers: ['svelte.config.js', 'svelte.config.ts', 'svelte.config.mjs', 'svelte.config.cjs', 'package.json'],
  binary: 'svelte-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: 'svelte-language-server' },
});

export const vue = defineServer({
  id: 'vue',
  extensions: ['.vue'],
  markers: ['vite.config.ts', 'vite.config.js', 'vue.config.js', 'vue.config.ts', 'nuxt.config.ts', 'nuxt.config.js', 'package.json'],
  binary: 'vue-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: 'vue-language-server' },
});

export const astro = defineServer({
  id: 'astro',
  extensions: ['.astro'],
  markers: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.cjs', 'package.json'],
  binary: 'astro-ls',
  args: ['--stdio'],
  install: { type: 'npm', package: '@astrojs/language-server' },
});

export const elm = defineServer({
  id: 'elm',
  extensions: ['.elm'],
  markers: ['elm.json'],
  binary: 'elm-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: 'elm-language-server' },
});

export const purescript = defineServer({
  id: 'purescript',
  extensions: ['.purs'],
  markers: ['spago.yaml', 'spago.dhall', 'bower.json'],
  binary: 'purescript-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: 'purescript-language-server' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Python
// ═══════════════════════════════════════════════════════════════════════════════

export const pyright = defineServer({
  id: 'pyright',
  extensions: ['.py', '.pyi'],
  markers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', '.python-version'],
  binary: 'pyright-langserver',
  args: ['--stdio'],
  install: { type: 'pip', package: 'pyright' },
});

export const pylsp = defineServer({
  id: 'pylsp',
  extensions: ['.py', '.pyi'],
  markers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', '.python-version'],
  binary: 'pylsp',
  args: [],
  install: { type: 'pip', package: 'python-lsp-server[all]' },
});

export const ruff = defineServer({
  id: 'ruff',
  extensions: ['.py', '.pyi'],
  markers: ['pyproject.toml', 'ruff.toml', '.ruff.toml', 'setup.cfg'],
  binary: 'ruff',
  args: ['server'],
  install: { type: 'pip', package: 'ruff' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Go
// ═══════════════════════════════════════════════════════════════════════════════

export const gopls = defineServer({
  id: 'gopls',
  extensions: ['.go'],
  markers: ['go.mod', 'go.work'],
  binary: 'gopls',
  args: [],
  install: { type: 'go', module: 'golang.org/x/tools/gopls' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rust
// ═══════════════════════════════════════════════════════════════════════════════

export const rustAnalyzer = defineServer({
  id: 'rust-analyzer',
  extensions: ['.rs'],
  markers: ['Cargo.toml', 'Cargo.lock'],
  binary: 'rust-analyzer',
  args: [],
  install: { type: 'cargo', crate: 'rust-analyzer' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// C / C++ / Objective-C
// ═══════════════════════════════════════════════════════════════════════════════

export const clangd = defineServer({
  id: 'clangd',
  extensions: ['.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx', '.h++', '.m', '.mm'],
  markers: ['compile_commands.json', 'CMakeLists.txt', '.clangd', 'compile_flags.txt', 'Makefile', '.git'],
  binary: 'clangd',
  args: [],
  install: {
    type: 'github-release',
    repo: 'clangd/clangd',
    binary: 'clangd',
    // e.g. clangd-linux-18.1.3.zip / clangd-mac-18.1.3.zip / clangd-windows-18.1.3.zip
    assetPattern(os, _ar, version) {
      const v = version.replace(/^v/, '');
      const platform = os === 'darwin' ? 'mac' : os === 'windows' ? 'windows' : 'linux';
      return `clangd-${platform}-${v}.zip`;
    },
    binPath: (_os, _ar, version) => `clangd_${version.replace(/^v/, '')}/bin/clangd`,
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// C# / .NET
// ═══════════════════════════════════════════════════════════════════════════════

export const csharp = defineServer({
  id: 'csharp',
  extensions: ['.cs', '.csx'],
  markers: ['global.json', 'Directory.Build.props', 'Directory.Build.targets', '.sln'],
  binary: 'csharp-ls',
  args: [],
  install: { type: 'dotnet', package: 'csharp-ls' },
});

export const fsharp = defineServer({
  id: 'fsharp',
  extensions: ['.fs', '.fsx', '.fsi', '.fsproj'],
  markers: ['global.json', '.sln', 'Directory.Build.props'],
  binary: 'fsautocomplete',
  args: ['--adaptive-lsp-server-enabled'],
  install: { type: 'dotnet', package: 'fsautocomplete' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Java / JVM
// ═══════════════════════════════════════════════════════════════════════════════

export const kotlin = defineServer({
  id: 'kotlin',
  extensions: ['.kt', '.kts'],
  markers: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'pom.xml'],
  binary: 'kotlin-language-server',
  args: [],
  install: {
    type: 'github-release',
    repo: 'fwcd/kotlin-language-server',
    binary: 'kotlin-language-server',
    // All platforms use the same server.zip
    assetPattern: () => 'server.zip',
    binPath: () => 'server/bin/kotlin-language-server',
  },
});

export const scala = defineServer({
  id: 'scala',
  extensions: ['.scala', '.sc', '.sbt'],
  markers: ['build.sbt', 'build.sc', '.metals', 'project/build.properties'],
  binary: 'metals',
  args: [],
  install: { type: 'coursier', package: 'metals' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Swift
// ═══════════════════════════════════════════════════════════════════════════════

export const swift = defineServer({
  id: 'swift',
  extensions: ['.swift'],
  markers: ['Package.swift', 'Package.resolved'],
  binary: 'sourcekit-lsp',
  args: [],
  // sourcekit-lsp is bundled with the Swift toolchain — cannot be installed separately
  install: { type: 'manual', hint: 'https://www.swift.org/download/' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Ruby
// ═══════════════════════════════════════════════════════════════════════════════

export const ruby = defineServer({
  id: 'ruby',
  extensions: ['.rb', '.rake', '.gemspec', '.ru', '.rbw'],
  markers: ['Gemfile', 'Gemfile.lock', '.ruby-version', '.tool-versions'],
  binary: 'ruby-lsp',
  args: ['stdio'],
  install: { type: 'gem', gem: 'ruby-lsp' },
});

export const solargraph = defineServer({
  id: 'solargraph',
  extensions: ['.rb', '.rake', '.gemspec', '.ru', '.rbw'],
  markers: ['Gemfile', '.ruby-version'],
  binary: 'solargraph',
  args: ['stdio'],
  install: { type: 'gem', gem: 'solargraph' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHP
// ═══════════════════════════════════════════════════════════════════════════════

export const php = defineServer({
  id: 'php',
  extensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.php8', '.blade.php'],
  markers: ['composer.json', 'composer.lock', 'artisan', 'index.php'],
  binary: 'intelephense',
  args: ['--stdio'],
  install: { type: 'npm', package: 'intelephense' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Dart / Flutter
// ═══════════════════════════════════════════════════════════════════════════════

export const dart = defineServer({
  id: 'dart',
  extensions: ['.dart'],
  markers: ['pubspec.yaml', 'pubspec.yml'],
  binary: 'dart',
  args: ['language-server', '--protocol=lsp'],
  // dart language-server is bundled with the Dart/Flutter SDK — cannot be installed separately
  install: { type: 'manual', hint: 'https://dart.dev/get-dart' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Shell / Scripting
// ═══════════════════════════════════════════════════════════════════════════════

export const bash = defineServer({
  id: 'bash',
  extensions: ['.sh', '.bash', '.zsh', '.fish', '.ksh', '.bsh', '.bashrc', '.zshrc', '.profile'],
  markers: ['.shellcheckrc', '.bash_profile', 'package.json', '.git'],
  binary: 'bash-language-server',
  args: ['start'],
  install: { type: 'npm', package: 'bash-language-server' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lua
// ═══════════════════════════════════════════════════════════════════════════════

export const lua = defineServer({
  id: 'lua',
  extensions: ['.lua'],
  markers: ['.luarc.json', '.luarc.jsonc', 'stylua.toml', '.stylua.toml', '.luacheckrc'],
  binary: 'lua-language-server',
  args: [],
  install: {
    type: 'github-release',
    repo: 'LuaLS/lua-language-server',
    binary: 'lua-language-server',
    // e.g. lua-language-server-3.x.x-linux-x64.tar.gz
    assetPattern(os, ar, version) {
      const v = version.replace(/^v/, '');
      const platform = os === 'darwin' ? 'darwin' : os === 'windows' ? 'win32' : 'linux';
      return `lua-language-server-${v}-${platform}-${ar}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
    },
    binPath: () => 'bin/lua-language-server',
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Functional languages
// ═══════════════════════════════════════════════════════════════════════════════

export const elixir = defineServer({
  id: 'elixir',
  extensions: ['.ex', '.exs', '.heex', '.leex', '.sface'],
  markers: ['mix.exs', 'mix.lock'],
  binary: 'language_server.sh',
  args: [],
  install: {
    type: 'github-release',
    repo: 'elixir-lsp/elixir-ls',
    binary: 'language_server.sh',
    // Single cross-platform zip
    assetPattern: (_os, _ar, version) => `elixir-ls-${version}.zip`,
    binPath: () => 'language_server.sh',
  },
});

export const erlang = defineServer({
  id: 'erlang',
  extensions: ['.erl', '.hrl', '.escript', '.app', '.app.src'],
  markers: ['rebar.config', 'rebar3', 'erlang.mk', '.erlang'],
  binary: 'erlang_ls',
  args: [],
  install: {
    type: 'github-release',
    repo: 'erlang-ls/erlang_ls',
    binary: 'erlang_ls',
    // e.g. erlang_ls_linux_amd64.tar.gz, erlang_ls_darwin_amd64.tar.gz
    assetPattern(os, ar) {
      const goArch = ar === 'arm64' ? 'arm64' : 'amd64';
      return new RegExp(`erlang_ls_${os}_${goArch}\\.tar\\.gz`);
    },
  },
});

export const haskell = defineServer({
  id: 'haskell',
  extensions: ['.hs', '.lhs'],
  markers: ['cabal.project', 'cabal.project.local', 'stack.yaml', 'hie.yaml', '.cabal'],
  binary: 'haskell-language-server-wrapper',
  args: ['--lsp'],
  install: { type: 'ghcup', tool: 'hls' },
});

export const ocaml = defineServer({
  id: 'ocaml',
  extensions: ['.ml', '.mli', '.mly', '.mll', '.mlx'],
  markers: ['dune-project', 'dune', '.ocamlformat', '.ocamlformat-ignore', 'opam'],
  binary: 'ocamllsp',
  args: [],
  install: { type: 'opam', package: 'ocaml-lsp-server' },
});

export const clojure = defineServer({
  id: 'clojure',
  extensions: ['.clj', '.cljs', '.cljc', '.edn'],
  markers: ['deps.edn', 'project.clj', 'bb.edn', 'shadow-cljs.edn'],
  binary: 'clojure-lsp',
  args: [],
  install: {
    type: 'github-release',
    repo: 'clojure-lsp/clojure-lsp',
    binary: 'clojure-lsp',
    // e.g. clojure-lsp-native-linux-amd64.zip, clojure-lsp-native-macos-amd64.zip
    assetPattern(os, ar) {
      const platform = os === 'darwin' ? 'macos' : os === 'windows' ? 'windows' : 'linux';
      const goArch = ar === 'arm64' ? 'aarch64' : 'amd64';
      if (os === 'windows') return `clojure-lsp-native-windows-${goArch}.zip`;
      return `clojure-lsp-native-${platform}-${goArch}.zip`;
    },
  },
});

export const gleam = defineServer({
  id: 'gleam',
  extensions: ['.gleam'],
  markers: ['gleam.toml'],
  binary: 'gleam',
  args: ['lsp'],
  install: {
    type: 'github-release',
    repo: 'gleam-lang/gleam',
    binary: 'gleam',
    // e.g. gleam-v1.x.x-x86_64-unknown-linux-musl.tar.gz
    assetPattern(os, ar, version) {
      const archStr = ar === 'arm64' ? 'aarch64' : 'x86_64';
      if (os === 'linux') return `gleam-${version}-${archStr}-unknown-linux-musl.tar.gz`;
      if (os === 'darwin') return `gleam-${version}-${archStr}-apple-darwin.tar.gz`;
      return `gleam-${version}-${archStr}-pc-windows-msvc.zip`;
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Systems languages
// ═══════════════════════════════════════════════════════════════════════════════

export const zig = defineServer({
  id: 'zig',
  extensions: ['.zig', '.zon'],
  markers: ['build.zig', 'build.zig.zon'],
  binary: 'zls',
  args: [],
  install: {
    type: 'github-release',
    repo: 'zigtools/zls',
    binary: 'zls',
    // e.g. zls-x86_64-linux.tar.xz, zls-aarch64-macos.tar.xz, zls-x86_64-windows.zip
    assetPattern(os, ar) {
      const archStr = ar === 'arm64' ? 'aarch64' : 'x86_64';
      const platform = os === 'darwin' ? 'macos' : os === 'windows' ? 'windows' : 'linux';
      const ext = os === 'windows' ? 'zip' : 'tar.xz';
      return `zls-${archStr}-${platform}.${ext}`;
    },
  },
});

export const nim = defineServer({
  id: 'nim',
  extensions: ['.nim', '.nims', '.nimble'],
  markers: ['nim.cfg', 'config.nims', '.nimble'],
  binary: 'nimlangserver',
  args: [],
  install: { type: 'nimble', package: 'nimlangserver' },
});

export const d = defineServer({
  id: 'd',
  extensions: ['.d', '.di'],
  markers: ['dub.json', 'dub.sdl', 'dub.selections.json'],
  binary: 'serve-d',
  args: [],
  install: {
    type: 'github-release',
    repo: 'Pure-D/serve-d',
    binary: 'serve-d',
    // e.g. serve-d-v0.x.x-linux.tar.xz, serve-d-v0.x.x-osx.tar.xz, serve-d-v0.x.x-windows.zip
    assetPattern(os, _ar, version) {
      const platform = os === 'darwin' ? 'osx' : os === 'windows' ? 'windows' : 'linux';
      const ext = os === 'windows' ? 'zip' : 'tar.xz';
      return `serve-d-${version}-${platform}.${ext}`;
    },
  },
});

export const vMove = defineServer({
  id: 'move',
  extensions: ['.move'],
  markers: ['Move.toml', 'sources'],
  binary: 'move-analyzer',
  args: [],
  install: { type: 'cargo-git', repo: 'https://github.com/move-language/move', name: 'move-analyzer' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Data science / Statistics
// ═══════════════════════════════════════════════════════════════════════════════

export const r = defineServer({
  id: 'r',
  extensions: ['.r', '.R', '.Rmd', '.qmd', '.Rnw'],
  markers: ['DESCRIPTION', '.Rproj', 'renv.lock', 'NAMESPACE', '.Rprofile'],
  binary: 'R',
  args: ['--slave', '-e', 'languageserver::run()'],
  install: { type: 'r-package', package: 'languageserver' },
});

export const julia = defineServer({
  id: 'julia',
  extensions: ['.jl'],
  markers: ['Project.toml', 'Manifest.toml', 'JuliaProject.toml'],
  binary: 'julia',
  // julia binary runs the LSP server inline — no separate binary to install
  // The LanguageServer.jl package must be installed in the Julia depot
  args: ['--startup-file=no', '--history-file=no', '-e',
    'using Pkg; haskey(Pkg.project().dependencies, "LanguageServer") || Pkg.add("LanguageServer"); using LanguageServer; runserver()'],
  // julia itself must be installed; LanguageServer.jl is fetched on first run via the args above
  install: { type: 'manual', hint: 'https://julialang.org/downloads/' },
});

export const cmake = defineServer({
  id: 'cmake',
  extensions: ['.cmake'],
  markers: ['CMakeLists.txt', 'CMakePresets.json'],
  binary: 'cmake-language-server',
  args: [],
  install: { type: 'pip', package: 'cmake-language-server' },
});

export const fortran = defineServer({
  id: 'fortran',
  extensions: ['.f90', '.f95', '.f03', '.f08', '.f', '.for', '.fpp', '.F90', '.F95'],
  markers: ['CMakeLists.txt', 'Makefile', '.git'],
  binary: 'fortls',
  args: [],
  install: { type: 'pip', package: 'fortls' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Nix
// ═══════════════════════════════════════════════════════════════════════════════

export const nix = defineServer({
  id: 'nix',
  extensions: ['.nix'],
  markers: ['flake.nix', 'default.nix', 'shell.nix', 'flake.lock'],
  binary: 'nil',
  args: [],
  install: { type: 'cargo', crate: 'nil' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Web: CSS / HTML / Templates
// ═══════════════════════════════════════════════════════════════════════════════

export const css = defineServer({
  id: 'css',
  extensions: ['.css', '.scss', '.sass', '.less'],
  markers: ['package.json'],
  binary: 'vscode-css-language-server',
  args: ['--stdio'],
  // vscode-langservers-extracted provides css, html, and json servers together
  install: { type: 'npm-multi', packages: ['vscode-langservers-extracted'] },
});

export const html = defineServer({
  id: 'html',
  extensions: ['.html', '.htm', '.xhtml'],
  markers: ['package.json'],
  binary: 'vscode-html-language-server',
  args: ['--stdio'],
  install: { type: 'npm-multi', packages: ['vscode-langservers-extracted'] },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Data / Config formats
// ═══════════════════════════════════════════════════════════════════════════════

export const json = defineServer({
  id: 'json',
  extensions: ['.json', '.jsonc', '.json5'],
  markers: ['package.json'],
  binary: 'vscode-json-language-server',
  args: ['--stdio'],
  install: { type: 'npm-multi', packages: ['vscode-langservers-extracted'] },
});

export const yaml = defineServer({
  id: 'yaml',
  extensions: ['.yaml', '.yml'],
  markers: ['package.json', '.yamllint', '.yamllint.yml', '.yamlrc'],
  binary: 'yaml-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: 'yaml-language-server' },
});

export const toml = defineServer({
  id: 'toml',
  extensions: ['.toml'],
  markers: ['Cargo.toml', 'pyproject.toml', 'package.toml', '.git'],
  binary: 'taplo',
  args: ['lsp', 'stdio'],
  install: { type: 'cargo', crate: 'taplo-cli', features: 'lsp' },
});

export const xml = defineServer({
  id: 'xml',
  extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg', '.xhtml', '.wsdl', '.plist'],
  markers: ['pom.xml', '.classpath', 'package.json', '.git'],
  binary: 'lemminx',
  args: [],
  install: {
    type: 'github-release',
    repo: 'eclipse/lemminx',
    binary: 'lemminx',
    // e.g. lemminx-linux.zip, lemminx-osx-x86_64.zip, lemminx-win32.zip
    assetPattern(os, ar) {
      if (os === 'linux') return 'lemminx-linux.zip';
      if (os === 'windows') return 'lemminx-win32.zip';
      return ar === 'arm64' ? 'lemminx-osx-aarch_64.zip' : 'lemminx-osx-x86_64.zip';
    },
  },
});

export const nickel = defineServer({
  id: 'nickel',
  extensions: ['.ncl'],
  markers: ['Nickel.toml', '.git'],
  binary: 'nls',
  args: [],
  install: { type: 'cargo', crate: 'nickel-lang-lsp' },
});

export const pkl = defineServer({
  id: 'pkl',
  extensions: ['.pkl'],
  markers: ['PklProject', '.git'],
  binary: 'pkl-lsp',
  args: [],
  install: {
    type: 'github-release',
    repo: 'apple/pkl-lsp',
    binary: 'pkl-lsp',
    // e.g. pkl-lsp-linux-amd64, pkl-lsp-macos-aarch64, pkl-lsp-windows-amd64.exe
    assetPattern(os, ar) {
      const goArch = ar === 'arm64' ? 'aarch64' : 'amd64';
      const platform = os === 'darwin' ? 'macos' : os === 'windows' ? 'windows' : 'linux';
      const ext = os === 'windows' ? '.exe' : '';
      return `pkl-lsp-${platform}-${goArch}${ext}`;
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Database / Query
// ═══════════════════════════════════════════════════════════════════════════════

export const sql = defineServer({
  id: 'sql',
  extensions: ['.sql', '.psql', '.pgsql', '.mysql', '.sqlite'],
  markers: ['package.json', 'database.yml', 'config/database.yml', '.git'],
  binary: 'sqls',
  args: [],
  install: { type: 'go', module: 'github.com/sqls-server/sqls' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// API / Schema
// ═══════════════════════════════════════════════════════════════════════════════

export const graphql = defineServer({
  id: 'graphql',
  extensions: ['.graphql', '.gql'],
  markers: ['.graphqlrc', '.graphqlrc.json', '.graphqlrc.yaml', '.graphqlrc.yml', 'graphql.config.js', 'graphql.config.ts', 'package.json'],
  binary: 'graphql-lsp',
  args: ['server', '-m', 'stream'],
  install: { type: 'npm', package: 'graphql-language-service-cli' },
});

export const proto = defineServer({
  id: 'proto',
  extensions: ['.proto'],
  markers: ['buf.yaml', 'buf.work.yaml', 'buf.gen.yaml', '.git'],
  binary: 'bufls',
  args: ['serve'],
  install: { type: 'go', module: 'github.com/bufbuild/buf/cmd/bufls' },
});

export const jsonnet = defineServer({
  id: 'jsonnet',
  extensions: ['.jsonnet', '.libsonnet'],
  markers: ['jsonnetfile.json', '.git'],
  binary: 'jsonnet-language-server',
  args: ['-t'],
  install: { type: 'go', module: 'github.com/grafana/jsonnet-language-server' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Prose / Markdown
// ═══════════════════════════════════════════════════════════════════════════════

export const marksman = defineServer({
  id: 'marksman',
  extensions: ['.md', '.mdx'],
  markers: ['.marksman.toml', 'package.json', '.git'],
  binary: 'marksman',
  args: ['server'],
  install: {
    type: 'github-release',
    repo: 'artempyanykh/marksman',
    binary: 'marksman',
    // Self-contained binaries: marksman-linux-x64, marksman-macos, marksman-macos-arm64, marksman-win-x64.exe
    assetPattern(os, ar) {
      if (os === 'linux') return 'marksman-linux-x64';
      if (os === 'windows') return 'marksman-win-x64.exe';
      return ar === 'arm64' ? 'marksman-macos-arm64' : 'marksman-macos';
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// DevOps / Infrastructure
// ═══════════════════════════════════════════════════════════════════════════════

export const dockerfile = defineServer({
  id: 'dockerfile',
  extensions: ['.dockerfile'],
  markers: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'],
  binary: 'docker-langserver',
  args: ['--stdio'],
  install: { type: 'npm', package: 'dockerfile-language-server-nodejs' },
});

export const terraform = defineServer({
  id: 'terraform',
  extensions: ['.tf', '.tfvars', '.hcl'],
  markers: ['.terraform', 'main.tf', 'terraform.tfvars', 'versions.tf', '.terraform.lock.hcl'],
  binary: 'terraform-ls',
  args: ['serve'],
  install: {
    type: 'github-release',
    repo: 'hashicorp/terraform-ls',
    binary: 'terraform-ls',
    // e.g. terraform-ls_1.x.x_linux_amd64.zip, terraform-ls_1.x.x_darwin_arm64.zip
    assetPattern(os, ar, version) {
      const v = version.replace(/^v/, '');
      const goArch = ar === 'arm64' ? 'arm64' : 'amd64';
      const platform = os === 'darwin' ? 'darwin' : os === 'windows' ? 'windows' : 'linux';
      return `terraform-ls_${v}_${platform}_${goArch}.zip`;
    },
  },
});

export const ansible = defineServer({
  id: 'ansible',
  extensions: ['.yml', '.yaml'],
  markers: ['ansible.cfg', 'site.yml', 'playbook.yml', 'roles', 'inventory'],
  binary: 'ansible-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: '@ansible/ansible-language-server' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// ORM / App schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const prisma = defineServer({
  id: 'prisma',
  extensions: ['.prisma'],
  markers: ['prisma/schema.prisma', 'schema.prisma', 'package.json'],
  binary: 'prisma-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: '@prisma/language-server' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Web3 / Blockchain
// ═══════════════════════════════════════════════════════════════════════════════

export const solidity = defineServer({
  id: 'solidity',
  extensions: ['.sol'],
  markers: ['foundry.toml', 'hardhat.config.ts', 'hardhat.config.js', 'truffle-config.js', 'package.json'],
  binary: 'nomicfoundation-solidity-language-server',
  args: ['--stdio'],
  install: { type: 'npm', package: '@nomicfoundation/solidity-language-server' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Hardware description
// ═══════════════════════════════════════════════════════════════════════════════

export const vhdl = defineServer({
  id: 'vhdl',
  extensions: ['.vhd', '.vhdl'],
  markers: ['vhdl_ls.toml', '.git'],
  binary: 'vhdl_ls',
  args: [],
  install: { type: 'cargo', crate: 'vhdl_ls' },
});

export const verilog = defineServer({
  id: 'verilog',
  extensions: ['.v', '.sv', '.svh', '.vh'],
  markers: ['.git'],
  binary: 'svls',
  args: [],
  install: { type: 'cargo', crate: 'svls' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// All servers in load order
// ═══════════════════════════════════════════════════════════════════════════════

export const ALL_SERVERS: ServerInfo[] = [
  // JS/TS ecosystem
  typescript,
  svelte,
  vue,
  astro,
  elm,
  purescript,
  // Python
  pyright,
  pylsp,
  ruff,
  // Go
  gopls,
  // Rust
  rustAnalyzer,
  // C/C++
  clangd,
  // .NET
  csharp,
  fsharp,
  // JVM
  kotlin,
  scala,
  // Swift
  swift,
  // Ruby
  ruby,
  solargraph,
  // PHP
  php,
  // Dart
  dart,
  // Shell
  bash,
  // Lua
  lua,
  // Functional
  elixir,
  erlang,
  haskell,
  ocaml,
  clojure,
  gleam,
  // Systems
  zig,
  nim,
  d,
  vMove,
  // Data science
  r,
  julia,
  cmake,
  fortran,
  // Nix
  nix,
  // Web
  css,
  html,
  // Config formats
  json,
  yaml,
  toml,
  xml,
  nickel,
  pkl,
  // DB/query
  sql,
  // API/Schema
  graphql,
  proto,
  jsonnet,
  // Prose
  marksman,
  // DevOps
  dockerfile,
  terraform,
  ansible,
  // ORM
  prisma,
  // Web3
  solidity,
  // Hardware
  vhdl,
  verilog,
];

export function __setServerTestOverrides(overrides: {
  which?: WhichBinary;
  spawn?: SpawnProcess;
}): void {
  if (overrides.which) whichBinary = overrides.which;
  if (overrides.spawn) spawnProcess = overrides.spawn;
}

export function __resetServerTestOverrides(): void {
  whichBinary = (binary) => Bun.which(binary);
  spawnProcess = (cmd, options) => Bun.spawn(cmd, options);
}
