#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";
import { run } from "../src/commands.mjs";

const config = await loadConfig();
await mkdir(config.paths.logs, { recursive: true });

if (process.platform === "darwin") {
  await installLaunchAgent(config);
} else if (process.platform === "linux") {
  await installSystemdUserService(config);
} else {
  throw new Error("Automatic background installation supports macOS and Linux. Run `npm start` under your preferred service manager.");
}

async function installLaunchAgent(settings) {
  const label = `dev.jira-codex.${safeName(path.basename(settings.repository.path))}`;
  const directory = path.join(os.homedir(), "Library", "LaunchAgents");
  const file = path.join(directory, `${label}.plist`);
  const stdoutLog = path.join(settings.paths.logs, "service.log");
  const stderrLog = path.join(settings.paths.logs, "service-error.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(settings.commands.node)}</string>
    <string>${xml(path.join(settings.appRoot, "src", "index.mjs"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(settings.appRoot)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(stdoutLog)}</string>
  <key>StandardErrorPath</key><string>${xml(stderrLog)}</string>
</dict></plist>\n`;
  await mkdir(directory, { recursive: true });
  await writeFile(file, plist, { mode: 0o600 });

  const domain = `gui/${process.getuid()}`;
  await run("launchctl", ["bootout", domain, file], { allowFailure: true });
  await run("launchctl", ["bootstrap", domain, file]);
  await run("launchctl", ["enable", `${domain}/${label}`]);
  console.log(`Installed and started ${label}. Logs: ${settings.paths.logs}`);
}

async function installSystemdUserService(settings) {
  const name = `jira-codex-${safeName(path.basename(settings.repository.path))}`;
  const directory = path.join(os.homedir(), ".config", "systemd", "user");
  const file = path.join(directory, `${name}.service`);
  const unit = `[Unit]
Description=Jira to local Codex pull request bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemd(settings.appRoot)}
ExecStart=${systemd(settings.commands.node)} ${systemd(path.join(settings.appRoot, "src", "index.mjs"))}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
  await mkdir(directory, { recursive: true });
  await writeFile(file, unit, { mode: 0o600 });
  await run("systemctl", ["--user", "daemon-reload"]);
  await run("systemctl", ["--user", "enable", "--now", `${name}.service`]);
  console.log(`Installed and started ${name}.service. View logs with: journalctl --user -u ${name} -f`);
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, "") || "repo";
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function systemd(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
