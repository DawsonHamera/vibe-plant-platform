import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

type AuthRequestLike = {
    headers: {
        authorization?: string;
        cookie?: string;
    };
};

type SessionPayload = {
    exp: number;
    iat: number;
};

@Injectable()
export class AuthService {
  private readonly tokenSecret = process.env.VIBE_AUTH_SECRET?.trim() || "dev-only-auth-secret";
  private passphrase = process.env.VIBE_AUTH_PASSPHRASE?.trim() || "change-me";
  constructor() {
    if (process.env.NODE_ENV === "production") {
      if (!process.env.VIBE_AUTH_SECRET || this.tokenSecret === "dev-only-auth-secret") {
        throw new Error("VIBE_AUTH_SECRET must be set in production");
      }

      if (!process.env.VIBE_AUTH_PASSPHRASE || this.passphrase === "change-me") {
        throw new Error("VIBE_AUTH_PASSPHRASE must be set in production");
      }
    }
  }

  issueSessionToken(now = Date.now()): string {
    const payload: SessionPayload = {
      iat: now,
      exp: now + 1000 * 60 * 60 * 24 * 7,
    };

    const encodedPayload = this.toBase64Url(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  verifySessionToken(token: string | null | undefined): SessionPayload | null {
    if (!token || token.trim().length === 0) {
      return null;
    }

    const [encodedPayload, signature] = token.trim().split(".");
    if (!encodedPayload || !signature) {
      return null;
    }

    const expected = this.sign(encodedPayload);
    if (!this.secureEquals(signature, expected)) {
      return null;
    }

    try {
      const payloadText = this.fromBase64Url(encodedPayload);
      const payload = JSON.parse(payloadText) as SessionPayload;
      if (!payload.exp || Number.isNaN(payload.exp) || payload.exp <= Date.now()) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  verifyPassphrase(passphrase: string): boolean {
    if (typeof passphrase !== "string" || passphrase.trim().length === 0) {
      return false;
    }

    return this.secureEquals(passphrase.trim(), this.passphrase);
  }

  updatePassphrase(nextPassphrase: string): void {
    const normalized = nextPassphrase.trim();
    if (normalized.length < 12) {
      throw new UnauthorizedException("New passphrase must be at least 12 characters.");
    }

    this.passphrase = normalized;
  }

  assertAuthenticatedRequest(request: AuthRequestLike): void {
    if (!this.isAuthenticatedRequest(request)) {
      throw new UnauthorizedException("Authentication required");
    }
  }

  isAuthenticatedRequest(request: AuthRequestLike): boolean {
    const bearer = this.extractBearerToken(request);
    if (this.verifySessionToken(bearer)) {
      return true;
    }

    const cookieToken = this.extractCookieToken(request, "vibe_auth");
    return this.verifySessionToken(cookieToken) !== null;
  }

  private sign(value: string): string {
    return this.toBase64Url(createHmac("sha256", this.tokenSecret).update(value).digest());
  }

  private extractBearerToken(request: AuthRequestLike): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return null;
    }

    const token = authHeader.slice(7).trim();
    return token.length > 0 ? token : null;
  }

  private extractCookieToken(request: AuthRequestLike, cookieName: string): string | null {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return null;
    }

    const parts = cookieHeader.split(";").map((part: string) => part.trim());
    const prefixed = `${ cookieName }=`;
    const match = parts.find((part: string) => part.startsWith(prefixed));
    if (!match) {
      return null;
    }

    const value = match.slice(prefixed.length).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }

  private secureEquals(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");

    if (aBuf.length !== bBuf.length) {
      return false;
    }

    return timingSafeEqual(aBuf, bBuf);
  }

  private toBase64Url(value: string | Buffer): string {
    return Buffer.from(value)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  private fromBase64Url(value: string): string {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    return Buffer.from(`${normalized}${"=".repeat(padLength)}`, "base64").toString("utf8");
  }
}
