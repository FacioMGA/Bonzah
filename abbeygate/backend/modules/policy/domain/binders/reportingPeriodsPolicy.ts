export type ReportingPeriodRow = {
  binderId: string;
  year: number;
  month: number;
  startDate: Date;
  endDate: Date;
  status: 'OPEN';
};

export function buildReportingPeriods(
  binderId: string,
  startDate: Date,
  endDate: Date
): ReportingPeriodRow[] {
  const periods: ReportingPeriodRow[] = [];
  const cursor = new Date(startDate);
  const stop = new Date(endDate);

  while (cursor <= stop) {
    periods.push({
      binderId,
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
      startDate: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      endDate: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
      status: 'OPEN',
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return periods;
}
