import { Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from "@nestjs/websockets";
import type { Server } from "socket.io";
import type { Socket } from "socket.io";
import type { TelemetryPoint } from "@vibe/shared";
import { AuthService } from "../auth/auth.service";
import { getRuntimeConfig } from "../config/runtime-config";

@WebSocketGateway({
  path: "/ws/telemetry",
  maxHttpBufferSize: 1e6,
  cors: {
    origin: getRuntimeConfig().corsOrigins,
    credentials: true,
  },
})
export class TelemetryGateway implements OnGatewayConnection {
  constructor(private readonly authService: AuthService) {}

  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TelemetryGateway.name);

  handleConnection(client: Socket): void {
    const request = client.request;
    if (!this.authService.isAuthenticatedRequest(request)) {
      this.logger.warn("Rejected telemetry websocket connection: unauthenticated");
      client.disconnect(true);
      return;
    }

    this.logger.log("Telemetry client connected");
  }

  publishTelemetry(point: TelemetryPoint): void {
    this.server.emit("telemetry:update", point);
  }
}
