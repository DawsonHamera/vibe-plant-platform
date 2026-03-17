import { Injectable } from "@nestjs/common";
import { BluetoothAdapter } from "./bluetooth.adapter";
import { ConnectionType, DeviceAdapter } from "./device-adapter.interface";
import { NetworkAdapter } from "./network.adapter";
import { SerialAdapter } from "./serial.adapter";

@Injectable()
export class DeviceAdapterRegistry {
  private readonly adapters = new Map<ConnectionType, DeviceAdapter>();

  constructor(
    serialAdapter?: SerialAdapter,
    networkAdapter?: NetworkAdapter,
    bluetoothAdapter?: BluetoothAdapter,
  ) {
    const serial = serialAdapter ?? new SerialAdapter();
    const network = networkAdapter ?? new NetworkAdapter();
    const bluetooth = bluetoothAdapter ?? new BluetoothAdapter();

    this.adapters.set(serial.type, serial);
    this.adapters.set(network.type, network);
    this.adapters.set(bluetooth.type, bluetooth);
  }

  get(type: ConnectionType): DeviceAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter configured for ${type}`);
    }

    return adapter;
  }

  entries(): Array<[ConnectionType, DeviceAdapter]> {
    return Array.from(this.adapters.entries());
  }
}
