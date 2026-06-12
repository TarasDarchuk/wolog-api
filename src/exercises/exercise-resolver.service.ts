import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CatalogExercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  exerciseType: string;
  isCustom: boolean;
}

export interface ExerciseRequest {
  exerciseId?: string;
  name?: string;
}

export type ResolutionMethod =
  | 'id'
  | 'exact'
  | 'normalized'
  | 'fuzzy'
  | 'created_custom';

export interface ExerciseResolution {
  requested: string;
  resolvedTo: string;
  id: string;
  method: ResolutionMethod;
  confidence: number;
  createdCustom: boolean;
}

// Multi-word abbreviations, replaced on the whole string before tokenizing.
const PHRASE_SYNONYMS: Array<[RegExp, string]> = [
  [/\bohp\b/g, 'overhead press'],
  [/\brdl\b/g, 'romanian deadlift'],
  [/\bsldl\b/g, 'stiff leg deadlift'],
  [/\bghr\b/g, 'glute ham raise'],
  [/\bhspu\b/g, 'handstand push up'],
];

// Single-token abbreviations.
const TOKEN_SYNONYMS: Record<string, string> = {
  db: 'dumbbell',
  dbs: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  bw: 'bodyweight',
  dl: 'deadlift',
  ext: 'extension',
  alt: 'alternating',
};

// When several candidates score equally ("Bench Press" matches the Barbell,
// Dumbbell and Smith variants the same), prefer the most canonical equipment.
const EQUIPMENT_PRIORITY = [
  'barbell',
  'dumbbell',
  'bodyweight',
  'cable',
  'machine',
  'kettlebell',
  'plate',
  'resistanceBand',
  'suspension',
  'other',
];

const FUZZY_THRESHOLD = 0.6;

export function normalizeTokens(name: string): string[] {
  let text = name.toLowerCase().trim();
  for (const [pattern, replacement] of PHRASE_SYNONYMS) {
    text = text.replace(pattern, replacement);
  }
  // Parenthetical equipment qualifiers become plain tokens: "Bench Press
  // (Barbell)" → bench press barbell. All punctuation collapses to spaces.
  text = text.replace(/[^a-z0-9]+/g, ' ');
  const tokens = text
    .split(' ')
    .filter(Boolean)
    .map((t) => TOKEN_SYNONYMS[t] ?? t)
    .map((t) =>
      // naive singularization: rows→row, curls→curl; keeps "press"
      t.length >= 4 && t.endsWith('s') && !t.endsWith('ss')
        ? t.slice(0, -1)
        : t,
    );
  return [...new Set(tokens)].sort();
}

export function tokenScore(requested: string[], candidate: string[]): number {
  const a = new Set(requested);
  const b = new Set(candidate);
  const inter = [...a].filter((t) => b.has(t)).length;
  if (inter === 0) return 0;
  if (inter === a.size && inter === b.size) return 1;
  if (inter === a.size) return 0.7 + 0.25 * (a.size / b.size);
  if (inter === b.size) return 0.65 + 0.25 * (b.size / a.size);
  const union = a.size + b.size - inter;
  return (inter / union) * 0.8;
}

// ─── Best-guess classification for created custom exercises ─────────────────

const MUSCLE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bcurl\b/, 'biceps'],
  [/\b(skull|pushdown|tricep|dip)\b/, 'triceps'],
  [/\b(pulldown|pull up|pullup|chin|lat)\b/, 'lats'],
  [/\brow\b/, 'upperBack'],
  [/\bshrug\b/, 'traps'],
  [/\b(bench|chest|fly|flye|pec)\b/, 'chest'],
  [/\b(shoulder|lateral|overhead|press)\b/, 'shoulders'],
  [/\b(squat|lunge|leg press|quad)\b/, 'quadriceps'],
  [/\bromanian|hamstring|leg curl\b/, 'hamstrings'],
  [/\bdeadlift\b/, 'lowerBack'],
  [/\b(glute|hip thrust|kickback)\b/, 'glutes'],
  [/\bcalf|calve\b/, 'calves'],
  [/\b(ab|abs|crunch|plank|sit up|situp|core)\b/, 'abdominals'],
  [/\bforearm|wrist|grip\b/, 'forearms'],
  [/\b(run|sprint|bike|cycling|rowing|cardio|jump rope)\b/, 'cardio'],
];

