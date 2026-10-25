import type { RecordPayload } from '@/lib/spec/schema';

export type Row = {
  id: string;
  entity: string;
  payload: RecordPayload;
  createdAt: string;
};

export type RowsByEntity = Record<string, Row[]>;
