import type {
  Customisation, Dataset, DatasetColumn, DatasetRow, Profile, RawRow, ReportResult, ReportTemplate,
} from '@azentio/core';
import type { PublicSource } from '@azentio/pipeline';

export interface WorkspaceData {
  profile: Profile;
  datasets: Dataset[];
  dataset: Dataset | null;
  columns: DatasetColumn[];
  rawPreview: RawRow[];
  rowPreview: DatasetRow[];
  customisations: Customisation[];
  templates: ReportTemplate[];
  selectedTemplate: ReportTemplate | null;
  mappingId: string | null;
  latestReport: ReportResult | null;
  sampleFiles: readonly string[];
  sources: PublicSource[];
  sourcesError: string | null;
}