const EQUIPMENT_KEYWORDS: Array<[RegExp, string]> = [
  [/\bbarbell\b/, 'barbell'],
  [/\bdumbbell\b/, 'dumbbell'],
  [/\bcable\b/, 'cable'],
  [/\bmachine\b/, 'machine'],
  [/\bkettlebell\b/, 'kettlebell'],
  [/\bband\b/, 'resistanceBand'],
  [/\bplate\b/, 'plate'],
  [/\b(trx|suspension)\b/, 'suspension'],
  [
    /\b(bodyweight|push up|pushup|pull up|pullup|chin|plank|dip)\b/,
    'bodyweight',
  ],
];

function guessClassification(name: string): {
  muscleGroup: string;
  equipment: string;
  exerciseType: string;
} {
  const text = normalizeTokens(name).join(' ');

  let muscleGroup = 'other';
  for (const [pattern, group] of MUSCLE_KEYWORDS) {
    if (pattern.test(text)) {
      muscleGroup = group;
      break;
    }
  }

  let equipment = 'other';
  for (const [pattern, eq] of EQUIPMENT_KEYWORDS) {
    if (pattern.test(text)) {
      equipment = eq;
      break;
    }
  }

  let exerciseType = 'weightReps';
  if (/\b(plank|hold|hang|wall sit)\b/.test(text)) exerciseType = 'duration';
  else if (/\b(run|sprint|bike|cycling|walk|jog)\b/.test(text))
    exerciseType = 'distanceDuration';
  else if (equipment === 'bodyweight') exerciseType = 'repsOnly';

  return { muscleGroup, equipment, exerciseType };
}

/**
 * Resolves AI-supplied exercise references (name or UUID) to canonical
 * exercise UUIDs. Never emits an unresolved reference: when nothing in the
 * library or the user's custom exercises matches confidently, a new custom
 * exercise is created in the user's account.
 */
@Injectable()
export class ExerciseResolverService {
  private readonly logger = new Logger(ExerciseResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  async loadCatalog(userId: string): Promise<CatalogExercise[]> {
    const rows = await this.prisma.exercise.findMany({
      where: {
        deletedAt: null,
        OR: [{ userId: null }, { userId }],
      },
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        equipment: true,
        exerciseType: true,
        isCustom: true,
      },
    });
    return rows as CatalogExercise[];
  }

  async resolveAll(
    userId: string,
    requests: ExerciseRequest[],
  ): Promise<ExerciseResolution[]> {
    const catalog = await this.loadCatalog(userId);
    const resolutions: ExerciseResolution[] = [];
    for (const request of requests) {
      resolutions.push(await this.resolveOne(userId, request, catalog));
    }
    return resolutions;
  }

