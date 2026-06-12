/**
 * Maps the WorkoutTemplate DB aggregate to the AI-facing routine schema (§8).
 *
 * DB shape note: a superset is stored as one TemplateSuperset row plus one
 * TemplateItem *per member exercise* (each item carrying supersetId). The
 * AI-facing schema collapses those member items into a single superset item,
 * so the assistant sees `{ superset: { exercises: [...] } }`.
 */

export interface DbTemplateSet {
  id: string;
  setNumber: number;
  targetWeight: number | null;
  targetReps: number | null;
  targetDuration: number | null;
  targetDistance: number | null;
}

export interface DbTemplateExercise {
  id: string;
  exerciseId: string;
  sortOrder: number;
  targetSets: number;
  targetReps: number;
  notes: string | null;
  restTimerSeconds: number | null;
  sets: DbTemplateSet[];
  exercise?: { name: string } | null;
}

export interface DbTemplateItem {
  id: string;
  sortOrder: number;
  supersetId: string | null;
  exercise: DbTemplateExercise | null;
}

export interface DbTemplate {
  id: string;
  name: string;
  notes: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  items: DbTemplateItem[];
  supersets: {
    id: string;
    supersetColorIndex: number;
    exerciseIds: string[];
  }[];
}

export interface RoutineSetView {
  id: string;
  setNumber: number;
  targetWeight: number | null;
  targetReps: number | null;
  targetDuration: number | null;
  targetDistance: number | null;
}

export interface RoutineExerciseView {
  id: string;
  exerciseId: string;
  name: string | null;
  targetSets: number;
  targetReps: number;
  notes: string | null;
  restTimerSeconds: number | null;
  sets: RoutineSetView[];
}

export interface RoutineItemView {
  id: string;
  exercise?: RoutineExerciseView;
  superset?: {
    id: string;
    supersetColorIndex: number;
    exercises: RoutineExerciseView[];
  };
}

export interface RoutineView {
  id: string;
  name: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: RoutineItemView[];
}

function mapSet(set: DbTemplateSet): RoutineSetView {
  return {
    id: set.id,
    setNumber: set.setNumber,
    targetWeight: set.targetWeight,
    targetReps: set.targetReps,
    targetDuration: set.targetDuration,
    targetDistance: set.targetDistance,
  };
}

function mapExercise(ex: DbTemplateExercise): RoutineExerciseView {
  return {
    id: ex.id,
    exerciseId: ex.exerciseId,
    name: ex.exercise?.name ?? null,
    targetSets: ex.targetSets,
    targetReps: ex.targetReps,
    notes: ex.notes,
    restTimerSeconds: ex.restTimerSeconds,
    sets: [...ex.sets].sort((a, b) => a.setNumber - b.setNumber).map(mapSet),
  };
}

export function toRoutineView(template: DbTemplate): RoutineView {
  const items = [...template.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const colorBySuperset = new Map(
    template.supersets.map((s) => [s.id, s.supersetColorIndex]),
  );

  const result: RoutineItemView[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];

    if (!item.supersetId) {
      if (item.exercise) {
        result.push({ id: item.id, exercise: mapExercise(item.exercise) });
      }
      i++;
      continue;
    }

    // Collapse the consecutive run of member items into one superset item.
    const supersetId = item.supersetId;
    const members: DbTemplateItem[] = [];
    while (i < items.length && items[i].supersetId === supersetId) {
      members.push(items[i]);
      i++;
    }
    const exercises = members
      .filter((m) => m.exercise)
      .map((m) => mapExercise(m.exercise!));
    if (exercises.length === 0) continue;

    result.push({
      id: members[0].id,
      superset: {
        id: supersetId,
        supersetColorIndex: colorBySuperset.get(supersetId) ?? 0,
        exercises,
      },
    });
  }

  return {
    id: template.id,
    name: template.name,
    notes: template.notes || null,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    items: result,
  };
}
