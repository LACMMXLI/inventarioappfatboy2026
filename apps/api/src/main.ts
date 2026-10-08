import "reflect-metadata";
import {
  Module,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  Logger,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { tap } from "rxjs";
import { Db } from "./db";
import { env } from "./config";
import { AuthController, AuthGuard, AuthService } from "./auth";
import { AdminController } from "./admin";
import { InventoryController, InventoryService } from "./inventory";
import { CountsController, CountsService } from "./counts";
import { TransfersController, TransfersService } from "./transfers";
import { SchedulerService, SchedulesController } from "./scheduler";
import { ReportsController, ReportsService } from "./reports";
import { LocalPhotoStore, PhotosController } from "./storage";
import { enrichOpenApi } from "./openapi";
import { Controller, Get } from "@nestjs/common";
@Controller("health")
class HealthController {
  constructor(private db: Db) {}
  @Get() async get() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok", time: new Date().toISOString() };
  }
}
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp(),
      res = ctx.getResponse(),
      req = ctx.getRequest();
    let status = 500,
      message = "Error interno. Intenta nuevamente.";
    if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.message;
    } else if (error instanceof z.ZodError) {
      status = 400;
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        status = 409;
        message = "El registro ya existe.";
      } else if (error.code === "P2025") {
        status = 404;
        message = "Registro no encontrado.";
      } else if (error.code === "P2003") {
        status = 400;
        message = "Referencia inválida.";
      } else if (error.code === "P2034") {
        status = 409;
        message = "Otra operación modificó estos datos. Intenta nuevamente.";
      }
    }
    if (status === 500)
      Logger.error(error instanceof Error ? error.stack : String(error));
    res
      .status(status)
      .json({ statusCode: status, message, requestId: req.requestId });
  }
}
@Injectable()
class RequestLog implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const r = ctx.switchToHttp().getRequest();
    r.requestId = randomUUID();
    ctx.switchToHttp().getResponse().setHeader("X-Request-Id", r.requestId);
    const start = Date.now();
    return next.handle().pipe(
      tap(() =>
        Logger.log(
          JSON.stringify({
            requestId: r.requestId,
            method: r.method,
            path: r.path,
            ms: Date.now() - start,
          }),
        ),
      ),
    );
  }
}
@Module({
  imports: [
    JwtModule.register({ global: true, secret: env.JWT_SECRET }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 180 }]),
  ],
  controllers: [
    HealthController,
    AuthController,
    AdminController,
    InventoryController,
    CountsController,
    TransfersController,
    SchedulesController,
    ReportsController,
    PhotosController,
  ],
  providers: [
    Db,
    AuthService,
    AuthGuard,
    InventoryService,
    CountsService,
    TransfersService,
    SchedulerService,
    ReportsService,
    LocalPhotoStore,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
export async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    logger: env.NODE_ENV === "test" ? false : ["log", "warn", "error"],
  });
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.APP_ORIGIN, credentials: true });
  app.useGlobalFilters(new Errors());
  app.useGlobalInterceptors(new RequestLog());
  app.enableShutdownHooks();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Fatboy Inventarios")
      .setDescription(
        "API operativa. Importes y cantidades son cadenas decimales. Mutaciones contables requieren Idempotency-Key.",
      )
      .setVersion("1.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("api/docs", app, enrichOpenApi(doc));
  await app.listen(env.PORT, "0.0.0.0");
  return app;
}
if (require.main === module) bootstrap();
