#!/usr/bin/env bash
#
# Verify the discovery and sharing surfaces on a running BrainSNN server.
#
# Everything here is asserted against what the SERVER SENDS, not against what
# React renders, so it only means anything in production mode:
#
#   cd brainsnn-r3f-app
#   npm run build && NODE_ENV=production PORT=3112 node dist/server.cjs &
#   ../scripts/verify-discovery.sh http://localhost:3112
#
# Or against the live site:
#
#   scripts/verify-discovery.sh https://www.brainsnn.com
#
set -uo pipefail

BASE="${1:-https://www.brainsnn.com}"
PASS=0
FAIL=0

ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

# check <description> <haystack> <needle>
check() {
  if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}

echo "Verifying $BASE"
echo

echo "sitemap"
SITEMAP=$(curl -sS "$BASE/sitemap.xml")
check "declares the sitemaps.org namespace" "$SITEMAP" 'http://www.sitemaps.org/schemas/sitemap/0.9'
for path in / /lab /app /evidence /reconstruct; do
  check "lists $path" "$SITEMAP" "<loc>https://www.brainsnn.com${path}</loc>"
done

echo
echo "robots"
ROBOTS=$(curl -sS "$BASE/robots.txt")
check "points at the sitemap" "$ROBOTS" 'Sitemap: https://www.brainsnn.com/sitemap.xml'
check "keeps crawlers out of the API" "$ROBOTS" 'Disallow: /api/'
for bot in GPTBot OAI-SearchBot ClaudeBot PerplexityBot Google-Extended; do
  check "names $bot" "$ROBOTS" "User-agent: $bot"
done

echo
echo "content a crawler can read without running JavaScript"
HEADINGS=""
for path in / /lab /app /evidence /reconstruct; do
  HTML=$(curl -sS "$BASE$path")
  # Inside #root, so React replaces it on mount rather than leaving it behind.
  check "$path injects into #root" "$HTML" '<div id="root"><main data-prerendered="1"'
  H1=$(printf '%s' "$HTML" | grep -o '<h1[^>]*>[^<]*</h1>' | head -1 | sed 's/<[^>]*>//g')
  if [ -n "$H1" ]; then ok "$path has an h1: \"$H1\""; else bad "$path has no h1"; fi
  HEADINGS="$HEADINGS$H1\n"
done
UNIQUE=$(printf "$HEADINGS" | sort -u | grep -c .)
if [ "$UNIQUE" -eq 5 ]; then
  ok "all five headings differ"
else
  # The homepage is the one that regressed before: express.static answered "/"
  # off disk, so it never reached the per-route rendering at all.
  bad "expected 5 distinct headings, got $UNIQUE"
fi

echo
echo "the evidence card quotes live numbers"
EVIDENCE=$(curl -sS "$BASE/evidence")
if printf '%s' "$EVIDENCE" | grep -qE 'og:description" content="[^"]*0\.[0-9]'; then
  ok "og:description carries measured decimals"
else
  bad "og:description has no measured figure in it"
fi

echo
echo "a shared circuit previews as itself"
# A real share string — a 40-cell wall line on an otherwise empty 240x160 grid,
# produced by encodeGrid. Hand-writing one does not work: decodeGrid refuses
# anything whose runs do not cover every cell exactly, which is deliberate (a
# short grid is a truncated link, not a small drawing).
GRID="p1:240x160:ew4A14DepgA"
ENCODED=$(printf '%s' "$GRID" | sed 's/:/%3A/g')
LAB=$(curl -sS "$BASE/lab?grid=$ENCODED")
check "og:image points at the card endpoint" "$LAB" '/api/og/lab?grid='

CARD=$(mktemp)
CODE=$(curl -sS -o "$CARD" -w '%{http_code}' "$BASE/api/og/lab?grid=$ENCODED")
if [ "$CODE" = "200" ]; then ok "card returns 200"; else bad "card returned $CODE"; fi
if file "$CARD" | grep -q 'PNG image data, 1200 x 630'; then
  ok "card is a 1200x630 PNG"
else
  bad "card is not a 1200x630 PNG: $(file -b "$CARD")"
fi
rm -f "$CARD"

for junk in "" "garbage" "p1%3A240x160%3Atruncated"; do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/og/lab?grid=$junk")
  if [ "$CODE" = "404" ]; then
    ok "refuses a link with no valid grid ('${junk:-empty}')"
  else
    bad "expected 404 for '${junk:-empty}', got $CODE"
  fi
done

echo
echo "attribution reaches the sink"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/events" \
  -H 'Content-Type: application/json' \
  -d '{"event":"visit","from":{"ref":"news.ycombinator.com","utm_source":"hn"},"path":"/"}')
if [ "$CODE" = "204" ]; then ok "accepts a visit event"; else bad "visit event returned $CODE"; fi
echo "  note: confirm it landed with — grep '\[brainsnn:event\] {\"event\":\"visit\"' over the server log"

echo
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
