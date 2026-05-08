#!/usr/bin/env bash
#
# encrypt-vault-ssd.sh — set up a LUKS-encrypted ext4 partition for an Obsidian vault
# on a dedicated SSD, mount it, and print the unlock recipe.
#
# DESTRUCTIVE: wipes the target device. Triple-check the device path before continuing.
#
# Usage:
#   ./encrypt-vault-ssd.sh <device> [mapper-name] [mount-point]
#
# Examples:
#   ./encrypt-vault-ssd.sh /dev/sdb
#   ./encrypt-vault-ssd.sh /dev/sdb1 leo-vault /mnt/leo-vault
#
set -euo pipefail

DEVICE="${1:-}"
MAPPER="${2:-leo-vault}"
VAULT_OWNER="${SUDO_USER:-$(id -un)}"
DEFAULT_MOUNT="/media/${VAULT_OWNER}/${MAPPER}"
MOUNT_POINT="${3:-$DEFAULT_MOUNT}"
LABEL="${LABEL:-leo-vault}"

err()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; }
info() { printf '\033[36m[info]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*"; }

if [[ -z "$DEVICE" ]]; then
  err "no device given"
  echo "usage: $0 <device> [mapper-name] [mount-point]" >&2
  exit 64
fi

if [[ $EUID -ne 0 ]]; then
  err "must run as root (sudo)"
  exit 77
fi

for bin in cryptsetup mkfs.ext4 lsblk findmnt blkid wipefs; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    err "missing required binary: $bin"
    exit 69
  fi
done

if [[ ! -b "$DEVICE" ]]; then
  err "not a block device: $DEVICE"
  exit 66
fi

ROOT_SRC="$(findmnt -no SOURCE /)"
ROOT_DISK="$(lsblk -no PKNAME "$ROOT_SRC" 2>/dev/null || true)"
if [[ -n "$ROOT_DISK" && "$DEVICE" == "/dev/${ROOT_DISK}" ]]; then
  err "refusing: $DEVICE is the system root disk ($ROOT_SRC)"
  exit 1
fi
if [[ "$DEVICE" == "$ROOT_SRC" ]]; then
  err "refusing: $DEVICE is the system root partition"
  exit 1
fi

if findmnt -rno TARGET "$DEVICE" >/dev/null 2>&1; then
  err "$DEVICE is currently mounted at: $(findmnt -rno TARGET "$DEVICE")"
  err "unmount first: umount $DEVICE"
  exit 1
fi

while read -r child; do
  if [[ -n "$child" ]] && findmnt -rno TARGET "/dev/$child" >/dev/null 2>&1; then
    err "child partition /dev/$child is mounted at: $(findmnt -rno TARGET "/dev/$child")"
    err "unmount all partitions of $DEVICE first"
    exit 1
  fi
done < <(lsblk -rno NAME "$DEVICE" | tail -n +2)

info "target device:"
lsblk -o NAME,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINT "$DEVICE"
echo

cat <<EOF
About to perform on $DEVICE:
  1. wipefs        — clear existing filesystem signatures
  2. luksFormat    — create LUKS2 container (you will set a passphrase)
  3. luksOpen      — unlock as /dev/mapper/${MAPPER}
  4. mkfs.ext4     — format the unlocked container as ext4 (label: ${LABEL})
  5. mount         — mount at ${MOUNT_POINT}

THIS DESTROYS ALL DATA ON $DEVICE.
EOF

read -r -p "Type the device path again to confirm ($DEVICE): " CONFIRM
if [[ "$CONFIRM" != "$DEVICE" ]]; then
  err "confirmation mismatch, aborting"
  exit 1
fi

info "wiping existing signatures..."
wipefs -a "$DEVICE"

info "creating LUKS2 container (you will be prompted for a passphrase)..."
cryptsetup -q luksFormat --type luks2 --label "$LABEL" "$DEVICE"

info "opening LUKS container as /dev/mapper/${MAPPER}..."
cryptsetup open "$DEVICE" "$MAPPER"

info "creating ext4 filesystem..."
mkfs.ext4 -L "$LABEL" "/dev/mapper/${MAPPER}"

info "mounting at ${MOUNT_POINT}..."
mkdir -p "$MOUNT_POINT"
mount "/dev/mapper/${MAPPER}" "$MOUNT_POINT"

# Make the mountpoint AND its parent (e.g. /media/<user>) user-owned so file
# browsers and the user can access without sudo.
PARENT_DIR="$(dirname "$MOUNT_POINT")"
if [[ "$PARENT_DIR" == "/media/${VAULT_OWNER}" || "$PARENT_DIR" == "/run/media/${VAULT_OWNER}" ]]; then
  chown "$VAULT_OWNER:$VAULT_OWNER" "$PARENT_DIR" 2>/dev/null || true
fi
chown -R "$VAULT_OWNER:$VAULT_OWNER" "$MOUNT_POINT"

UUID="$(blkid -s UUID -o value "$DEVICE")"

cat <<EOF

✓ Done. Vault SSD ready at: ${MOUNT_POINT}

Device UUID: ${UUID}

Unlock later:
  sudo cryptsetup open UUID=${UUID} ${MAPPER}
  sudo mount /dev/mapper/${MAPPER} ${MOUNT_POINT}

Lock + eject:
  sudo umount ${MOUNT_POINT}
  sudo cryptsetup close ${MAPPER}

Auto-unlock at boot (optional):
  echo "${MAPPER} UUID=${UUID} none luks" | sudo tee -a /etc/crypttab
  echo "/dev/mapper/${MAPPER} ${MOUNT_POINT} ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab

Point Obsidian at: ${MOUNT_POINT}/<your-vault-name>
EOF
