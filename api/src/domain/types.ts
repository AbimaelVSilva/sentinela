/** Tipos de domínio compartilhados (banco, pipeline, IA). */

export interface Point {
  x: number;
  y: number;
}

/** Polígono normalizado 0..1. */
export type RoiPolygon = Point[];

/** Retângulo normalizado 0..1. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ViewAngle = 'top_down' | 'high_angle' | 'frontal' | 'other';

export interface SceneValidation {
  isShelfScene: boolean;
  viewAngle: ViewAngle;
  productCountEstimate: number;
  issues: string[];
}

export interface SceneValidationResult extends SceneValidation {
  validatedAt: string;
  forced?: boolean;
}

export interface InventoryItem {
  id: string;
  label: string;
  quantity: number;
  region: Region;
  shelfRow?: number | null;
}

export interface Inventory {
  items: InventoryItem[];
  updatedAt?: string;
}

export type ChangeKind = 'removed' | 'moved' | 'added';

export interface Change {
  itemId: string | null;
  label: string;
  change: ChangeKind;
  quantity: number;
  beforeRegion: Region | null;
  afterRegion: Region | null;
  confidence: number;
}

export interface Comparison {
  changes: Change[];
  summary: string;
  overallConfidence: number;
}
