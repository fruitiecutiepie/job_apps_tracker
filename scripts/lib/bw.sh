# Sourced by the scripts in scripts/. Reads secrets from the Bitwarden vault
# with the bw CLI. Each secret is a Login item whose password is the value.
#
# Copied from fruitiecutiepie.com's scripts/lib/bw.sh with its own prefix, so
# this repo's items and the website's never share a name.

BW_ITEM_PREFIX="job_apps_tracker/"

bw_require_unlocked() {
  command -v bw >/dev/null || { echo "bw not found: brew install bitwarden-cli" >&2; exit 1; }
  command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }

  case "$(bw status | jq -r .status)" in
    unlocked) ;;
    locked)
      # Prompts for the master password. The session key lives only in this
      # process's environment; `source scripts/bw-unlock` keeps one for the
      # whole shell instead.
      bw_unlock || exit 1
      ;;
    *)
      echo "Not logged in to Bitwarden. Run: bw login" >&2
      exit 1
      ;;
  esac
}

# Sets and exports BW_SESSION, allowing three master password attempts.
bw_unlock() {
  local attempt session account
  # bw's own prompt only says "Master password", which is easy to mistake for
  # the Mac login password.
  account="$(bw status | jq -r '.userEmail // "unknown account"')"
  echo "Unlocking Bitwarden ($account). Enter your Bitwarden master password, not your Mac password." >&2
  for attempt in 1 2 3; do
    if session="$(bw unlock --raw)" && [ -n "$session" ]; then
      BW_SESSION="$session"
      export BW_SESSION
      return 0
    fi
    [ "$attempt" -lt 3 ] && echo "Wrong Bitwarden master password? Try again ($attempt/3)" >&2
  done
  echo "Could not unlock Bitwarden" >&2
  return 1
}

# bw_secret NAME prints the password of the item named "$BW_ITEM_PREFIX$NAME".
# Matches the name exactly, syncing once if the item isn't in the local cache.
bw_secret() {
  local name="$BW_ITEM_PREFIX$1" value
  value="$(_bw_find "$name")"
  if [ -z "$value" ]; then
    bw sync >/dev/null
    value="$(_bw_find "$name")"
  fi
  if [ -z "$value" ]; then
    echo "No Bitwarden item named \"$name\" with a password" >&2
    exit 1
  fi
  printf '%s' "$value"
}

_bw_find() {
  bw list items --search "$1" |
    jq -r --arg name "$1" '[.[] | select(.name == $name) | .login.password // empty] | first // empty'
}
