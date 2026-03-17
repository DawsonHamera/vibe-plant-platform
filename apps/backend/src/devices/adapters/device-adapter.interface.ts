export type ConnectionType = "serial" | "network" | "bluetooth";

export type AdapterTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};

export interface DeviceAdapter {
  readonly type: ConnectionType;
  discover(): Promise<string[]>;
  test(target: string): Promise<AdapterTestResult>;
}
