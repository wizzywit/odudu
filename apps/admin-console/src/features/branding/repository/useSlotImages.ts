import { readAssetImage } from '#/features/branding/adapter/theme';
import {
  slotThumbnail,
  type ImageSlot,
  type SlotAsk,
  type Thumbnail,
} from '#/features/branding/service';
import { assetImageKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import { useTransport } from '#/shared/transport/useTransport';

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
