export interface PushResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

export interface EntityPushResult {
  workouts: PushResult;
  exercises: PushResult;
  templates: PushResult;
  measurements: PushResult;
}
