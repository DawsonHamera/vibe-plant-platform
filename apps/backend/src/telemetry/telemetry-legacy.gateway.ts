import { Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server } from "socket.io";
import type { TelemetryPoint } from "@vibe/shared";
import { getRuntimeConfig } from "../config/runtime-config";

@WebSocketGateway({
  path: "/socket.io",
  cors: {
    origin: getRuntimeConfig().corsOrigins,
  },
})
export class TelemetryLegacyGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TelemetryLegacyGateway.name);

  handleConnection(): void {
    this.logger.log("Telemetry client connected (legacy path)");
  }

  publishTelemetry(point: TelemetryPoint): void {
    this.server.emit("telemetry:update", point);
  }
}
