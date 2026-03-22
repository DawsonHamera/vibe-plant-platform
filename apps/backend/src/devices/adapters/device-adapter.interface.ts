export type ConnectionType = "serial" | "network" | "bluetooth";

export type AdapterTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};

export type AdapterChannelProbeResult = {
  ok: boolean;
  channels: string[];
  message: string;
  sample?: string;
};

export interface DeviceAdapter {
  readonly type: ConnectionType;
  discover(): Promise<string[]>;
  test(target: string): Promise<AdapterTestResult>;
  probeChannels(target: string): Promise<AdapterChannelProbeResult>;
}
