import { Module } from "@nestjs/common";
import { BluetoothAdapter } from "./adapters/bluetooth.adapter";
import { DeviceAdapterRegistry } from "./adapters/device-adapter.registry";
import { NetworkAdapter } from "./adapters/network.adapter";
import { SerialAdapter } from "./adapters/serial.adapter";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  controllers: [DevicesController],
  providers: [
    DevicesService,
    SerialAdapter,
    NetworkAdapter,
    BluetoothAdapter,
    DeviceAdapterRegistry,
  ],
})
export class DevicesModule {}
