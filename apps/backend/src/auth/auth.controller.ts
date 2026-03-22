import { Body, Controller, Get, Logger, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

type RequestLike = {
  headers: {
    authorization?: string;
    cookie?: string;
    host?: string;
    "x-forwarded-proto"?: string;
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

type ResponseLike = {
  cookie: (name: string, value: string, options: Record<string, unknown>) => void;
};

type LoginBody = {
  passphrase?: string;
};

type ChangePassphraseBody = {
  currentPassphrase?: string;
  newPassphrase?: string;
};

@Controller("auth")
export class AuthController {
  private readonly failedAttemptsByIp = new Map<string, { count: number; blockedUntil: number }>();
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  private shouldUseSecureCookie(request: RequestLike): boolean {
    const explicit = process.env.VIBE_AUTH_COOKIE_SECURE?.trim().toLowerCase();
    if (explicit === "true") {
      return true;
    }

    if (explicit === "false") {
      return false;
    }

    const host = (request.headers.host ?? "").toLowerCase();
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]")) {
      return false;
    }

    const forwardedProto = request.headers["x-forwarded-proto"];
    if (typeof forwardedProto === "string") {
      const primaryProto = forwardedProto.split(",")[0]?.trim().toLowerCase();
      return primaryProto === "https";
    }

    return process.env.NODE_ENV === "production";
  }

  @Get("session")
  session(@Req() request: RequestLike): { authenticated: boolean } {
    return {
      authenticated: this.authService.isAuthenticatedRequest(request),
    };
  }

  @Post("login")
  login(
    @Body() body: LoginBody,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ): { ok: boolean } {
    const now = Date.now();
    const ip = request.ip || request.socket?.remoteAddress || "unknown";
    const existing = this.failedAttemptsByIp.get(ip);
    if (existing && existing.blockedUntil > now) {
      this.logger.warn(`Blocked login attempt from ${ip}; retry available at ${new Date(existing.blockedUntil).toISOString()}`);
      throw new UnauthorizedException("Too many failed attempts. Try again later.");
    }

    const passphrase = body.passphrase ?? "";
    if (!this.authService.verifyPassphrase(passphrase)) {
      const nextCount = (existing?.count ?? 0) + 1;
      const lockoutMs = nextCount >= 5 ? 1000 * 60 * 5 : 0;
      this.failedAttemptsByIp.set(ip, {
        count: nextCount,
        blockedUntil: now + lockoutMs,
      });
      this.logger.warn(`Failed login attempt from ${ip}; count=${nextCount}`);
      throw new UnauthorizedException("Invalid passphrase");
    }

    this.failedAttemptsByIp.delete(ip);
    this.logger.log(`Successful login from ${ip}`);

    const token = this.authService.issueSessionToken();
    const isSecure = this.shouldUseSecureCookie(request);

    response.cookie("vibe_auth", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/",
    });

    return { ok: true };
  }

  @Post("change-passphrase")
  changePassphrase(
    @Body() body: ChangePassphraseBody,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ): { ok: boolean } {
    const ip = request.ip || request.socket?.remoteAddress || "unknown";
    const current = body.currentPassphrase ?? "";
    const next = body.newPassphrase ?? "";

    if (!this.authService.verifyPassphrase(current)) {
      this.logger.warn(`Failed passphrase change attempt from ${ip}: invalid current passphrase`);
      throw new UnauthorizedException("Current passphrase is invalid");
    }

    this.authService.updatePassphrase(next);
    this.logger.log(`Passphrase updated from ${ip}`);

    const token = this.authService.issueSessionToken();
    const isSecure = this.shouldUseSecureCookie(request);
    response.cookie("vibe_auth", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/",
    });

    return { ok: true };
  }

  @Post("logout")
  logout(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ): { ok: boolean } {
    const ip = request.ip || request.socket?.remoteAddress || "unknown";
    const isSecure = this.shouldUseSecureCookie(request);

    response.cookie("vibe_auth", "", {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      expires: new Date(0),
      path: "/",
    });

    this.logger.log(`Logout from ${ip}`);

    return { ok: true };
  }
}
