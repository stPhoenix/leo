#!/usr/bin/env bash
#
# vault-encryption-wizard.sh — interactive TUI for managing LUKS-encrypted Obsidian
# vault disks. Wraps `encrypt-vault-ssd.sh` for the encrypt path and adds
# unlock/mount, lock/unmount, and status operations.
#
# Requires: whiptail (pre-installed on most Debian/Ubuntu via libnewt),
#           cryptsetup, lsblk, findmnt, blkid, mount, umount, sudo, wipefs
#
# Usage:
#   ./vault-encryption-wizard.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENCRYPT_SCRIPT="${SCRIPT_DIR}/encrypt-vault-ssd.sh"
BACKTITLE="Leo Vault Encryption Wizard"

# ----------------------------- bootstrap -------------------------------------

err() { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; }

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "missing required binary: $1"
    exit 69
  fi
}

for b in whiptail cryptsetup lsblk findmnt blkid mount umount sudo wipefs; do
  require_bin "$b"
done

if [[ ! -x "$ENCRYPT_SCRIPT" ]]; then
  err "missing or not executable: $ENCRYPT_SCRIPT"
  err "expected the LUKS setup script next to this wizard"
  exit 66
fi

if ! [[ -t 0 && -t 1 ]]; then
  err "this wizard requires an interactive TTY"
  exit 1
fi

# ----------------------------- whiptail wrappers -----------------------------

WT() { whiptail --backtitle "$BACKTITLE" "$@"; }

wt_menu() {
  # wt_menu <title> <prompt> <menu_items...>
  # menu_items are pairs of TAG ITEM
  local title="$1" prompt="$2"
  shift 2
  WT --title "$title" --menu "$prompt" 22 78 12 "$@" 3>&1 1>&2 2>&3
}

wt_input() {
  local title="$1" prompt="$2" default="${3:-}"
  WT --title "$title" --inputbox "$prompt" 10 78 "$default" 3>&1 1>&2 2>&3
}

wt_password() {
  local title="$1" prompt="$2"
  WT --title "$title" --passwordbox "$prompt" 10 78 3>&1 1>&2 2>&3
}

wt_yesno() {
  local title="$1" prompt="$2"
  WT --title "$title" --yesno "$prompt" 12 78
}

wt_msg() {
  local title="$1" prompt="$2"
  WT --title "$title" --msgbox "$prompt" 14 78
}

wt_textbox() {
  local title="$1" file="$2"
  WT --title "$title" --scrolltext --textbox "$file" 22 90
}

# ----------------------------- device discovery ------------------------------

root_disk_name() {
  local src parent
  src="$(findmnt -no SOURCE /)"
  parent="$(lsblk -no PKNAME "$src" 2>/dev/null || true)"
  if [[ -n "$parent" ]]; then
    printf '%s\n' "$parent"
  else
    basename "$src"
  fi
}

root_partition_path() {
  findmnt -no SOURCE /
}

list_block_devices() {
  lsblk -P -o NAME,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINT,TYPE,PKNAME
}

has_open_mapper() {
  local dev="$1"
  local base
  base="$(basename "$dev")"
  while read -r line; do
    eval "$line"
    if [[ "${TYPE:-}" == "crypt" && "${PKNAME:-}" == "$base" ]]; then
      return 0
    fi
  done < <(list_block_devices)
  return 1
}

