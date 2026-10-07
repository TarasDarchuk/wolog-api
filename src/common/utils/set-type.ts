import { SetType } from '../../generated/prisma/client.js';

export const SET_TYPES = Object.values(SetType);

/**
 * Template set type as stored: "normal" (or absent) is persisted as null so
 * clients that predate set types and clients that omit it for normal sets
 * read back the same thing.
 */
export function toStoredTemplateSetType(
  type: string | null | undefined,
): SetType | null {
  if (!type || type === SetType.normal) return null;
  return type as SetType;
}
