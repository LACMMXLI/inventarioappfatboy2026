import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { z } from "zod";
import { Db, audit } from "./db";
import { env } from "./config";
import { SessionUser } from "@fatboy/contracts";
export type AuthRequest = Request & { user: SessionUser; sessionId: string };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function branchAccess(user: SessionUser, branchId: string) {
  if (user.role !== "ADMIN" && !user.branchIds.includes(branchId))
    throw new ForbiddenException("No tienes acceso a esta sucursal.");
}
export function permit(user: SessionUser, permission: string) {
  if (user.role !== "ADMIN" && !user.permissions.includes(permission))
    throw new ForbiddenException("No tienes permiso para esta operación.");
}
export function branchFilter(user: SessionUser, branchId?: string) {
  if (branchId) {
    branchAccess(user, branchId);
    return branchId;
  }
  return user.role === "ADMIN" ? undefined : { in: user.branchIds };
}
@Injectable()
export class AuthService {
  constructor(
    private db: Db,
    private jwt: JwtService,
  ) {}
  async user(id: string): Promise<SessionUser> {
    const u = await this.db.user.findUnique({
      where: { id },
      include: { branches: true, role: { include: { permissions: true } } },
    });
    if (!u?.active) throw new UnauthorizedException("Sesión inválida.");
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.roleId as SessionUser["role"],
      branchIds: u.branches.map((b) => b.branchId),
      permissions: u.role.permissions.map((p) => p.permissionId),
    };
  }
  async issue(userId: string, res: Response) {
    const raw = randomBytes(48).toString("hex");
    const session = await this.db.refreshSession.create({
      data: {
        userId,
        tokenHash: hash(raw),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    res.cookie("fatboy_refresh", raw, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: 7 * 86400000,
    });
    return {
      accessToken: await this.jwt.signAsync(
        { sub: userId, sid: session.id },
        { expiresIn: "15m" },
      ),
      user: await this.user(userId),
    };
  }
  async login(body: unknown, res: Response) {
    const b = z
      .object({
        email: z.email().transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(128),
      })
      .parse(body);
    const u = await this.db.user.findUnique({ where: { email: b.email } });
    if (!u?.active || !(await argon2.verify(u.passwordHash, b.password)))
      throw new UnauthorizedException("Correo o contraseña incorrectos.");
    await audit(this.db, u.id, "LOGIN", "user", u.id);
    return this.issue(u.id, res);
  }
  async refresh(req: Request, res: Response) {
    this.origin(req);
    const raw = req.cookies?.fatboy_refresh;
    if (!raw) throw new UnauthorizedException();
    const session = await this.db.atomic(async (tx) => {
      const s = await tx.refreshSession.findUnique({
        where: { tokenHash: hash(raw) },
      });
      if (!s || s.revokedAt || s.expiresAt < new Date())
        throw new UnauthorizedException();
      await tx.refreshSession.update({
        where: { id: s.id },
        data: { revokedAt: new Date() },
      });
      return s;
    });
    await this.user(session.userId);
    return this.issue(session.userId, res);
  }
  origin(req: Request) {
    if (req.headers.origin !== env.APP_ORIGIN)
      throw new ForbiddenException("Origen no permitido.");
  }
  async logout(req: Request, res: Response) {
    this.origin(req);
    if (req.cookies?.fatboy_refresh)
      await this.db.refreshSession.updateMany({
        where: { tokenHash: hash(req.cookies.fatboy_refresh), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    res.clearCookie("fatboy_refresh", {
      path: "/api/v1/auth",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
    });
    return { ok: true };
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private auth: AuthService,
    private jwt: JwtService,
    private db: Db,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    try {
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      if (!token) throw new Error();
      const p = await this.jwt.verifyAsync(token);
      const s = await this.db.refreshSession.findUnique({
        where: { id: p.sid },
      });
      if (!s || s.revokedAt || s.userId !== p.sub || s.expiresAt < new Date())
        throw new Error();
      req.user = await this.auth.user(p.sub);
      req.sessionId = s.id;
      return true;
    } catch {
      throw new UnauthorizedException(
        "Tu sesión ha vencido. Inicia sesión nuevamente.",
      );
    }
  }
}
@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private db: Db,
  ) {}
  @Post("login") @Throttle({ default: { limit: 8, ttl: 60000 } }) login(
    @Body() b: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.auth.login(b, r);
  }
  @Post("refresh") refresh(
    @Req() r: Request,
    @Res({ passthrough: true }) s: Response,
  ) {
    return this.auth.refresh(r, s);
  }
  @Post("logout") logout(
    @Req() r: Request,
    @Res({ passthrough: true }) s: Response,
  ) {
    return this.auth.logout(r, s);
  }
  @Get("me") @UseGuards(AuthGuard) me(@Req() r: AuthRequest) {
    return r.user;
  }
  @Post("password") @UseGuards(AuthGuard) async password(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    const b = z
      .object({
        currentPassword: z.string(),
        password: z.string().min(12).max(128),
      })
      .parse(body);
    const u = await this.db.user.findUniqueOrThrow({
      where: { id: r.user.id },
    });
    if (!(await argon2.verify(u.passwordHash, b.currentPassword)))
      throw new UnauthorizedException("Contraseña actual incorrecta.");
    await this.db.atomic(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: { passwordHash: await argon2.hash(b.password) },
      });
      await tx.refreshSession.updateMany({
        where: { userId: u.id },
        data: { revokedAt: new Date() },
      });
      await audit(tx, u.id, "PASSWORD_CHANGED", "user", u.id);
    });
    return { ok: true };
  }
}
