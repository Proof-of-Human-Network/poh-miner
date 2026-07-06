#!/usr/bin/env bash
# Ensure the Vulkan runtime is present so the QVAC llama.cpp backend can load.
#
# QVAC's inference addon links against the Vulkan loader (libvulkan.so.1). On
# machines without a GPU — e.g. a headless VPS — the loader and a software
# (CPU) driver are usually absent, and QVAC fails to start with
#   "libvulkan.so.1: cannot open shared object file".
# This installs the loader plus a software rasterizer (Mesa lavapipe) so QVAC
# runs on CPU-only hosts. No-op on non-Linux and when Vulkan is already present.
# Best-effort: never fails the caller.
set -u

[ "$(uname -s)" = "Linux" ] || exit 0

# Already available? (loader on the linker path is enough to load QVAC)
if ldconfig -p 2>/dev/null | grep -q 'libvulkan\.so\.1'; then
  exit 0
fi

echo "→ QVAC needs the Vulkan runtime (libvulkan.so.1 missing). Installing loader + CPU driver…"

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

if command -v apt-get >/dev/null 2>&1; then
  $SUDO apt-get update -qq || true
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y libvulkan1 mesa-vulkan-drivers || true
elif command -v dnf >/dev/null 2>&1; then
  $SUDO dnf install -y vulkan-loader mesa-vulkan-drivers || true
elif command -v pacman >/dev/null 2>&1; then
  $SUDO pacman -S --noconfirm --needed vulkan-icd-loader vulkan-swrast || true
elif command -v zypper >/dev/null 2>&1; then
  $SUDO zypper --non-interactive install libvulkan1 libvulkan_lvp || true
elif command -v apk >/dev/null 2>&1; then
  $SUDO apk add --no-cache vulkan-loader mesa-vulkan- swrast 2>/dev/null || $SUDO apk add --no-cache vulkan-loader mesa-vulkan-lavapipe || true
else
  echo "  ⚠️  No known package manager found. Install the Vulkan loader + a driver manually, e.g.:"
  echo "      Debian/Ubuntu: sudo apt-get install -y libvulkan1 mesa-vulkan-drivers"
  exit 0
fi

if ldconfig -p 2>/dev/null | grep -q 'libvulkan\.so\.1'; then
  echo "  ✓ Vulkan runtime installed."
else
  echo "  ⚠️  Tried to install Vulkan but libvulkan.so.1 is still missing; QVAC inference may fail on this host."
fi
exit 0
