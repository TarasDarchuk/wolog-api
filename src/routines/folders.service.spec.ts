jest.mock('uuid', () => {
  let counter = 0;
  return {
    v4: jest.fn(
      () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    ),
  };
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  makeExistingFolder,
} from '../__mocks__/prisma.mock.js';
import { FoldersService } from './folders.service.js';

describe('FoldersService', () => {
  let service: FoldersService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new FoldersService(prisma as any);
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns folders with routine counts', async () => {
      prisma.routineFolder.findMany.mockResolvedValue([
        makeExistingFolder(),
        makeExistingFolder({ id: 'folder-2', name: 'Legs' }),
      ]);
      prisma.workoutTemplate.groupBy.mockResolvedValue([
        { folderId: 'folder-1', _count: { _all: 3 } },
      ]);

      const result = await service.list(USER_ID);

      expect(result.folders).toEqual([
        {
          id: 'folder-1',
          name: 'Push Days',
          routineCount: 3,
          updatedAt: NOW,
        },
        { id: 'folder-2', name: 'Legs', routineCount: 0, updatedAt: NOW },
      ]);
    });
  });

  // ─── createOrGet ─────────────────────────────────────────────────────────

  describe('createOrGet', () => {
    it('returns the existing folder on a case-insensitive name match', async () => {
      prisma.routineFolder.findFirst.mockResolvedValue(makeExistingFolder());

      const result = await service.createOrGet(USER_ID, '  push days ');

      expect(result).toEqual({
        folder: { id: 'folder-1', name: 'Push Days' },
        created: false,
      });
      expect(prisma.routineFolder.create).not.toHaveBeenCalled();
    });

    it('creates a new folder with the next sortOrder', async () => {
      prisma.routineFolder.findFirst.mockResolvedValue(null);
      prisma.routineFolder.aggregate.mockResolvedValue({
        _max: { sortOrder: 4 },
      });
      prisma.routineFolder.create.mockImplementation(
        async ({ data }: any) => data,
      );

      const result = await service.createOrGet(USER_ID, 'Cut Phase');

      expect(result.created).toBe(true);
      expect(result.folder.name).toBe('Cut Phase');
      expect(prisma.routineFolder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          name: 'Cut Phase',
          sortOrder: 5,
        }),
      });
    });

    it('rejects an empty name', async () => {
      await expect(service.createOrGet(USER_ID, '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ─── rename ──────────────────────────────────────────────────────────────

  describe('rename', () => {
    it('renames an owned folder', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(makeExistingFolder());
      prisma.routineFolder.update.mockResolvedValue(
        makeExistingFolder({ name: 'Bulk Phase' }),
      );

      const result = await service.rename(USER_ID, 'folder-1', 'Bulk Phase');

      expect(result.folder.name).toBe('Bulk Phase');
    });

    it("rejects another user's folder as not found", async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(
        makeExistingFolder({ userId: OTHER_USER_ID }),
      );

      await expect(
        service.rename(USER_ID, 'folder-1', 'X'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── remove ──────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft-deletes and moves routines back to root', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(makeExistingFolder());
      prisma.workoutTemplate.updateMany.mockResolvedValue({ count: 3 });
      prisma.routineFolder.update.mockResolvedValue({});

      const result = await service.remove(USER_ID, 'folder-1');

      expect(result).toEqual({ deleted: true, routinesMovedToRoot: 3 });
      expect(prisma.workoutTemplate.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, folderId: 'folder-1', deletedAt: null },
        data: expect.objectContaining({ folderId: null }),
      });
      expect(prisma.routineFolder.update).toHaveBeenCalledWith({
        where: { id: 'folder-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      });
    });

    it('rejects a soft-deleted folder as not found', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(
        makeExistingFolder({ deletedAt: new Date(NOW) }),
      );

      await expect(service.remove(USER_ID, 'folder-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── resolveRef ──────────────────────────────────────────────────────────

  describe('resolveRef', () => {
    it('returns undefined when no folder reference is given', async () => {
      expect(await service.resolveRef(USER_ID, {})).toBeUndefined();
    });

    it('returns null for explicit null folderId (remove from folder)', async () => {
      expect(await service.resolveRef(USER_ID, { folderId: null })).toBeNull();
    });

    it('returns null for empty folderName', async () => {
      expect(
        await service.resolveRef(USER_ID, { folderName: '  ' }),
      ).toBeNull();
    });

    it('validates ownership of an explicit folderId', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(
        makeExistingFolder({ userId: OTHER_USER_ID }),
      );

      await expect(
        service.resolveRef(USER_ID, { folderId: 'folder-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves folderName by creating when missing', async () => {
      prisma.routineFolder.findFirst.mockResolvedValue(null);
      prisma.routineFolder.aggregate.mockResolvedValue({
        _max: { sortOrder: null },
      });
      prisma.routineFolder.create.mockImplementation(
        async ({ data }: any) => data,
      );

      const id = await service.resolveRef(USER_ID, { folderName: 'PPL' });

      expect(typeof id).toBe('string');
      expect(prisma.routineFolder.create).toHaveBeenCalled();
    });
  });

  // ─── folderInfo ──────────────────────────────────────────────────────────

  describe('folderInfo', () => {
    it('returns null for null id and for deleted/foreign folders', async () => {
      expect(await service.folderInfo(USER_ID, null)).toBeNull();

      prisma.routineFolder.findUnique.mockResolvedValue(
        makeExistingFolder({ deletedAt: new Date(NOW) }),
      );
      expect(await service.folderInfo(USER_ID, 'folder-1')).toBeNull();
    });

    it('returns id and name for an owned folder', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(makeExistingFolder());
      expect(await service.folderInfo(USER_ID, 'folder-1')).toEqual({
        id: 'folder-1',
        name: 'Push Days',
      });
    });
  });
});
