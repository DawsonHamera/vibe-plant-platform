import { Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from "@nestjs/websockets";
import type { Server } from "socket.io";
import type { TelemetryPoint } from "@vibe/shared";
import { getRuntimeConfig } from "../config/runtime-config";

@WebSocketGateway({
  path: "/ws/telemetry",
  cors: {
    origin: getRuntimeConfig().corsOrigins,
  },
})
export class TelemetryGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TelemetryGateway.name);

  handleConnection(): void {
    this.logger.log("Telemetry client connected");
  }

  publishTelemetry(point: TelemetryPoint): void {
    this.server.emit("telemetry:update", point);
  }
}
