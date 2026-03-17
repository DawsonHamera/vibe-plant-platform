import { describe, expect, it } from "vitest";
import { BluetoothAdapter } from "./bluetooth.adapter";
import { NetworkAdapter } from "./network.adapter";
import { SerialAdapter } from "./serial.adapter";

describe("Device adapters", () => {
  it("validates serial targets", async () => {
    const adapter = new SerialAdapter();
    const validTargetResult = await adapter.test("COM3");
    expect(validTargetResult.message.length).toBeGreaterThan(0);
    expect(typeof validTargetResult.ok).toBe("boolean");

    await expect(adapter.test("tty0")).resolves.toMatchObject({ ok: false });
  });

  it("validates network target format and probe response", async () => {
    const adapter = new NetworkAdapter();
    const probe = await adapter.test("192.168.1.10:4000");
    expect(probe.message.length).toBeGreaterThan(0);
    expect(typeof probe.ok).toBe("boolean");

    await expect(adapter.test("bad-target")).resolves.toMatchObject({ ok: false });
  });

  it("validates bluetooth targets", async () => {
    const adapter = new BluetoothAdapter();
    await expect(adapter.test("BT-SOIL-01")).resolves.toMatchObject({ ok: true });
    await expect(adapter.test("SENSOR-1")).resolves.toMatchObject({ ok: false });
  });
});
