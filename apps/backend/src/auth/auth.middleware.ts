import { Injectable, Logger, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

type RequestLike = {
  headers: {
    authorization?: string;
    cookie?: string;
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
  method?: string;
  originalUrl?: string;
};

type NextFunctionLike = () => void;

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(private readonly authService: AuthService) {}

  use(request: RequestLike, _response: unknown, next: NextFunctionLike): void {
    try {
      this.authService.assertAuthenticatedRequest(request);
    } catch (error) {
      const ip = request.ip || request.socket?.remoteAddress || "unknown";
      const method = request.method || "UNKNOWN";
      const url = request.originalUrl || "(unknown-url)";
      this.logger.warn(`Blocked unauthenticated request from ${ip}: ${method} ${url}`);
      throw error instanceof UnauthorizedException
        ? error
        : new UnauthorizedException("Authentication required");
    }

    next();
  }
}
