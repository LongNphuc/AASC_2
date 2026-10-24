/**
 * Mã stage trên Bitrix24 (readme_design.md mục 6.3): pipeline khác 0 thì có
 * tiền tố, NEW ở pipeline 1 là C1:NEW. Cấu hình viết mã ngắn.
 */
export function toBitrixStage(pipelineId: string, stage: string): string {
  if (stage.includes(':')) return stage;
  return Number(pipelineId) ? `C${Number(pipelineId)}:${stage}` : stage;
}

/** "C1:WON" → "WON". */
export function fromBitrixStage(stageId: string): string {
  const index = stageId.indexOf(':');
  return index >= 0 ? stageId.slice(index + 1) : stageId;
}
