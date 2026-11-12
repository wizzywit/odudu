import { CopyValue } from '#/shared/ui/CopyValue';

const NOT_RECORDED = '—';

// The browser a session was opened on, as an opaque id: sessions that show
// the same one were opened on the same browser, and `caption` says how many
// of the listed ones. A session opened before the id was recorded shows a dash.
export function DeviceCell({
  device,
  caption = null,
}: {
  device: string | null;
  caption?: string | null;
}) {
  if (device === null) return NOT_RECORDED;
  return (
    <>
      <CopyValue label="device id" value={device} short />
      {caption === null ? null : <small>{caption}</small>}
    </>
  );
}
