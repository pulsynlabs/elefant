/**
 * LSP server auto-installer.
 *
 * When a language server binary isn't found on first use, this module
 * installs it into a user-local directory (~/.local/share/elefant/lsp-servers/).
 *
 * Install directory layout:
 *   LSP_HOME/npm/             — bun-managed node_modules for npm servers
 *   LSP_HOME/npm/node_modules/.bin/<binary>
 *   LSP_HOME/bin/             — all other binaries (go, cargo, pip, gem, download)
 *
 * Binary resolution order: system PATH → LSP_HOME/npm/.bin → LSP_HOME/bin
 *
 * Installs are fire-and-forget: the current tool call returns immediately
 * without LSP feedback; subsequent calls after install find the binary.
 */

import { homedir, platform, arch } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { mkdir, chmod, readdir, rename, rm } from 'node:fs/promises';

// ── Install location ──────────────────────────────────────────────────────────

function resolveLspHome(): string {
  const xdg = process.env['XDG_DATA_HOME'];
  if (xdg) return join(xdg, 'elefant', 'lsp-servers');
  if (process.platform === 'win32') {
    const appdata = process.env['APPDATA'];
    if (appdata) return join(appdata, 'elefant', 'lsp-servers');
  }
  return join(homedir(), '.local', 'share', 'elefant', 'lsp-servers');
}

export const LSP_HOME = resolveLspHome();
export const LSP_BIN_DIR = join(LSP_HOME, 'bin');
export const LSP_NPM_DIR = join(LSP_HOME, 'npm');

// ── Platform helpers ──────────────────────────────────────────────────────────

export type OSName = 'linux' | 'darwin' | 'windows';
export type ArchName = 'x64' | 'arm64';

export function getOS(): OSName {
  const p = platform();
  if (p === 'darwin') return 'darwin';
  if (p === 'win32') return 'windows';
  return 'linux';
}

export function getArch(): ArchName {
  return arch() === 'arm64' ? 'arm64' : 'x64';
}

// ── Install method types ──────────────────────────────────────────────────────

export type InstallMethod =
  /** npm package installed into LSP_NPM_DIR via `bun add` */
  | { type: 'npm'; package: string }
  /** Multiple npm packages installed together */
  | { type: 'npm-multi'; packages: string[] }
  /** Rust crate from crates.io via `cargo install` */
  | { type: 'cargo'; crate: string; features?: string }
  /** Rust crate from a git repo via `cargo install --git` */
  | { type: 'cargo-git'; repo: string; name: string }
  /** Go module via `go install ...@latest` */
  | { type: 'go'; module: string }
  /** Python package via `pip install --user` (pipx preferred) */
  | { type: 'pip'; package: string }
  /** Ruby gem via `gem install --user-install` */
  | { type: 'gem'; gem: string }
  /** .NET global tool via `dotnet tool install -g` */
  | { type: 'dotnet'; package: string }
  /** Nim package via `nimble install` */
  | { type: 'nimble'; package: string }
  /** OCaml package via `opam install` */
  | { type: 'opam'; package: string }
  /** Haskell toolchain via `ghcup install` */
  | { type: 'ghcup'; tool: string }
  /** Scala/JVM tool via `coursier install` (cs) */
  | { type: 'coursier'; package: string }
  /** R package via `Rscript` */
  | { type: 'r-package'; package: string }
  /**
   * Binary download from GitHub releases.
   *
   * The installer fetches the latest release's full asset list from the
   * GitHub API, then calls `assetPattern(os, arch, version)` to get a
   * string (exact match) or RegExp to select the right asset.
   *
   * Set `binPath` when the binary is nested inside the archive. Leave it
   * omitted to search the extracted tree for a file named `binary`.
   */
  | {
      type: 'github-release';
      repo: string;
      binary: string;
      assetPattern(os: OSName, arch: ArchName, version: string): string | RegExp | undefined;
      binPath?: (os: OSName, arch: ArchName, version: string) => string;
    }
  /** Cannot be auto-installed — requires the user to install the language toolchain */
  | { type: 'manual'; hint: string };

// ── Binary resolution ─────────────────────────────────────────────────────────

export async function resolveBinary(binary: string): Promise<string | undefined> {
  // 1. System PATH
  const systemPath = Bun.which(binary);
  if (systemPath) return systemPath;

  // 2. Elefant-managed npm bin dir
  const npmBin = join(LSP_NPM_DIR, 'node_modules', '.bin', binary);
  if (await Bun.file(npmBin).exists()) return npmBin;
  if (process.platform === 'win32') {
    const npmBinCmd = `${npmBin}.cmd`;
    if (await Bun.file(npmBinCmd).exists()) return npmBinCmd;
  }

  // 3. Elefant-managed bin dir
  const managedBin = join(LSP_BIN_DIR, binary);
  if (await Bun.file(managedBin).exists()) return managedBin;
  if (process.platform === 'win32') {
    const managedBinExe = `${managedBin}.exe`;
    if (await Bun.file(managedBinExe).exists()) return managedBinExe;
  }

  // 4. Common user-local paths not always on PATH
  for (const dir of getUserLocalBinPaths()) {
    const candidate = join(dir, binary);
    if (await Bun.file(candidate).exists()) return candidate;
  }

  return undefined;
}

