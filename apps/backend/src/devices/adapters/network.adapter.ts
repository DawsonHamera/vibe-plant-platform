import { Injectable } from "@nestjs/common";
import { Socket, connect } from "node:net";
import { AdapterTestResult, DeviceAdapter } from "./device-adapter.interface";

@Injectable()
export class NetworkAdapter implements DeviceAdapter {
  readonly type = "network" as const;

  async discover(): Promise<string[]> {
    return ["192.168.1.25:4000", "192.168.1.41:4000"];
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
}
