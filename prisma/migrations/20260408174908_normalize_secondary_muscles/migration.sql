-- Normalize secondaryMuscles display-name strings to MuscleGroup enum values.
-- Multi-word names get camelCase mapping; single-word names get lowercased.
UPDATE "Exercise"
SET "secondaryMuscles" = (
  SELECT array_agg(
    CASE val
      WHEN 'Lower Back' THEN 'lowerBack'
      WHEN 'Upper Back' THEN 'upperBack'
      WHEN 'Full Body'  THEN 'fullBody'
      ELSE lower(val)
    END
  )
  FROM unnest("secondaryMuscles") AS val
)
WHERE "secondaryMuscles" != '{}';

-- Also normalize primaryMuscles for consistency.
UPDATE "Exercise"
SET "primaryMuscles" = (
  SELECT array_agg(
    CASE val
      WHEN 'Lower Back' THEN 'lowerBack'
      WHEN 'Upper Back' THEN 'upperBack'
      WHEN 'Full Body'  THEN 'fullBody'
      ELSE lower(val)
    END
  )
  FROM unnest("primaryMuscles") AS val
)
WHERE "primaryMuscles" != '{}';