# Build TAG/ITEM pairs for whiptail --menu and pick a device.
# Filters:
#   encrypt-candidate  — disk/part, not LUKS, not mounted, not on root disk
#   luks-closed        — FSTYPE=crypto_LUKS and not currently opened
#   luks-open          — TYPE=crypt (mapper devices)
#
# Echoes "/dev/<name>" or returns non-zero on cancel/no-match.
pick_device() {
  local filter="$1"
  local title="$2"
  local rdisk rpart
  rdisk="$(root_disk_name)"
  rpart="$(root_partition_path)"

  local pairs=()
  while read -r line; do
    eval "$line"
    : "${NAME:=}" "${SIZE:=}" "${MODEL:=}" "${SERIAL:=}" "${FSTYPE:=}" "${MOUNTPOINT:=}" "${TYPE:=}" "${PKNAME:=}"

    case "$filter" in
      encrypt-candidate)
        [[ "$TYPE" == "disk" || "$TYPE" == "part" ]] || continue
        [[ "$FSTYPE" == "crypto_LUKS" ]] && continue
        [[ -n "$MOUNTPOINT" ]] && continue
        [[ "/dev/${NAME}" == "$rpart" ]] && continue
        [[ "$NAME" == "$rdisk" || "$PKNAME" == "$rdisk" ]] && continue
        ;;
      luks-closed)
        [[ "$FSTYPE" == "crypto_LUKS" ]] || continue
        if has_open_mapper "/dev/${NAME}"; then continue; fi
        ;;
      luks-open)
        [[ "$TYPE" == "crypt" ]] || continue
        ;;
      *)
        err "unknown filter: $filter"
        return 2
        ;;
    esac

    local descr
    descr=$(printf '%s %s %s %s' \
      "$SIZE" "${MODEL:--}" "${SERIAL:--}" "${FSTYPE:-${MOUNTPOINT:--}}")
    pairs+=("$NAME" "$descr")
  done < <(list_block_devices)

  if [[ ${#pairs[@]} -eq 0 ]]; then
    wt_msg "No devices" "No matching devices for filter: $filter"
    return 1
  fi

  local choice
  if ! choice="$(wt_menu "$title" "Select a device:" "${pairs[@]}")"; then
    return 1
  fi
  [[ -z "$choice" ]] && return 1
  printf '/dev/%s\n' "$choice"
}

# ----------------------------- ops -------------------------------------------

op_encrypt() {
  local dev
  if ! dev="$(pick_device encrypt-candidate "Encrypt new device")"; then
    return
  fi

  local mapper mount default_mount
  mapper="$(wt_input "Mapper name" "LUKS mapper name (used as /dev/mapper/<name>):" "leo-vault")" || return
  [[ -z "$mapper" ]] && return
  default_mount="/media/${USER}/${mapper}"
  mount="$(wt_input "Mount point" "Mount point for the unlocked vault\n(/media/<user>/... shows in file browser sidebar):" "$default_mount")" || return
  [[ -z "$mount" ]] && return

  local prompt
  prompt=$(printf 'About to ENCRYPT (DESTRUCTIVE):\n\n  device : %s\n  mapper : %s\n  mount  : %s\n\nALL DATA ON %s WILL BE WIPED.\n\nContinue?' \
    "$dev" "$mapper" "$mount" "$dev")
  if ! wt_yesno "Confirm encryption" "$prompt"; then
    return
  fi

  clear
  sudo -v
  if sudo "$ENCRYPT_SCRIPT" "$dev" "$mapper" "$mount"; then
    read -r -p "Encryption finished. Press Enter to return to menu..." _
  else
    read -r -p "Encryption failed. Press Enter to return to menu..." _
  fi
}

op_unlock_mount() {
  local dev
  if ! dev="$(pick_device luks-closed "Unlock + mount existing")"; then
    return
  fi

  local default_mapper mapper
  default_mapper="$(blkid -s LABEL -o value "$dev" 2>/dev/null || true)"
  [[ -z "$default_mapper" ]] && default_mapper="leo-vault"
  mapper="$(wt_input "Mapper name" "Open as /dev/mapper/<name>:" "$default_mapper")" || return
  [[ -z "$mapper" ]] && return

  if [[ -e "/dev/mapper/${mapper}" ]]; then
    wt_msg "Mapper exists" "/dev/mapper/${mapper} already exists. Pick a different name or close it first."
    return
  fi

  local pass
  pass="$(wt_password "Passphrase" "Enter LUKS passphrase for ${dev}:")" || return
  if [[ -z "$pass" ]]; then
    wt_msg "Cancelled" "Empty passphrase."
    return
  fi

  sudo -v
  if ! printf '%s' "$pass" | sudo cryptsetup open "$dev" "$mapper" --key-file=- 2>/tmp/.leo-wizard.err; then
    unset pass
    local errmsg
    errmsg="$(< /tmp/.leo-wizard.err)"
    rm -f /tmp/.leo-wizard.err
    wt_msg "Unlock failed" "cryptsetup open failed (wrong passphrase or device error).\n\n${errmsg}"
    return
  fi
  unset pass
  rm -f /tmp/.leo-wizard.err

  local fstab_mount mount default_mount
  fstab_mount="$(awk -v m="/dev/mapper/${mapper}" '$1==m {print $2}' /etc/fstab | head -1)"
  if [[ -n "$fstab_mount" ]]; then
    mount="$fstab_mount"
  else
    default_mount="/media/${USER}/${mapper}"
    mount="$(wt_input "Mount point" "Mount /dev/mapper/${mapper} at\n(/media/<user>/... shows in file browser):" "$default_mount")" || {
      wt_msg "Mount skipped" "Device unlocked but not mounted. /dev/mapper/${mapper} is open."
      return
    }
    [[ -z "$mount" ]] && {
      wt_msg "Mount skipped" "Device unlocked but not mounted. /dev/mapper/${mapper} is open."
      return
    }
  fi

  sudo mkdir -p "$mount"
  if findmnt -rno TARGET "$mount" >/dev/null 2>&1; then
    wt_msg "Already mounted" "$mount is already a mount point. Skipping mount."
    return
  fi

  if [[ -n "$(ls -A "$mount" 2>/dev/null)" ]]; then
    if ! wt_yesno "Mountpoint not empty" "$mount is not empty. Mount anyway?\n\nExisting files will be hidden until unmount."; then
      wt_msg "Skipped" "Mount cancelled. /dev/mapper/${mapper} is still open."
      return
    fi
  fi

  if [[ -n "$fstab_mount" ]]; then
    sudo mount "$mount"
  else
    sudo mount "/dev/mapper/${mapper}" "$mount"
  fi

  # Ensure user owns parent (/media/<user>) and the mountpoint so the file
  # browser can read/write without sudo.
  local parent_dir
  parent_dir="$(dirname "$mount")"
  if [[ "$parent_dir" == "/media/${USER}" || "$parent_dir" == "/run/media/${USER}" ]]; then
    sudo chown "${USER}:${USER}" "$parent_dir" 2>/dev/null || true
  fi
  sudo chown "${USER}:${USER}" "$mount" 2>/dev/null || true

  wt_msg "Mounted" "Unlocked + mounted:\n\n  /dev/mapper/${mapper} → ${mount}\n\nOpen in file browser: Ctrl+L → ${mount}"
}

op_unlock_udisks() {
  if ! command -v udisksctl >/dev/null 2>&1; then
    wt_msg "udisksctl missing" "udisksctl not installed. Install with:\n\n  sudo apt install udisks2"
    return
  fi

  local dev
  if ! dev="$(pick_device luks-closed "Unlock via udisks (auto-mount)")"; then
    return
  fi

  clear
  echo "Calling udisksctl unlock on $dev..."
  echo "(polkit will prompt for your password)"
  echo

  local mapper_dev
  if ! mapper_dev="$(udisksctl unlock -b "$dev" 2>&1 | tee /dev/tty | awk '/Unlocked .* as/ {print $NF}' | tr -d '.')"; then
    read -r -p "Press Enter to return to menu..." _
    return
  fi

  if [[ -z "$mapper_dev" ]]; then
    # Fall back: find newly-opened mapper child of $dev
    mapper_dev="$(lsblk -nrpo NAME,TYPE,PKNAME | awk -v p="$(basename "$dev")" '$2=="crypt" && $3==p {print $1}' | head -1)"
  fi

  if [[ -z "$mapper_dev" ]]; then
    wt_msg "Unlock failed" "Could not determine mapper device after unlock."
    return
  fi

  echo
  echo "Mounting $mapper_dev via udisks..."
  echo
  if udisksctl mount -b "$mapper_dev"; then
    local mp
    mp="$(findmnt -rno TARGET "$mapper_dev" || true)"
    read -r -p "Press Enter to return to menu..." _
    if [[ -n "$mp" ]]; then
      wt_msg "Mounted" "Unlocked + mounted via udisks:\n\n  ${mapper_dev} → ${mp}\n\nFile browser sidebar should now show it."
    fi
  else
    read -r -p "Mount failed. Press Enter to return to menu..." _
  fi
}

op_lock_unmount() {
  local dev mapper
  if ! dev="$(pick_device luks-open "Lock + unmount")"; then
    return
  fi
  mapper="$(basename "$dev")"

  local mountpoint
  mountpoint="$(findmnt -rno TARGET "/dev/mapper/${mapper}" || true)"

  local prompt
  prompt=$(printf 'About to LOCK:\n\n  mapper : %s\n  mount  : %s\n\nUnmount and close mapper?' \
    "$mapper" "${mountpoint:-<none>}")
  if ! wt_yesno "Confirm lock" "$prompt"; then
    return
  fi

  sudo -v
  if [[ -n "$mountpoint" ]]; then
    if ! sudo umount "$mountpoint" 2>/tmp/.leo-wizard.err; then
      local errmsg
      errmsg="$(< /tmp/.leo-wizard.err)"
      rm -f /tmp/.leo-wizard.err
      wt_msg "Unmount failed" "umount failed for ${mountpoint}.\n\n${errmsg}\n\nTry: sudo umount -l ${mountpoint}"
      return
    fi
  fi
  rm -f /tmp/.leo-wizard.err

  if ! sudo cryptsetup close "$mapper" 2>/tmp/.leo-wizard.err; then
    local errmsg
    errmsg="$(< /tmp/.leo-wizard.err)"
    rm -f /tmp/.leo-wizard.err
    wt_msg "Close failed" "cryptsetup close failed for ${mapper}.\n\n${errmsg}"
    return
  fi
  rm -f /tmp/.leo-wizard.err
  wt_msg "Locked" "Unmounted and closed: ${mapper}"
}

op_status() {
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN

  {
    printf '%-7s %-14s %-7s %-13s %-9s %-25s %s\n' \
      KIND NAME SIZE FSTYPE STATE MOUNTPOINT LABEL
    printf -- '%.0s-' {1..98}; printf '\n'

    local found=0
    while read -r line; do
      eval "$line"
      : "${NAME:=}" "${SIZE:=}" "${FSTYPE:=}" "${MOUNTPOINT:=}" "${TYPE:=}" "${LABEL:=}"
      if [[ "$FSTYPE" == "crypto_LUKS" ]]; then
        local state="locked"
        has_open_mapper "/dev/${NAME}" && state="unlocked"
        printf '%-7s %-14s %-7s %-13s %-9s %-25s %s\n' \
          LUKS "$NAME" "$SIZE" "$FSTYPE" "$state" "-" "${LABEL:--}"
        found=1
      elif [[ "$TYPE" == "crypt" ]]; then
        printf '%-7s %-14s %-7s %-13s %-9s %-25s %s\n' \
          MAPPER "$NAME" "$SIZE" "${FSTYPE:--}" open "${MOUNTPOINT:--}" "${LABEL:--}"
        found=1
      fi
    done < <(lsblk -P -o NAME,SIZE,FSTYPE,MOUNTPOINT,TYPE,LABEL)

    if [[ $found -eq 0 ]]; then
      printf '\n(no LUKS devices or active mappers found)\n'
    fi
  } > "$tmp"

  wt_textbox "LUKS device status" "$tmp"
}

# ----------------------------- main loop -------------------------------------

# Cache sudo creds once up-front so picker flows feel snappy.
if ! sudo -v; then
  err "sudo authentication failed"
  exit 1
fi

while :; do
  if ! choice="$(wt_menu "Main menu" "Choose an action:" \
    encrypt    "Encrypt new device" \
    unlock-ud  "Unlock via udisks (file browser auto-mount)" \
    unlock     "Unlock + mount existing (manual path)" \
    lock       "Lock + unmount" \
    status     "Status" \
    quit       "Quit")"; then
    exit 0
  fi

  case "$choice" in
    encrypt)   op_encrypt ;;
    unlock-ud) op_unlock_udisks ;;
    unlock)    op_unlock_mount ;;
    lock)      op_lock_unmount ;;
    status)    op_status ;;
    quit|"")   exit 0 ;;
  esac
done
