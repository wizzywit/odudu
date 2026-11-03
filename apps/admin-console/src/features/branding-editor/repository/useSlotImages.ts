import { readAssetImage } from '#/features/branding-editor/adapter/themeAssets';
import {
  slotThumbnail,
  type SlotAsk,
  type Thumbnail,
} from '#/features/branding-editor/services/imageThumbnails';
import type { ImageSlot } from '#/features/branding-editor/services/imageValues';
import { assetImageKey } from '#/shared/lib/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import { useTransport } from '#/shared/api/transport/useTransport';

function useThumbnail(tenant: string, { id, asked }: SlotAsk): Thumbnail {
  const { gateway } = useTransport();
  const read = useRead(
    assetImageKey(tenant, id),
    asked,
    () => readAssetImage(gateway, tenant, id),
    {
      immutable: true,
    },
  );
  return slotThumbnail(asked, read);
}

// The image each slot holds, read from the server, so that an upload shows
// before any theme publishes it and a reload shows what was saved.
export function useSlotImages(
  tenant: string,
  asks: Record<ImageSlot, SlotAsk>,
): Record<ImageSlot, Thumbnail> {
  return {
    logo: useThumbnail(tenant, asks.logo),
    darkLogo: useThumbnail(tenant, asks.darkLogo),
    favicon: useThumbnail(tenant, asks.favicon),
    background: useThumbnail(tenant, asks.background),
  };
}