function getUserLocalBinPaths(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    return [
      join(home, '.cargo', 'bin'),
      join(home, 'go', 'bin'),
      join(home, '.nimble', 'bin'),
      join(home, 'AppData', 'Roaming', 'Python', 'Scripts'),
    ];
  }
  return [
    join(home, '.cargo', 'bin'),
    join(home, 'go', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.nimble', 'bin'),
    join(home, '.gem', 'bin'),
    join(home, '.opam', 'default', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
}

// ── Install state ─────────────────────────────────────────────────────────────

const installing = new Set<string>();
const failed = new Set<string>();

export function isInstalling(id: string): boolean { return installing.has(id); }
export function hasFailed(id: string): boolean { return failed.has(id); }
export function resetInstallState(id?: string): void {
  if (id) { installing.delete(id); failed.delete(id); }
  else { installing.clear(); failed.clear(); }
}

// ── Core runners ──────────────────────────────────────────────────────────────

async function run(cmd: string[], opts?: { env?: Record<string, string>; cwd?: string }): Promise<boolean> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    env: opts?.env ? { ...process.env, ...opts.env } : process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
  return proc.exitCode === 0;
}

async function ensureNpmDir(): Promise<void> {
  await mkdir(LSP_NPM_DIR, { recursive: true });
  const pkgJson = join(LSP_NPM_DIR, 'package.json');
  if (!await Bun.file(pkgJson).exists()) {
    await Bun.write(pkgJson, JSON.stringify({ name: 'elefant-lsp-servers', private: true }, null, 2));
  }
}

// ── GitHub release downloader ─────────────────────────────────────────────────

interface GithubAsset { name: string; browser_download_url: string; }
interface GithubRelease { tag_name: string; assets: GithubAsset[]; }

async function fetchLatestRelease(repo: string): Promise<GithubRelease | undefined> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'elefant-lsp-installer', Accept: 'application/vnd.github+json' },
    });
    if (!resp.ok) return undefined;
    return await resp.json() as GithubRelease;
  } catch {
    return undefined;
  }
}

async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'elefant-lsp-installer' } });
    if (!resp.ok) return false;
    const buf = await resp.arrayBuffer();
    await Bun.write(dest, buf);
    return true;
  } catch {
    return false;
  }
}

