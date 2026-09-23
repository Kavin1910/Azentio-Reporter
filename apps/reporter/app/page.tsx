import type { ReportTemplate } from '@azentio/core';
import { requireUser } from '@/lib/auth';
import { getServerSupabase } from '@/lib/supabase/server';
import {
  getEffectiveColumns, getCustomisations, getDataset, getLatestReport, getMappingId,
  getRawPreview, getRowPreview, listDatasets, listTemplates, listSources,
} from '@/lib/data';
import { SAMPLE_FILES } from '@/lib/samples';
import { Workspace } from '@/components/workspace';
import type { WorkspaceData } from '@/components/types';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: { searchParams: Promise<{ ds?: string; tpl?: string; step?: string }> }) {
  const { ds, tpl, step } = await searchParams;
  const profile = await requireUser();
  const sb = await getServerSupabase();

  const [datasets, templates, sourcesResult] = await Promise.all([
    listDatasets(sb), listTemplates(sb),
    // Migration 0004 may not be applied yet; surface that as a notice, not a crash.
    listSources(sb).then((s) => ({ sources: s, error: null as string | null })).catch((e: Error) => ({ sources: [], error: e.message })),
  ]);

  // Fall back to the most recent dataset so the screen is never empty when one exists.
  const datasetId = ds && datasets.some((d) => d.id === ds) ? ds : datasets[0]?.id ?? null;
  const dataset = datasetId ? await getDataset(sb, datasetId) : null;
  const selectedTemplate: ReportTemplate | null = tpl ? templates.find((t) => t.code === tpl) ?? null : null;

  let data: WorkspaceData = {
    profile, datasets, dataset, columns: [], rawPreview: [], rowPreview: [],
    customisations: [], templates, selectedTemplate, mappingId: null, latestReport: null,
    sampleFiles: SAMPLE_FILES, sources: sourcesResult.sources, sourcesError: sourcesResult.error,
  };

  if (dataset) {
    const mappingId = selectedTemplate ? await getMappingId(sb, dataset.id, selectedTemplate.id) : null;
    const [columns, rawPreview, rowPreview, customisations, latest] = await Promise.all([
      getEffectiveColumns(sb, dataset.id),
      getRawPreview(sb, dataset.id, 40),
      getRowPreview(sb, dataset.id, 40),
      getCustomisations(sb, dataset.id, mappingId),
      selectedTemplate ? getLatestReport(sb, dataset.id, selectedTemplate.id) : Promise.resolve(null),
    ]);
    data = { ...data, columns, rawPreview, rowPreview, customisations, mappingId, latestReport: latest?.result ?? null };
  }

  return <Workspace data={data} step={step} />;
}
