export function formatDeviceIdShort(deviceId: string, visible = 12): string {
  if (!deviceId) return "unknown";
  if (deviceId.length <= visible) return deviceId;
  return `${deviceId.slice(0, visible)}…`;
}
