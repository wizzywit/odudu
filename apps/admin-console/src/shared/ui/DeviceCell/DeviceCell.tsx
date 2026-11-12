import { CopyValue } from '#/shared/ui/CopyValue';

const NOT_RECORDED = '—';

// The browser a session was opened on, as an opaque id: sessions that show
// the same one were opened on the same browser. A session opened before the
// id was recorded shows a dash.
export function DeviceCell({ device }: { device: string | null }) {
  return device === null ? NOT_RECORDED : <CopyValue label="device id" value={device} short />;
}
