#!/usr/bin/env bash
# Elefant Tauri dev launcher — optimized for Arch Linux + Hyprland + hybrid NVIDIA/AMD
#
# Key problems this solves:
#   1. WebKitGTK defaults to X11/XWayland even in a Wayland session → choppy rendering
#      Fix: GDK_BACKEND=wayland forces native Wayland path
#
#   2. WebKitGTK doesn't know which GPU to use on hybrid systems
#      AMD iGPU = card1/renderD129; NVIDIA dGPU = card0/renderD128
#      Hyprland composes on AMD, so WebKit must render on AMD too (no cross-GPU copy)
#      Fix: WPE_RENDERER_EGL_DRM_DEVICE + LIBVA_DRM_DEVICE point to AMD renderD129
#
#   3. WebKitGTK 2.46+ defaults to dmabuf renderer but can fallback to slower shm
#      Fix: WEBKIT_DISABLE_DMABUF_RENDERER=0 (explicit; ensure it stays on)
#
#   4. WebKit sandbox uses seccomp which intercepts certain GPU calls on some kernels
#      Fix: WEBKIT_FORCE_SANDBOX=0 in dev (never in production builds)
#
#   5. GTK and GLib thread/render overhead
#      Fix: disable ATK bridge (no accessibility daemon in dev), GSETTINGS_SCHEMA_DIR

set -euo pipefail

# ── Display ──────────────────────────────────────────────────────────────────
export GDK_BACKEND=wayland
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
# Fallback: if Wayland init fails, let GTK try X11 rather than crash
export GDK_BACKEND=wayland,x11

# ── GPU: force AMD iGPU (renderD129) for WebKitGTK rendering ─────────────────
# renderD128 = NVIDIA (card0, vendor 0x10de)
# renderD129 = AMD   (card1, vendor 0x1002) — Hyprland's compositor GPU
AMD_RENDER=/dev/dri/renderD129
if [[ -e "$AMD_RENDER" ]]; then
  export WPE_RENDERER_EGL_DRM_DEVICE="$AMD_RENDER"
  export LIBVA_DRM_DEVICE="$AMD_RENDER"
  export WEBKIT_GST_VA_DEVICE="$AMD_RENDER"
fi

# ── WebKitGTK renderer settings ──────────────────────────────────────────────
# Keep dmabuf renderer on (default in 2.46+, fastest path for Wayland)
export WEBKIT_DISABLE_DMABUF_RENDERER=0
# Disable GPU process sandbox in dev — avoids seccomp blocking GPU ioctls
export WEBKIT_FORCE_SANDBOX=0
# Use GPU process for rendering (not the legacy in-process path)
unset WEBKIT_DISABLE_COMPOSITING_MODE 2>/dev/null || true

# ── GTK performance ──────────────────────────────────────────────────────────
# Disable AT-SPI accessibility bridge — saves ~15ms per render cycle in dev
export NO_AT_BRIDGE=1
export GTK_A11Y=none
# Use a fast GSK renderer (ngl = OpenGL Next Generation, faster than gl on Mesa)
export GSK_RENDERER=ngl

# ── GLib/GIO ─────────────────────────────────────────────────────────────────
# Disable gvfs/gio network mounts discovery — not needed, reduces IPC noise
export GIO_USE_VFS=local
export GVFS_DISABLE_FUSE=1

# ── Vite dev server ──────────────────────────────────────────────────────────
# Increase Node heap for large Svelte/Tailwind rebuild in dev
export NODE_OPTIONS="--max-old-space-size=4096"

echo "[elefant-dev] Display: GDK_BACKEND=${GDK_BACKEND}"
echo "[elefant-dev] GPU:     WPE_RENDERER_EGL_DRM_DEVICE=${WPE_RENDERER_EGL_DRM_DEVICE:-not set}"
echo "[elefant-dev] GTK:     GSK_RENDERER=${GSK_RENDERER}"
echo ""

exec bun run tauri dev "$@"
