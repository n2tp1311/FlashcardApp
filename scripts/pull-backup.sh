#!/bin/bash
# Pull the server's newest nightly database copy to this machine (server/lib/backup.js,
# GET /api/backup/latest). Run by the LaunchAgent com.flashcardapp.backup; safe to run
# by hand. Copies on the Railway volume die with the volume, so these are the ones that
# survive losing it.
#
# A backup that silently stops is the usual way backups fail, so every failure, and a
# server copy more than two days old, raises a macOS notification as well as a log line.
set -u

URL="${FLASHCARD_URL:-https://flashcardapp.up.railway.app}/api/backup/latest"
TOKEN_FILE="${BACKUP_TOKEN_FILE:-$HOME/.config/flashcardapp/backup-token}"
DEST="${BACKUP_DEST:-$HOME/Backups/FlashcardApp}"
KEEP="${BACKUP_KEEP:-30}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
fail() {
  log "FAILED: $*"
  osascript -e "display notification \"$*\" with title \"FlashcardApp backup failed\"" 2>/dev/null
  exit 1
}

[ -r "$TOKEN_FILE" ] || fail "no token file at $TOKEN_FILE"
mkdir -p "$DEST"
part="$DEST/.download.part"
headers="$DEST/.download.headers"
rm -f "$part" "$headers"

# The token goes in a header read from a file: never on the command line, where ps shows it.
code=$(curl -sS -o "$part" -D "$headers" -w '%{http_code}' --max-time 600 \
  -H @<(printf 'Authorization: Bearer %s\n' "$(tr -d '\r\n' < "$TOKEN_FILE")") "$URL") \
  || fail "could not reach the server"
[ "$code" = "200" ] || fail "server answered HTTP $code"

day=$(tr -d '\r' < "$headers" | awk -F': ' 'tolower($1)=="x-backup-day" {print $2}')
[[ "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "no backup day in the response"

db="$DEST/flashcards-$day.db"
gunzip -c "$part" > "$db.part" || fail "download for $day is not valid gzip"
check=$(sqlite3 "$db.part" "PRAGMA integrity_check;" 2>&1)
[ "$check" = "ok" ] || { rm -f "$db.part"; fail "copy for $day failed integrity_check: ${check:0:80}"; }
mv "$db.part" "$db"
rm -f "$part" "$headers"
log "saved $(basename "$db") ($(du -h "$db" | cut -f1 | tr -d ' '))"

# Oldest first by name, which is by date. (macOS head has no negative -n.)
copies=$(ls "$DEST"/flashcards-*.db 2>/dev/null | sort)
extra=$(( $(printf '%s\n' "$copies" | grep -c .) - KEEP ))
[ "$extra" -gt 0 ] && printf '%s\n' "$copies" | head -n "$extra" | while read -r old; do rm -f "$old"; done

age_days=$(( ( $(date -u +%s) - $(date -ju -f '%Y-%m-%d' "$day" +%s) ) / 86400 ))
[ "$age_days" -le 2 ] || fail "the server's newest copy is from $day, $age_days days ago"
exit 0
