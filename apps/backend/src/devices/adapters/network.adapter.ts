import { Injectable } from "@nestjs/common";
import { Socket, connect } from "node:net";
import {
  AdapterChannelProbeResult,
  AdapterTestResult,
  DeviceAdapter,
} from "./device-adapter.interface";

@Injectable()
export class NetworkAdapter implements DeviceAdapter {
  readonly type = "network" as const;

  async discover(): Promise<string[]> {
    return [];
  }

  async test(target: string): Promise<AdapterTestResult> {
    if (!/^\d+\.\d+\.\d+\.\d+:\d+$/.test(target)) {
      return {
        ok: false,
        latencyMs: 0,
        message: "Invalid network target format",
      };
    }

    const [host, portRaw] = target.split(":");
    const port = Number(portRaw);
    if (!host || Number.isNaN(port)) {
      return {
        ok: false,
        latencyMs: 0,
        message: "Invalid network target values",
      };
    }

    const startedAt = Date.now();
    return new Promise<AdapterTestResult>((resolve) => {
      const socket: Socket = connect({ host, port });
      let settled = false;

      const finish = (result: AdapterTestResult): void => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve(result);
        }
      };

      socket.setTimeout(1200);
      socket.once("connect", () => {
        finish({
          ok: true,
          latencyMs: Date.now() - startedAt,
          message: `Network probe succeeded for ${target}`,
        });
      });
      socket.once("timeout", () => {
        finish({
          ok: false,
          latencyMs: 0,
          message: `Network probe timeout for ${target}`,
        });
      });
      socket.once("error", (error) => {
        finish({
          ok: false,
          latencyMs: 0,
          message: `Network probe failed: ${error.message}`,
        });
      });
    });
  }

  async probeChannels(target: string): Promise<AdapterChannelProbeResult> {
    if (!/^\d+\.\d+\.\d+\.\d+:\d+$/.test(target)) {
      return {
        ok: false,
        channels: [],
        message: "Invalid network target format",
      };
    }

    const [host, portRaw] = target.split(":");
    const port = Number(portRaw);
    if (!host || Number.isNaN(port)) {
      return {
        ok: false,
        channels: [],
        message: "Invalid network target values",
      };
    }

    return new Promise<AdapterChannelProbeResult>((resolve) => {
      const socket: Socket = connect({ host, port });
      let settled = false;
      let buffer = "";

      const finish = (result: AdapterChannelProbeResult): void => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve(result);
        }
      };

      socket.setTimeout(2500);
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (buffer.includes("\n") || buffer.length >= 2048) {
          const sample = buffer.trim();
          const channels = this.extractChannels(sample);
          finish(
            channels.length > 0
              ? {
                  ok: true,
                  channels,
                  message: `Detected ${channels.length} channel(s) from ${target}`,
                  sample,
                }
              : {
                  ok: false,
                  channels: [],
                  message:
                    `Connected to ${target} but did not receive JSON channel payload. Ensure device streams JSON lines.`,
                  sample: sample.length > 0 ? sample : undefined,
                },
          );
        }
      });
      socket.once("timeout", () => {
        finish({
          ok: false,
          channels: [],
          message: `Network channel probe timeout for ${target}`,
        });
      });
      socket.once("error", (error) => {
        finish({
          ok: false,
          channels: [],
          message: `Network channel probe failed: ${error.message}`,
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
        // Continue scanning lines for valid JSON.
      }
    }

    return [];
  }
}
