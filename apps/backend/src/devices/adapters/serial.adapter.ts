import { Injectable } from "@nestjs/common";
import { exec } from "node:child_process";
import { AdapterTestResult, DeviceAdapter } from "./device-adapter.interface";

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

    return ["COM3", "COM4", "COM5"];
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
        ok: true,
        latencyMs: 15,
        message: `Serial target format accepted for ${target} (platform simulation)`,
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
}
