import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';

/** Optional folder reference on a routine payload. */
export interface FolderRef {
  folderId?: string | null;
  folderName?: string | null;
}

export interface FolderView {
  id: string;
  name: string;
}

/**
 * Routine folders for the AI connector. Folders are the app's RoutineFolder
 * rows: soft-deleted, referenced loosely from WorkoutTemplate.folderId, and
 * synced to the phone via updatedAt cursors — every write here bumps
 * updatedAt so the change reaches the app on its next pull.
 */
@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const folders = await this.prisma.routineFolder.findMany({
      where: { userId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    const counts = await this.prisma.workoutTemplate.groupBy({
      by: ['folderId'],
      where: { userId, deletedAt: null, folderId: { not: null } },
      _count: { _all: true },
    });
    const countByFolder = new Map(
      counts.map((c) => [c.folderId, c._count._all]),
    );

    return {
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        routineCount: countByFolder.get(f.id) ?? 0,
        updatedAt: f.updatedAt.toISOString(),
      })),
    };
  }

  /** Find a folder by name (case-insensitive) or create it. */
  async createOrGet(userId: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('Folder name must not be empty');
    }

    const existing = await this.prisma.routineFolder.findFirst({
      where: {
        userId,
        deletedAt: null,
        name: { equals: trimmed, mode: 'insensitive' },
      },
    });
    if (existing) {
      return { folder: this.view(existing), created: false };
    }

    const maxSort = await this.prisma.routineFolder.aggregate({
      where: { userId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const folder = await this.prisma.routineFolder.create({
      data: {
        id: uuidv4(),
        userId,
        name: trimmed,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });
    return { folder: this.view(folder), created: true };
  }

  async rename(userId: string, folderId: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('Folder name must not be empty');
    }
    await this.requireFolder(userId, folderId);
    const folder = await this.prisma.routineFolder.update({
      where: { id: folderId },
      data: { name: trimmed, updatedAt: new Date() },
    });
    return { folder: this.view(folder) };
  }

  /** Soft-delete a folder. Routines inside move back to the root list — never deleted. */
  async remove(userId: string, folderId: string) {
    await this.requireFolder(userId, folderId);
    const { count } = await this.prisma.workoutTemplate.updateMany({
      where: { userId, folderId, deletedAt: null },
      data: { folderId: null, updatedAt: new Date() },
    });
    await this.prisma.routineFolder.update({
      where: { id: folderId },
      data: { deletedAt: new Date(), updatedAt: new Date() },
    });
    return { deleted: true, routinesMovedToRoot: count };
  }

  /**
   * Resolve an optional folder reference from a routine payload.
   * undefined = leave unchanged, null = remove from folder, string = folder id.
   * folderName resolves case-insensitively and creates the folder when missing.
   */
  async resolveRef(
    userId: string,
    ref: FolderRef,
  ): Promise<string | null | undefined> {
    if (ref.folderId === null || ref.folderName === null) return null;
    if (typeof ref.folderId === 'string' && ref.folderId) {
      const folder = await this.requireFolder(userId, ref.folderId);
      return folder.id;
    }
    if (typeof ref.folderName === 'string') {
      const trimmed = ref.folderName.trim();
      if (!trimmed) return null;
      const { folder } = await this.createOrGet(userId, trimmed);
      return folder.id;
    }
    return undefined;
  }

  /** Folder view for embedding in routine responses; null for missing/deleted. */
  async folderInfo(
    userId: string,
    folderId: string | null,
  ): Promise<FolderView | null> {
    if (!folderId) return null;
    const folder = await this.prisma.routineFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder || folder.userId !== userId || folder.deletedAt) return null;
    return this.view(folder);
  }

  private async requireFolder(userId: string, folderId: string) {
    const folder = await this.prisma.routineFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder || folder.userId !== userId || folder.deletedAt) {
      throw new NotFoundException('Folder not found');
    }
    return folder;
  }

  private view(folder: { id: string; name: string }): FolderView {
    return { id: folder.id, name: folder.name };
  }
}
