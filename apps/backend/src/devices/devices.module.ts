import { Module } from "@nestjs/common";
import { PlantsModule } from "../plants/plants.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { BluetoothAdapter } from "./adapters/bluetooth.adapter";
import { DeviceAdapterRegistry } from "./adapters/device-adapter.registry";
import { NetworkAdapter } from "./adapters/network.adapter";
import { SerialAdapter } from "./adapters/serial.adapter";
import { DevicesController } from "./devices.controller";
import { DevicesRuntimeService } from "./devices-runtime.service";
import { DevicesService } from "./devices.service";

@Module({
  imports: [PlantsModule, TelemetryModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    SerialAdapter,
    NetworkAdapter,
    BluetoothAdapter,
    DeviceAdapterRegistry,
    DevicesRuntimeService,
  ],
})
export class DevicesModule {}
