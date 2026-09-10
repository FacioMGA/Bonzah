export type PerfBucket = {
  name: string;
  durMs: number;
  desc?: string;
};

export type PerfTimings = {
  add: (name: string, durMs: number, desc?: string) => void;
  start: (name: string, desc?: string) => () => void;
  snapshot: () => PerfBucket[];
};
