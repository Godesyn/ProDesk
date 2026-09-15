#!/usr/bin/env node
import { execSync } from 'node:child_process';

const portRanges = [
  [4000, 4005],
  [5173, 5190],
];

const targetPorts = new Set();
for (const [start, end] of portRanges) {
  for (let p = start; p <= end; p++) {
    targetPorts.add(p);
  }
}

const excludePids = new Set([
  String(process.pid),
  String(process.ppid),
  '0',
  '4', // Windows System PID
]);

function cleanupPorts() {
  const pidToPorts = new Map();

  if (process.platform === 'win32') {
    try {
      // Execute netstat once for all ports
      const stdout = execSync('netstat -ano', { encoding: 'utf8' });
      const lines = stdout.split('\n');

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;

        const proto = parts[0].toUpperCase();
        const localAddr = parts[1];
        const pid = parts[parts.length - 1];

        if (!pid || excludePids.has(pid)) continue;

        // Parse port from local address (e.g. 0.0.0.0:4000 or [::1]:5173)
        const match = localAddr.match(/:(\d+)$/);
        if (!match) continue;
        const port = parseInt(match[1], 10);

        if (!targetPorts.has(port)) continue;

        // Only kill TCP sockets in LISTENING state, or UDP sockets
        if (proto === 'TCP') {
          const state = parts[parts.length - 2]?.toUpperCase();
          if (state !== 'LISTENING') continue;
        }

        if (!pidToPorts.has(pid)) {
          pidToPorts.set(pid, new Set());
        }
        pidToPorts.get(pid).add(port);
      }
    } catch {
      // netstat failed or returned no output
    }
  } else {
    try {
      // Execute lsof once across all port ranges
      const rangeArgs = portRanges
        .map(([start, end]) => `-i :${start}-${end}`)
        .join(' ');
      const stdout = execSync(`lsof -t ${rangeArgs} -sTCP:LISTEN`, {
        encoding: 'utf8',
      });
      const pids = stdout
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p && !excludePids.has(p));

      for (const pid of pids) {
        if (!pidToPorts.has(pid)) {
          pidToPorts.set(pid, new Set());
        }
        pidToPorts.get(pid).add('target');
      }
    } catch {
      // lsof returns non-zero when no processes match
    }
  }

  for (const [pid, portsSet] of pidToPorts) {
    const portsStr = Array.from(portsSet).join(', ');
    console.log(`Killing process ${pid} listening on port(s) [${portsStr}]...`);
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /f /pid ${pid}`, { stdio: 'ignore' });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      }
    } catch {
      // Ignore if process was already terminated
    }
  }
}

cleanupPorts();