  private async resolveOne(
    userId: string,
    request: ExerciseRequest,
    catalog: CatalogExercise[],
  ): Promise<ExerciseResolution> {
    const requestedLabel =
      request.name?.trim() || request.exerciseId || '(unspecified)';

    // 1. Exact id match.
    if (request.exerciseId) {
      const byId = catalog.find((e) => e.id === request.exerciseId);
      if (byId) {
        return {
          requested: requestedLabel,
          resolvedTo: byId.name,
          id: byId.id,
          method: 'id',
          confidence: 1,
          createdCustom: false,
        };
      }
      // A UUID the user doesn't have would render as a blank "Unknown"
      // placeholder in the app — fall through to name resolution instead.
    }

    const name = request.name?.trim();
    if (!name) {
      // No name and an unknown id: create a placeholder custom so the
      // reference is never dangling.
      return this.createCustom(userId, 'Unknown Exercise', catalog);
    }

    // 2. Exact name match (case-insensitive, trimmed). On a library/custom
    // name collision the library entry wins (see pickBest).
    const lower = name.toLowerCase();
    const exact = this.pickBest(
      catalog.filter((e) => e.name.trim().toLowerCase() === lower),
    );
    if (exact) {
      return {
        requested: requestedLabel,
        resolvedTo: exact.name,
        id: exact.id,
        method: 'exact',
        confidence: 1,
        createdCustom: false,
      };
    }

    // 3. Normalized match (punctuation/qualifiers/synonyms/plurals).
    const requestedTokens = normalizeTokens(name);
    const requestedKey = requestedTokens.join(' ');
    const normalized = this.pickBest(
      catalog.filter((e) => normalizeTokens(e.name).join(' ') === requestedKey),
    );
    if (normalized) {
      return {
        requested: requestedLabel,
        resolvedTo: normalized.name,
        id: normalized.id,
        method: 'normalized',
        confidence: 0.95,
        createdCustom: false,
      };
    }

    // 4. Fuzzy token-overlap above threshold.
    let bestScore = 0;
    let bestCandidates: CatalogExercise[] = [];
    for (const candidate of catalog) {
      const score = tokenScore(
        requestedTokens,
        normalizeTokens(candidate.name),
      );
      if (score > bestScore + 1e-9) {
        bestScore = score;
        bestCandidates = [candidate];
      } else if (Math.abs(score - bestScore) <= 1e-9 && score > 0) {
        bestCandidates.push(candidate);
      }
    }
    if (bestScore >= FUZZY_THRESHOLD) {
      const best = this.pickBest(bestCandidates)!;
      return {
        requested: requestedLabel,
        resolvedTo: best.name,
        id: best.id,
        method: 'fuzzy',
        confidence: Math.round(bestScore * 100) / 100,
        createdCustom: false,
      };
    }

    // 5. No confident match → create a custom exercise.
    return this.createCustom(userId, name, catalog);
  }

  /** Tie-break: library before custom, then equipment priority, then shorter name. */
  private pickBest(candidates: CatalogExercise[]): CatalogExercise | undefined {
    if (candidates.length === 0) return undefined;
    return [...candidates].sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
      const ap = EQUIPMENT_PRIORITY.indexOf(a.equipment);
      const bp = EQUIPMENT_PRIORITY.indexOf(b.equipment);
      if (ap !== bp) return ap - bp;
      return a.name.length - b.name.length;
    })[0];
  }

  private async createCustom(
    userId: string,
    name: string,
    catalog: CatalogExercise[],
  ): Promise<ExerciseResolution> {
    const guess = guessClassification(name);
    const created = await this.prisma.exercise.create({
      data: {
        id: uuidv4(),
        userId,
        name,
        muscleGroup: guess.muscleGroup as never,
        equipment: guess.equipment as never,
        exerciseType: guess.exerciseType as never,
        isCustom: true,
        primaryMuscles:
          guess.muscleGroup === 'other' ? [] : [guess.muscleGroup],
        secondaryMuscles: [],
      },
    });
    this.logger.log(
      `Created custom exercise "${name}" (${created.id}) for user ${userId}`,
    );

    const entry: CatalogExercise = {
      id: created.id,
      name: created.name,
      muscleGroup: created.muscleGroup,
      equipment: created.equipment,
      exerciseType: created.exerciseType,
      isCustom: true,
    };
    // Visible to later resolutions in the same request, so a repeated unknown
    // name maps to one custom exercise, not several.
    catalog.push(entry);

    return {
      requested: name,
      resolvedTo: created.name,
      id: created.id,
      method: 'created_custom',
      confidence: 0,
      createdCustom: true,
    };
  }
}
