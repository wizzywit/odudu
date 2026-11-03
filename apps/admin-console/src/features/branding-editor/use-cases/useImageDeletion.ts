import { useRefusal } from '#/entities/session';
import { useAssetDelete } from '#/features/branding-editor/repository/useThemeAssets';
import { deleteImageFailure } from '#/features/branding-editor/services/writeFailures';
import { writeCapability, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import type { ImageSlot } from '#/features/branding-editor/services/imageValues';
import { useConfirmedChange, type Confirming } from '#/shared/lib/use-cases/useConfirmedChange';

export interface ImageAsk {
  slot: ImageSlot;
  assetId: string;
}

// Deleting a stored image, behind a confirmation that says which themes still
// name it when they do.
export function useImageDeletion(
  tenant: string,
  scope: ThemeScope,
  onDeleted: (slot: ImageSlot, assetId: string) => void,
): Confirming<ImageAsk> {
  const refusal = useRefusal(tenant);
  const remove = useAssetDelete(tenant);
  return useConfirmedChange<ImageAsk, undefined>({
    refusal,
    capability: writeCapability(scope),
    change: { busy: remove.busy, run: (ask) => remove.run(ask.assetId) },
    failureText: deleteImageFailure,
    done: (ask) => {
      onDeleted(ask.slot, ask.assetId);
    },
  });
}
