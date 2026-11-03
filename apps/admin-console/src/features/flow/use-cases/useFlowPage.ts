import type { Area } from '#/entities/area';
import { flowPage, type FlowWords } from '#/features/flow/services/flowWording';

// The gate wraps the page, so it takes the area and the title here, before
// anything is read.
export function useFlowPage(): { area: Area; title: string; words: FlowWords } {
  return flowPage();
}
