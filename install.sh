#!/bin/bash
# Installs Cage on this Mac: copies the code to ~/Library/Application Support/Cage/app (outside of Downloads, which macOS
# protects for background processes), encrypted data in ~/.cage, ON-DEMAND user service on port
# 8787 (does not start on its own or restart: 0 MB when not in use; shuts down after 2 min without use) and the app
# ~/Applications/Cage.app with its logo (shortcut on the Desktop), which starts it if needed and opens the browser. Can be run again: updates the code and preserves data.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Cage/app"
PORT="${CAGE_PORT:-8787}"
mkdir -p "$DEST/web"
cp "$SRC"/{server.py,vault.py,seed.py,signals.py,obsidian.py,research.py,hq.py,inbox.py,lifesrc.py,offsite.py,memory.py,benchmark.py} "$DEST/"
cp "$SRC"/web/{index.html,app.js,app.css,charts.js,engine.js,life.js,life-money.js,life-health.js,assistant.js,invest.js,guide.js,progress.js,review.js,tools.js,motion.js,icons.js,trading.js,trading-real.js,longterm.js,results.js,news.js,dexui.js,allocui.js,mail.js,lifeui.js,system.js,brief.js,docs.js,projstatus.js,memoryui.js,prov.js,bench.js,connect.js} "$DEST/web/"
mkdir -p "$DEST/trading" && cp "$SRC"/trading/*.py "$DEST/trading/"
mkdir -p "$DEST/benchmarks" && cp "$SRC"/benchmarks/published.json "$DEST/benchmarks/"
mkdir -p "$DEST/evals" && cp "$SRC"/evals/{finanzas_es.jsonl,run_exam.py,make_exam.py} "$DEST/evals/"
cd "$DEST"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -c 'import cryptography' 2>/dev/null || .venv/bin/pip install -q 'cryptography>=42'
mkdir -p "$HOME/.cage" && chmod 700 "$HOME/.cage"
PL="$HOME/Library/LaunchAgents/org.cage.server.plist"
mkdir -p "$(dirname "$PL")"
cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.cage.server</string>
<key>ProgramArguments</key><array><string>$DEST/.venv/bin/python</string><string>$DEST/server.py</string><string>--port</string><string>$PORT</string></array>
<key>RunAtLoad</key><false/><key>KeepAlive</key><false/>
<key>ProcessType</key><string>Background</string>
<key>LowPriorityIO</key><true/><key>Nice</key><integer>5</integer>
<key>StandardOutPath</key><string>$HOME/.cage/server.log</string>
<key>StandardErrorPath</key><string>$HOME/.cage/server.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/org.cage.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL"
# App with logo: ~/Applications/Cage.app (Launchpad, Spotlight, Dock) and shortcut on the Desktop.
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Cage.app.new"
cp -R "$SRC/brand/Cage.app" "$HOME/Applications/Cage.app.new"
rm -rf "$HOME/Applications/Cage.app" && mv "$HOME/Applications/Cage.app.new" "$HOME/Applications/Cage.app"
[ -d "$HOME/Desktop" ] && ln -sfn "$HOME/Applications/Cage.app" "$HOME/Desktop/Cage.app" || true
touch "$HOME/Applications/Cage.app"
if [ "${1:-}" = "--with-agent" ]; then
  # Optional 24/7 paper agent (prices, news, allocator, monthly re-evaluation). About 25 MB while running.
  mkdir -p "$HOME/.cage/trading"
  AP="$HOME/Library/LaunchAgents/org.cage.agent.plist"
  cat > "$AP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.cage.agent</string>
<key>ProgramArguments</key><array><string>$DEST/.venv/bin/python</string><string>$DEST/trading/agent.py</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>60</integer>
<key>ProcessType</key><string>Background</string>
<key>LowPriorityIO</key><true/><key>Nice</key><integer>10</integer>
<key>StandardOutPath</key><string>$HOME/.cage/trading/service.log</string>
<key>StandardErrorPath</key><string>$HOME/.cage/trading/service.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/org.cage.agent" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AP"
  echo "24/7 paper agent installed (org.cage.agent). Real money stays off."
fi
echo "Cage installed · http://127.0.0.1:$PORT · app: ~/Applications/Cage.app (shortcut on Desktop)"
