/**
 * Database and domain types.
 *
 * Row types must be type ALIASES, not interfaces — an interface has no implicit
 * index signature, fails postgrest's `Row extends Record<string, unknown>`
 * constraint, and silently degrades every query result to `never`.
 */

export type DatasetStatus = 'uploaded' | 'structuring' | 'structured' | 'failed';
export type ColumnType = 'text' | 'number' | 'currency' | 'date' | 'boolean';
export type FieldRole = 'dimension' | 'measure' | 'date';
export type CustomisationStatus = 'pending' | 'approved' | 'rejected';
export type ChatRole = 'user' | 'assistant' | 'tool';
export type SourceKind = 'upload' | 'postgres';

export type CustomisationKind =
  | 'column_rename'
  | 'type_conflict'
  | 'value_coercion'
  | 'text_split'
  | 'row_exclusion'
  | 'field_mapping'
  | 'unmapped_field'
  | 'derived_field';

export type Aggregation = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';

export type Profile = {
  id: string;
  full_name: string | null;
  created_at: string;
};

export type Dataset = {
  id: string;
  owner_id: string;
  source_id: string | null;
  name: string;
  source_filename: string;
  sheet_name: string | null;
  status: DatasetStatus;
  raw_row_count: number;
  structured_row_count: number;
  header_row_index: number | null;
  structure_notes: string | null;
  structure_model: string | null;
  created_at: string;
  updated_at: string;
  structured_at: string | null;
};

/** Non-secret connection settings. The password lives only in `secret_enc`. */
export type PostgresSourceConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  /** Last table or query imported, so a refresh needs no re-entry. */
  table?: string;
  query?: string;
};

export type UploadSourceConfig = {
  filename: string;
  size: number;
  sheet: string | null;
};

export type DataSource = {
  id: string;
  owner_id: string;
  kind: SourceKind;
  name: string;
  config: PostgresSourceConfig | UploadSourceConfig;
  /** AES-256-GCM ciphertext; never sent to the browser. */
  secret_enc: string | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_note: string | null;
  last_imported_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RawRow = {
  id: number;
  dataset_id: string;
  row_index: number;
  /** Positional array of raw cell values, exactly as parsed. */
  cells: Array<string | number | boolean | null>;
};

export type DatasetColumn = {
  id: string;
  dataset_id: string;
  key: string;
  label: string;
  data_type: ColumnType;
  source_header: string | null;
  source_index: number | null;
  is_derived: boolean;
  formula: string | null;
  sample_values: unknown[];
  null_count: number;
  position: number;
  created_at: string;
};

export type DatasetRow = {
  id: number;
  dataset_id: string;
  row_index: number;
  data: Record<string, unknown>;
};

export type TemplateField = {
  key: string;
  label: string;
  type: ColumnType;
  role: FieldRole;
  required: boolean;
  aggregation?: Aggregation;
  /** True when the mapper may satisfy this field with a computed formula. */
  derivable?: boolean;
  description?: string;
};

export type ReportTemplate = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  icon: string | null;
  fields: TemplateField[];
  position: number;
  active: boolean;
  created_at: string;
};

