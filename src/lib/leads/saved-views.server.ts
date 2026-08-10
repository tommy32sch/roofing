import {
  parseLeadViewDefinition,
  type LeadSavedView,
  type LeadViewDefinitionV1,
} from '@/lib/leads/work-queue';

export const LEAD_SAVED_VIEW_DB_FIELDS =
  'id, name, definition_version, definition, created_at, updated_at';

export interface LeadSavedViewDbRow {
  id: string;
  name: string;
  definition_version: number;
  definition: unknown;
  created_at: string;
  updated_at: string;
}

export function toLeadSavedView(row: LeadSavedViewDbRow): LeadSavedView | null {
  if (row.definition_version !== 1) return null;
  const definition = parseLeadViewDefinition(row.definition);
  if (!definition) return null;
  return {
    id: row.id,
    name: row.name,
    definitionVersion: 1,
    definition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function savedViewInsert(
  ownerUserId: string,
  name: string,
  definition: LeadViewDefinitionV1
) {
  return {
    owner_user_id: ownerUserId,
    name,
    definition_version: 1,
    definition,
  };
}
