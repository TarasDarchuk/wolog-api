export interface PushResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

export interface TemplatePushResult extends PushResult {
  // Server updatedAt of each accepted template after the write. Its presence
  // tells the client the server supports baseUpdatedAt.
  acceptedVersions?: { id: string; updatedAt: string }[];
}

export interface EntityPushResult {
  workouts: PushResult;
  exercises: PushResult;
  templates: TemplatePushResult;
  folders: PushResult;
  measurements: PushResult;
}
