import { Injectable } from "@nestjs/common";
import { exec } from "node:child_process";
import { readdir, readlink } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import {
  AdapterChannelProbeResult,
  AdapterTestResult,
  DeviceAdapter,
} from "./device-adapter.interface";

@Injectable()
export class SerialAdapter implements DeviceAdapter {
  readonly type = "serial" as const;

  private static readonly windowsTargetPattern = /^COM\d+$/i;
  private static readonly unixTargetPattern =
    /^\/dev\/(?:tty(?:USB|ACM|AMA|S|THS|XRUSB|GS)\d+|rfcomm\d+|cu\.[A-Za-z0-9._-]+|serial\/by-(?:id|path)\/[A-Za-z0-9._:+-]+)$/;

  async discover(): Promise<string[]> {
    const override = process.env.VIBE_SERIAL_PORTS;
    if (override) {
      return override
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    }

    if (process.platform === "linux" || process.platform === "darwin") {
      return this.discoverFromUnixDevices();
    }

    if (process.platform !== "win32") {
      return [];
    }

    const registryPorts = await this.discoverFromRegistry();
    if (registryPorts.length > 0) {
      return registryPorts;
    }

    const command =
      'powershell.exe -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() -join \",\""';

    return new Promise<string[]>((resolve) => {
      exec(command, { timeout: 5000 }, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        resolve(this.normalizeWindowsPorts(stdout));
      });
    });
  }

  private async discoverFromUnixDevices(): Promise<string[]> {
    const [rootDevices, byIdDevices, byPathDevices] = await Promise.all([
      this.listUnixSerialEntries("/dev", /^(tty(?:USB|ACM|AMA|S|THS|XRUSB|GS)\d+|rfcomm\d+|cu\.[A-Za-z0-9._-]+)$/),
      this.listUnixSerialEntries("/dev/serial/by-id", /^[^/]+$/),
      this.listUnixSerialEntries("/dev/serial/by-path", /^[^/]+$/),
    ]);

    const normalized = [...rootDevices, ...byIdDevices, ...byPathDevices]
      .filter((value) => this.isValidTargetFormat(value))
      .sort((a, b) => a.localeCompare(b));

    return Array.from(new Set(normalized));
  }

  private async listUnixSerialEntries(directory: string, matcher: RegExp): Promise<string[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => (entry.isCharacterDevice?.() ?? false) || entry.isSymbolicLink())
        .filter((entry) => matcher.test(entry.name))
        .map((entry) => `${directory}/${entry.name}`);
    } catch {
      return [];
    }
  }

  private discoverFromRegistry(): Promise<string[]> {
    const command =
      'cmd.exe /d /s /c "reg query HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM"';

    return new Promise<string[]>((resolve) => {
      exec(command, { timeout: 2000 }, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        const ports = (stdout.match(/COM\d+/gi) ?? []).join(",");
        resolve(this.normalizeWindowsPorts(ports));
      });
    });
  }

  private normalizeWindowsPorts(raw: string): string[] {
    const ports = raw
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => SerialAdapter.windowsTargetPattern.test(value))
      .map((value) => value.toUpperCase())
      .sort((a, b) => {
        const aNum = Number(a.replace(/\D/g, ""));
        const bNum = Number(b.replace(/\D/g, ""));
        return aNum - bNum;
      });

    return Array.from(new Set(ports));
  }

  async test(target: string): Promise<AdapterTestResult> {
    const normalizedTarget = target.trim();
    if (!this.isValidTargetFormat(normalizedTarget)) {
      return {
        ok: false,
        latencyMs: 0,
        message: "Invalid serial target format",
      };
    }

    // Resolve symlinks to actual device file
    const resolvedTarget = await this.resolveUnixSerialTarget(normalizedTarget, "test");

    if (process.platform === "win32") {
      return this.testOnWindows(normalizedTarget);
    }

    if (process.platform === "linux" || process.platform === "darwin") {
      return this.testOnUnix(resolvedTarget);
    }

    return {
      ok: false,
      latencyMs: 0,
      message: `Serial probing is not implemented for platform ${process.platform}`,
    };
  }

  private testOnWindows(target: string): Promise<AdapterTestResult> {
    const startedAt = Date.now();
    return new Promise<AdapterTestResult>((resolve) => {
      exec(`mode ${target}`, { timeout: 1200 }, (error) => {
        if (error) {
          resolve({
            ok: false,
            latencyMs: 0,
            message: `Serial probe failed for ${target}`,
          });
          return;
        }

        resolve({
          ok: true,
          latencyMs: Date.now() - startedAt,
          message: `Serial handshake succeeded on ${target}`,
        });
      });
    });
  }

  private testOnUnix(target: string): Promise<AdapterTestResult> {
    const sttyFlag = process.platform === "darwin" ? "-f" : "-F";
    const escapedTarget = this.escapePosixArg(target);
    const command = `sh -lc "stty ${sttyFlag} ${escapedTarget} 9600 -echo >/dev/null 2>&1"`;
    const startedAt = Date.now();

    return new Promise<AdapterTestResult>((resolve) => {
      exec(command, { timeout: 1500 }, (error) => {
        if (error) {
          resolve({
            ok: false,
            latencyMs: 0,
            message: `Serial probe failed for ${target}. Ensure the device path exists and user has serial permissions.`,
          });
          return;
        }

        resolve({
          ok: true,
          latencyMs: Date.now() - startedAt,
          message: `Serial handshake succeeded on ${target}`,
        });
      });
    });
  }

  async probeChannels(target: string): Promise<AdapterChannelProbeResult> {
    const normalizedTarget = target.trim();
    if (!this.isValidTargetFormat(normalizedTarget)) {
      return {
        ok: false,
        channels: [],
        message: "Invalid serial target format",
      };
    }

    // Resolve symlinks to actual device file
    const resolvedTarget = await this.resolveUnixSerialTarget(normalizedTarget, "probe");

    if (process.platform === "win32") {
      return this.probeChannelsOnWindows(normalizedTarget);
    }

    if (process.platform === "linux" || process.platform === "darwin") {
      return this.probeChannelsOnUnix(resolvedTarget);
    }

    return {
      ok: false,
      channels: [],
      message: `Serial channel probing is not implemented for platform ${process.platform}`,
    };
  }

  private probeChannelsOnWindows(target: string): Promise<AdapterChannelProbeResult> {
    const script = [
      `$port = New-Object System.IO.Ports.SerialPort '${target}',9600,'None',8,'one'`,
      "$port.ReadTimeout = 1500",
      "$port.NewLine = \"`n\"",
      "$port.Open()",
      "Start-Sleep -Milliseconds 900",
      "$raw = $port.ReadExisting()",
      "if ([string]::IsNullOrWhiteSpace($raw)) { try { $raw = $port.ReadLine() } catch {} }",
      "$port.Close()",
      "Write-Output $raw",
    ].join("; ");

    const command = `powershell.exe -NoProfile -Command "${script.replace(/"/g, '\\"')}"`;

    return this.runChannelProbe(command, target);
  }

  private async probeChannelsOnUnix(target: string): Promise<AdapterChannelProbeResult> {
    const sttyFlag = process.platform === "darwin" ? "-f" : "-F";
    const escapedTarget = this.escapePosixArg(target);
    const fastCommand =
      `sh -lc "stty ${sttyFlag} ${escapedTarget} 9600 -echo -icanon min 1 time 3 >/dev/null 2>&1; ` +
      `cat ${escapedTarget} | head -n 1"`;

    console.log(`[SERIAL DEBUG] probeChannelsOnUnix fast command: ${fastCommand}`);
    const fastResult = await this.runChannelProbe(fastCommand, target, 2500);
    if (fastResult.ok) {
      return fastResult;
    }

    const fallbackCommand =
      `sh -lc "stty ${sttyFlag} ${escapedTarget} 9600 -echo -icanon min 1 time 20 >/dev/null 2>&1; ` +
      `cat ${escapedTarget} | head -n 5"`;

    console.log(`[SERIAL DEBUG] probeChannelsOnUnix fallback command: ${fallbackCommand}`);
    return this.runChannelProbe(fallbackCommand, target, 9000);
  }

  private runChannelProbe(
    command: string,
    target: string,
    timeoutMs = 9000,
  ): Promise<AdapterChannelProbeResult> {
    return new Promise<AdapterChannelProbeResult>((resolve) => {
      exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
        const sample = stdout.trim();

        if (error) {
          console.log(`[SERIAL DEBUG] probeChannels error for ${target}: ${stderr || error.message}`);
          console.log(`[SERIAL DEBUG] probeChannels error had sample length: ${sample.length}`);

          // Some shells return non-zero (or hit timeout) even when serial data has already been read.
          // If we captured payload, continue and try to parse it.
          if (sample.length === 0) {
            resolve({
              ok: false,
              channels: [],
              message: `Unable to read serial payload from ${target}: ${stderr || error.message}`,
            });
            return;
          }
        }

        console.log(`[SERIAL DEBUG] Raw output length: ${sample.length}, content raw:`, JSON.stringify(sample.substring(0, 200)));
        const channels = this.extractChannels(sample);
        if (channels.length === 0) {
          resolve({
            ok: false,
            channels: [],
            message:
              `Connected to ${target} but no JSON channel payload was detected. Ensure device streams JSON lines.`,
            sample: sample.length > 0 ? sample : undefined,
          });
          return;
        }

        resolve({
          ok: true,
          channels,
          message: `Detected ${channels.length} channel(s) from live payload on ${target}`,
          sample,
        });
      });
    });
  }

  private isValidTargetFormat(target: string): boolean {
    if (SerialAdapter.windowsTargetPattern.test(target)) {
      return true;
    }

    if (target.includes("..")) {
      return false;
    }

    return SerialAdapter.unixTargetPattern.test(target);
  }

  private async resolveUnixSerialTarget(target: string, context: "test" | "probe"): Promise<string> {
    if (!target.includes("/dev/serial/by-")) {
      return target;
    }

    try {
      const linkTarget = await readlink(target);
      const resolvedTarget = linkTarget.startsWith("/")
        ? resolvePath(linkTarget)
        : resolvePath(dirname(target), linkTarget);

      console.log(`[SERIAL DEBUG] ${context}: Resolved symlink ${target} -> ${resolvedTarget}`);
      return resolvedTarget;
    } catch (e) {
      console.log(`[SERIAL DEBUG] ${context}: Failed to resolve symlink: ${(e as Error).message}`);
      return target;
    }
  }

  private escapePosixArg(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  private extractChannels(raw: string): string[] {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    console.log(`[SERIAL DEBUG] extractChannels: ${lines.length} non-empty lines`);

    for (const line of lines) {
      console.log(`[SERIAL DEBUG] Attempting to parse line: ${JSON.stringify(line.substring(0, 100))}`);
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        console.log(`[SERIAL DEBUG] Parsed successfully, checking for channels...`);
        if (parsed.channels && typeof parsed.channels === "object" && !Array.isArray(parsed.channels)) {
          const channelKeys = Object.keys(parsed.channels as Record<string, unknown>);
          console.log(`[SERIAL DEBUG] Found channels field with keys:`, channelKeys);
          return channelKeys;
        }

        const topLevelChannels = Object.entries(parsed)
          .filter(([, value]) => typeof value === "number")
          .map(([key]) => key);
        if (topLevelChannels.length > 0) {
          console.log(`[SERIAL DEBUG] Found top-level numeric fields:`, topLevelChannels);
          return topLevelChannels;
        }
      } catch (e) {
        console.log(`[SERIAL DEBUG] JSON parse failed: ${(e as Error).message}`);
        // Continue scanning lines for valid JSON payload.
      }
    }

    console.log(`[SERIAL DEBUG] No valid JSON found in any line`);
    return [];
  }
}
