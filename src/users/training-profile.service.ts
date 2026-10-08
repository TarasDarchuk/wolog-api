import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TrainingProfileDto } from './dto/training-profile.dto.js';

export const TRAINING_PROFILE_SELECT = {
  goals: true,
  level: true,
  equipment: true,
  daysPerWeek: true,
  useMetric: true,
  starterProgramId: true,
  onboardingCompletedAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class TrainingProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** null when the user never sent one. */
  get(userId: string) {
    return this.prisma.trainingProfile.findUnique({
      where: { userId },
      select: TRAINING_PROFILE_SELECT,
    });
  }

  /** Full replace — omitted fields are cleared. */
  replace(userId: string, dto: TrainingProfileDto) {
    const data = {
      goals: dto.goals ?? [],
      level: dto.level ?? null,
      equipment: dto.equipment ?? null,
      daysPerWeek: dto.daysPerWeek ?? null,
      useMetric: dto.useMetric ?? null,
      starterProgramId: dto.starterProgramId ?? null,
      onboardingCompletedAt: dto.onboardingCompletedAt
        ? new Date(dto.onboardingCompletedAt)
        : null,
    };
    return this.prisma.trainingProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: TRAINING_PROFILE_SELECT,
    });
  }
}