/** Extract an archive into destDir. Returns true on success. */
async function extractArchive(archivePath: string, destDir: string): Promise<boolean> {
  await mkdir(destDir, { recursive: true });
  const name = basename(archivePath).toLowerCase();

  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
    return run(['tar', '-xzf', archivePath, '-C', destDir]);
  }
  if (name.endsWith('.tar.xz')) {
    return run(['tar', '-xJf', archivePath, '-C', destDir]);
  }
  if (name.endsWith('.tar.bz2')) {
    return run(['tar', '-xjf', archivePath, '-C', destDir]);
  }
  if (name.endsWith('.zip')) {
    if (process.platform === 'win32') {
      return run(['powershell', '-NoProfile', '-Command',
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`]);
    }
    return run(['unzip', '-o', archivePath, '-d', destDir]);
  }
  // Not an archive — treat as a raw binary
  return true;
}

/** Walk a directory tree to find a file by name. */
async function findBinary(dir: string, name: string): Promise<string | undefined> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await findBinary(full, name);
        if (found) return found;
      } else if (entry.name === name || entry.name === `${name}.exe`) {
        return full;
      }
    }
  } catch { /* ignore */ }
  return undefined;
}

async function installFromGithubRelease(method: Extract<InstallMethod, { type: 'github-release' }>): Promise<boolean> {
  const os = getOS();
  const ar = getArch();

  const release = await fetchLatestRelease(method.repo);
  if (!release) return false;

  const pattern = method.assetPattern(os, ar, release.tag_name);
  if (!pattern) return false; // platform not supported

  const asset = release.assets.find(a =>
    typeof pattern === 'string' ? a.name === pattern : pattern.test(a.name),
  );
  if (!asset) return false;

  const tmpDir = join(LSP_HOME, 'tmp');
  await mkdir(tmpDir, { recursive: true });

  const tmpAsset = join(tmpDir, asset.name);
  const ok = await downloadFile(asset.browser_download_url, tmpAsset);
  if (!ok) return false;

  const isArchive = /\.(tar\.gz|tgz|tar\.xz|tar\.bz2|zip)$/i.test(assetName);

  if (!isArchive) {
    // Raw binary — move it directly
    await mkdir(LSP_BIN_DIR, { recursive: true });
    const dest = join(LSP_BIN_DIR, method.binary);
    await rename(tmpAsset, dest);
    await chmod(dest, 0o755);
    return true;
  }

  // Extract archive
  const extractDir = join(tmpDir, `${method.binary}-extract`);
  const extracted = await extractArchive(tmpAsset, extractDir);
  if (!extracted) return false;

  // Find the binary inside the extraction dir
  let binInArchive: string | undefined;
  if (method.binPath) {
    const relPath = method.binPath(os, ar, tag);
    binInArchive = join(extractDir, relPath);
    if (!await Bun.file(binInArchive).exists()) binInArchive = undefined;
  }
  if (!binInArchive) {
    binInArchive = await findBinary(extractDir, method.binary);
  }
  if (!binInArchive) return false;

  await mkdir(LSP_BIN_DIR, { recursive: true });
  const dest = join(LSP_BIN_DIR, method.binary);
  await rename(binInArchive, dest);
  await chmod(dest, 0o755);

  // Clean up
  await rm(tmpAsset, { force: true });
  await rm(extractDir, { recursive: true, force: true });

  return true;
}

// ── Main install dispatcher ───────────────────────────────────────────────────

async function runInstall(method: InstallMethod): Promise<boolean> {
  switch (method.type) {
    case 'npm': {
      await ensureNpmDir();
      const bun = Bun.which('bun') ?? 'bun';
      return run([bun, 'add', method.package], { cwd: LSP_NPM_DIR });
    }

    case 'npm-multi': {
      await ensureNpmDir();
      const bun = Bun.which('bun') ?? 'bun';
      return run([bun, 'add', ...method.packages], { cwd: LSP_NPM_DIR });
    }

    case 'cargo': {
      const cargo = Bun.which('cargo');
      if (!cargo) return false;
      await mkdir(LSP_HOME, { recursive: true });
      const args = [cargo, 'install', method.crate, '--root', LSP_HOME];
      if (method.features) args.push('--features', method.features);
      return run(args);
    }

    case 'cargo-git': {
      const cargo = Bun.which('cargo');
      if (!cargo) return false;
      await mkdir(LSP_HOME, { recursive: true });
      return run([cargo, 'install', '--git', method.repo, method.name, '--root', LSP_HOME]);
    }

    case 'go': {
      const go = Bun.which('go');
      if (!go) return false;
      await mkdir(LSP_BIN_DIR, { recursive: true });
      return run([go, 'install', `${method.module}@latest`], { env: { GOBIN: LSP_BIN_DIR } });
    }

    case 'pip': {
      // Prefer pipx for isolated installs
      const pipx = Bun.which('pipx');
      if (pipx) {
        const ok = await run([pipx, 'install', '--include-deps', method.package]);
        if (ok) return true;
      }
      const pip = Bun.which('pip3') ?? Bun.which('pip');
      if (!pip) return false;
      return run([pip, 'install', '--user', method.package]);
    }

    case 'gem': {
      const gem = Bun.which('gem');
      if (!gem) return false;
      return run([gem, 'install', '--user-install', method.gem]);
    }

    case 'dotnet': {
      const dotnet = Bun.which('dotnet');
      if (!dotnet) return false;
      return run([dotnet, 'tool', 'install', '-g', method.package]);
    }

    case 'nimble': {
      const nimble = Bun.which('nimble');
      if (!nimble) return false;
      return run([nimble, 'install', '-y', method.package]);
    }

    case 'opam': {
      const opam = Bun.which('opam');
      if (!opam) return false;
      return run([opam, 'install', '-y', method.package]);
    }

    case 'ghcup': {
      const ghcup = Bun.which('ghcup');
      if (!ghcup) return false;
      return run([ghcup, 'install', method.tool, 'latest']);
    }

    case 'coursier': {
      const cs = Bun.which('cs') ?? Bun.which('coursier');
      if (!cs) return false;
      await mkdir(LSP_BIN_DIR, { recursive: true });
      return run([cs, 'install', `--install-dir=${LSP_BIN_DIR}`, method.package]);
    }

    case 'r-package': {
      const Rscript = Bun.which('Rscript');
      if (!Rscript) return false;
      return run([Rscript, '--slave', '-e',
        `install.packages('${method.package}', repos='https://cloud.r-project.org', quiet=TRUE)`]);
    }

    case 'github-release':
      return installFromGithubRelease(method);

    case 'manual':
      return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Trigger a background install for a server.
 * Returns immediately — install happens asynchronously.
 * Subsequent touchFile calls will find the binary once install completes.
 */
export function triggerInstall(serverId: string, method: InstallMethod): void {
  if (method.type === 'manual') return;
  if (installing.has(serverId) || failed.has(serverId)) return;

  installing.add(serverId);
  void (async () => {
    try {
      const ok = await runInstall(method);
      if (!ok) failed.add(serverId);
    } catch {
      failed.add(serverId);
    } finally {
      installing.delete(serverId);
    }
  })();
}
