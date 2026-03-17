import { Injectable } from "@nestjs/common";
import { AdapterTestResult, DeviceAdapter } from "./device-adapter.interface";

@Injectable()
export class BluetoothAdapter implements DeviceAdapter {
  readonly type = "bluetooth" as const;

  async discover(): Promise<string[]> {
    return ["BT-SOIL-01", "BT-LIGHT-02"];
  }

  async test(target: string): Promise<AdapterTestResult> {
    const ok = /^BT-[A-Z]+-\d+$/i.test(target);
    return {
      ok,
      latencyMs: ok ? 42 : 0,
      message: ok ? `Bluetooth pairing simulation succeeded for ${target}` : "Invalid bluetooth target format",
    };
  }
}
