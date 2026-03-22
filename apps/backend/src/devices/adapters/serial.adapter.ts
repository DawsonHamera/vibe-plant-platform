import { Injectable } from "@nestjs/common";
import { exec } from "node:child_process";
import {
  AdapterChannelProbeResult,
  AdapterTestResult,
  DeviceAdapter,
} from "./device-adapter.interface";

@Injectable()
export class SerialAdapter implements DeviceAdapter {
  readonly type = "serial" as const;

  async discover(): Promise<string[]> {
    const override = process.env.VIBE_SERIAL_PORTS;
    if (override) {
      return override
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
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

        resolve(this.normalizePorts(stdout));
      });
    });
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
        resolve(this.normalizePorts(ports));
      });
    });
  }

  private normalizePorts(raw: string): string[] {
    const ports = raw
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => /^COM\d+$/i.test(value))
      .map((value) => value.toUpperCase())
      .sort((a, b) => {
        const aNum = Number(a.replace(/\D/g, ""));
        const bNum = Number(b.replace(/\D/g, ""));
        return aNum - bNum;
      });

    return Array.from(new Set(ports));
  }

  async test(target: string): Promise<AdapterTestResult> {
    if (!/^COM\d+$/i.test(target)) {
      return {
        ok: false,
        latencyMs: 0,
        message: "Invalid serial target format",
      };
    }

    if (process.platform !== "win32") {
      return {
        ok: false,
        latencyMs: 0,
        message: "Serial probing is currently supported on Windows hosts only",
      };
    }

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

  async probeChannels(target: string): Promise<AdapterChannelProbeResult> {
    if (!/^COM\d+$/i.test(target)) {
      return {
        ok: false,
        channels: [],
        message: "Invalid serial target format",
      };
    }

    if (process.platform !== "win32") {
      return {
        ok: false,
        channels: [],
        message: "Serial channel probing is currently supported on Windows hosts only",
      };
    }

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

    const command = `powershell.exe -NoProfile -Command \"${script.replace(/\"/g, '\\\"')}\"`;

    return new Promise<AdapterChannelProbeResult>((resolve) => {
      exec(command, { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            channels: [],
            message: `Unable to read serial payload from ${target}: ${stderr || error.message}`,
          });
          return;
        }

        const sample = stdout.trim();
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

  private extractChannels(raw: string): string[] {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.channels && typeof parsed.channels === "object" && !Array.isArray(parsed.channels)) {
          return Object.keys(parsed.channels as Record<string, unknown>);
        }

        const topLevelChannels = Object.entries(parsed)
          .filter(([, value]) => typeof value === "number")
          .map(([key]) => key);
        if (topLevelChannels.length > 0) {
          return topLevelChannels;
        }
      } catch {
        // Continue scanning lines for valid JSON payload.
      }
    }

    return [];
  }
}