export type Mapping = {
  id: string;
  dataset_id: string;
  template_id: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Customisation proposals — one shape per kind, discriminated by `kind`.
// ---------------------------------------------------------------------------

export type ColumnRenameProposal = { from: string; to: string; label: string; data_type: ColumnType };
export type TypeConflictProposal = { column: string; majority_type: ColumnType; odd_values: string[]; action: 'null_out' | 'keep_as_text' };
export type ValueCoercionProposal = { column: string; detected_format: string; examples: string[]; action: 'parse' | 'null_out' };
export type TextSplitProposal = { column: string; parts: Array<{ key: string; label: string; type: ColumnType }>; separator: string; examples: string[][] };
export type RowExclusionProposal = { row_indexes: number[]; reason: 'totals' | 'blank' | 'repeated_header' | 'title' };
export type FieldMappingProposal = { field: string; column: string };
export type UnmappedFieldProposal = { field: string; candidates: Array<{ column: string; confidence: number }> };
export type DerivedFieldProposal = { field: string; formula: string; inputs: string[]; result_type: ColumnType };

export type CustomisationProposal =
  | ColumnRenameProposal | TypeConflictProposal | ValueCoercionProposal
  | TextSplitProposal | RowExclusionProposal | FieldMappingProposal
  | UnmappedFieldProposal | DerivedFieldProposal;

export type Customisation = {
  id: string;
  dataset_id: string;
  mapping_id: string | null;
  kind: CustomisationKind;
  target_key: string;
  proposal: CustomisationProposal;
  /** The user's own value, when they changed the proposal rather than accepting it. */
  override: CustomisationProposal | null;
  confidence: number | null;
  affected_rows: number;
  rationale: string;
  status: CustomisationStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};

export type ReportFilters = {
  date_column?: string;
  from?: string;
  to?: string;
  where?: Array<{ column: string; op: 'eq' | 'neq' | 'gt' | 'lt' | 'contains'; value: string }>;
};

export type Report = {
  id: string;
  dataset_id: string;
  template_id: string;
  filters: ReportFilters;
  summary: Record<string, unknown>;
  row_count: number;
  generated_at: string;
};

export type ChartSpec = {
  type: 'bar' | 'pie';
  title: string;
  /** Category labels, in render order. */
  labels: string[];
  values: number[];
  value_label?: string;
  /** Set when the values are rupee amounts, so the renderer formats them as such. */
  is_currency?: boolean;
};

export type ChatSession = {
  id: string;
  dataset_id: string;
  created_at: string;
  last_message_at: string;
};

export type ChatMessage = {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  chart: ChartSpec | null;
  tool_calls: unknown | null;
  ttft_ms: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Supabase client generic
// ---------------------------------------------------------------------------

type Relationship<
  FK extends string, Cols extends readonly string[],
  RefRelation extends string, RefCols extends readonly string[],
  OneToOne extends boolean = false,
> = {
  foreignKeyName: FK; columns: Cols; isOneToOne: OneToOne;
  referencedRelation: RefRelation; referencedColumns: RefCols;
};

type AnyRelationship = {
  foreignKeyName: string; columns: string[]; isOneToOne?: boolean;
  referencedRelation: string; referencedColumns: string[];
};

type Table<Row, R extends readonly AnyRelationship[] = []> = {
  Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: R;
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      report_templates: Table<ReportTemplate>;
      data_sources: Table<
        DataSource,
        [Relationship<'data_sources_owner_id_fkey', ['owner_id'], 'profiles', ['id']>]
      >;
      datasets: Table<
        Dataset,
        [
          Relationship<'datasets_owner_id_fkey', ['owner_id'], 'profiles', ['id']>,
          Relationship<'datasets_source_id_fkey', ['source_id'], 'data_sources', ['id']>,
        ]
      >;
      raw_rows: Table<
        RawRow,
        [Relationship<'raw_rows_dataset_id_fkey', ['dataset_id'], 'datasets', ['id']>]
      >;
      dataset_columns: Table<
        DatasetColumn,
        [Relationship<'dataset_columns_dataset_id_fkey', ['dataset_id'], 'datasets', ['id']>]
      >;
      dataset_rows: Table<
        DatasetRow,
        [Relationship<'dataset_rows_dataset_id_fkey', ['dataset_id'], 'datasets', ['id']>]
      >;
      mappings: Table<
        Mapping,
        [
          Relationship<'mappings_dataset_id_fkey', ['dataset_id'], 'datasets', ['id']>,
          Relationship<'mappings_template_id_fkey', ['template_id'], 'report_templates', ['id']>,
        ]
      >;
      customisations: Table<
        Customisation,
        [
          Relationship<'customisations_dataset_id_fkey', ['dataset_id'], 'datasets', ['id']>,
          Relationship<'customisations_mapping_id_fkey', ['mapping_id'], 'mappings', ['id']>,
        ]
      >;
      reports: Table<
        Report,
        [
          Relationship<'reports_dataset_id_fkey', ['dataset_id'], 'datasets', ['id']>,
          Relationship<'reports_template_id_fkey', ['template_id'], 'report_templates', ['id']>,
        ]
      >;
      chat_sessions: Table<
        ChatSession,
        [Relationship<'chat_sessions_dataset_id_fkey', ['dataset_id'], 'datasets', ['id']>]
      >;
      chat_messages: Table<
        ChatMessage,
        [Relationship<'chat_messages_session_id_fkey', ['session_id'], 'chat_sessions', ['id']>]
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      owns_dataset: { Args: { ds: string }; Returns: boolean };
    };
    Enums: {
      dataset_status: DatasetStatus;
      column_type: ColumnType;
      customisation_kind: CustomisationKind;
      customisation_status: CustomisationStatus;
      field_role: FieldRole;
      chat_role: ChatRole;
      source_kind: SourceKind;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
