import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AuthGuard, AuthRequest, permit } from "./auth";
import { audit, Db } from "./db";
import { env } from "./config";
import { id } from "./validation";
export interface PhotoStore {
  put(bytes: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
}
@Injectable()
export class LocalPhotoStore implements PhotoStore {
  async put(bytes: Buffer) {
    await mkdir(env.UPLOAD_DIR, { recursive: true });
    const key = randomUUID();
    await writeFile(join(env.UPLOAD_DIR, key), bytes, { flag: "wx" });
    return key;
  }
  async get(key: string) {
    id.parse(key);
    return readFile(join(env.UPLOAD_DIR, key));
  }
}
export function imageMime(b: Buffer) {
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  if (
    b.length > 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new BadRequestException("Solo imágenes PNG, JPEG o WebP válidas.");
}
@Controller("catalog/products")
@UseGuards(AuthGuard)
export class PhotosController {
  constructor(
    private db: Db,
    private store: LocalPhotoStore,
  ) {}
  @Post(":id/photo")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @Req() r: AuthRequest,
    @Param("id") productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    permit(r.user, "catalog.manage");
    id.parse(productId);
    if (!file)
      throw new BadRequestException("Selecciona una imagen de hasta 2 MB.");
    imageMime(file.buffer);
    await this.db.product.findUniqueOrThrow({ where: { id: productId } });
    const photo = await this.store.put(file.buffer);
    return this.db.atomic(async (tx) => {
      const p = await tx.product.update({
        where: { id: productId },
        data: { photo },
      });
      await audit(
        tx,
        r.user.id,
        "PHOTO",
        "product",
        p.id,
        undefined,
        undefined,
        { photo },
      );
      return { photo };
    });
  }
  @Get(":id/photo") async get(
    @Req() r: AuthRequest,
    @Param("id") productId: string,
  ) {
    id.parse(productId);
    const p = await this.db.product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        branches: true,
        countItems: {
          where: {
            count: {
              assigneeId: r.user.id,
              branchId: { in: r.user.branchIds },
            },
          },
          take: 1,
        },
      },
    });
    if (
      r.user.role === "EMPLOYEE"
        ? !p.countItems.length
        : r.user.role !== "ADMIN" &&
          !p.branches.some((b) => r.user.branchIds.includes(b.branchId))
    )
      throw new ForbiddenException();
    if (!p.photo) return { url: null };
    const b = await this.store.get(p.photo);
    return { url: `data:${imageMime(b)};base64,${b.toString("base64")}` };
  }
}
