import { Injectable } from "@nestjs/common";
import {
  AdapterChannelProbeResult,
  AdapterTestResult,
  DeviceAdapter,
} from "./device-adapter.interface";

@Injectable()
export class BluetoothAdapter implements DeviceAdapter {
  readonly type = "bluetooth" as const;

  async discover(): Promise<string[]> {
    const override = process.env.VIBE_BLUETOOTH_TARGETS;
    if (!override) {
      return [];
    }

    return override
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  async test(target: string): Promise<AdapterTestResult> {
    if (!/^BT-[A-Z]+-\d+$/i.test(target)) {
      return {
        ok: false,
        latencyMs: 0,
        message: "Invalid bluetooth target format",
      };
    }

    return {
      ok: false,
      latencyMs: 0,
      message:
        `Bluetooth target format accepted for ${target}, but active probing is not available in backend runtime yet`,
    };
  }

  async probeChannels(target: string): Promise<AdapterChannelProbeResult> {
    return {
      ok: false,
      channels: [],
      message:
        `Bluetooth channel probing is not available in backend runtime yet for ${target}. Use bridge-assisted profile ingest.`,
    };
  }
}
