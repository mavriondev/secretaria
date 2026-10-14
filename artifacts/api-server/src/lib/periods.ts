export const TIME_ZONE = "America/Sao_Paulo";
export type PeriodPreset = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "year_to_date" | "last_year" | "last_days" | "custom" | "completed_months" | "including_current_month" | "rolling_months";
export interface DateRange { startDate: string; endDate: string; label: string; comparisonMonths?: number }
export interface PeriodInput { preset: PeriodPreset; startDate?: string; endDate?: string; months?: number; /** last_days only: N days ending today, today included */ days?: number }

export function localToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (kind: string) => parts.find(p => p.type === kind)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Informe datas no formato AAAA-MM-DD.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Data inválida.");
  return value;
}
export function addDays(value: string, count: number): string {
  const date = new Date(`${assertDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function dateBr(value: string): string { return assertDate(value).split("-").reverse().join("/"); }
export function range(startDate: string, endDate: string, label?: string): DateRange {
  assertDate(startDate); assertDate(endDate);
  if (startDate > endDate) throw new Error("A data inicial não pode ser posterior à final.");
  if (dayCount(startDate, endDate) > 3660) throw new Error("Use um intervalo de no máximo dez anos.");
  return { startDate, endDate, label: label ?? `${dateBr(startDate)} a ${dateBr(endDate)}` };
}
export function dayCount(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}
export function resolvePeriod(input: PeriodInput, now = new Date()): DateRange {
  const today = localToday(now);
  const day = new Date(`${today}T00:00:00Z`);
  const monday = addDays(today, -((day.getUTCDay() + 6) % 7));
  switch (input.preset) {
    case "completed_months":
    case "including_current_month":
    case "rolling_months": {
      const count = input.months;
      if (!Number.isInteger(count) || count! < 1 || count! > 120) throw new Error("Informe entre um e cento e vinte meses.");
      const offset = input.preset === "including_current_month" ? count! - 1 : count!;
      const target = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - offset, 1));
      if (input.preset === "rolling_months") {
        const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        target.setUTCDate(Math.min(day.getUTCDate(), last));
      }
      const start = target.toISOString().slice(0, 10);
      const end = input.preset === "completed_months" ? addDays(`${today.slice(0, 7)}-01`, -1) : today;
      return { ...range(start, end, `${count} meses — ${dateBr(start)} a ${dateBr(end)}`), ...(input.preset === "rolling_months" ? {} : { comparisonMonths: count }) };
    }
    case "today": return range(today, today, "Hoje");
    case "yesterday": return range(addDays(today, -1), addDays(today, -1), "Ontem");
    case "this_week": return range(monday, today, "Esta semana até hoje");
    case "last_week": return range(addDays(monday, -7), addDays(monday, -1), "Semana passada");
    case "this_month": return { ...range(`${today.slice(0, 7)}-01`, today, "Este mês até hoje"), comparisonMonths: 1 };
    case "last_month": {
      const end = addDays(`${today.slice(0, 7)}-01`, -1);
      return { ...range(`${end.slice(0, 7)}-01`, end, "Mês passado"), comparisonMonths: 1 };
    }
    case "year_to_date": return { ...range(`${today.slice(0, 4)}-01-01`, today, "Ano até hoje"), comparisonMonths: 12 };
    case "last_year": { const year = Number(today.slice(0, 4)) - 1; return { ...range(`${year}-01-01`, `${year}-12-31`, "Ano passado"), comparisonMonths: 12 }; }
    case "last_days": {
      // "Últimos N dias" = N days ending today, today included (owner's rule); the answer states the dates so the manager can correct the reading.
      const count = input.days;
      if (!Number.isInteger(count) || count! < 1 || count! > 366) throw new Error("Informe entre um e trezentos e sessenta e seis dias.");
      const start = addDays(today, -(count! - 1));
      return range(start, today, `Últimos ${count} dias — ${dateBr(start)} a ${dateBr(today)}`);
    }
    case "custom":
      if (!input.startDate || !input.endDate) throw new Error("Informe as duas datas do intervalo.");
      return range(input.startDate, input.endDate);
    default: throw new Error("Período não suportado.");
  }
}
export function previousPeriod(period: DateRange): DateRange {
  const lastDay = (value: string) => new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0)).getUTCDate();
  const complete = period.startDate.endsWith("-01") && Number(period.endDate.slice(8)) === lastDay(period.endDate);
  const months = period.comparisonMonths ?? (complete
    ? (Number(period.endDate.slice(0, 4)) - Number(period.startDate.slice(0, 4))) * 12 + Number(period.endDate.slice(5, 7)) - Number(period.startDate.slice(5, 7)) + 1 : undefined);
  if (months) {
    const shift = (date: string) => {
      const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 - months, 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(Number(date.slice(8)), end));
      return d.toISOString().slice(0, 10);
    };
    const span = (Number(period.endDate.slice(0, 4)) - Number(period.startDate.slice(0, 4))) * 12 + Number(period.endDate.slice(5, 7)) - Number(period.startDate.slice(5, 7)) + 1;
    return range(shift(period.startDate), complete && span === months ? addDays(period.startDate, -1) : shift(period.endDate));
  }
  const end = addDays(period.startDate, -1);
  return range(addDays(end, -(dayCount(period.startDate, period.endDate) - 1)), end);
}

/** Same calendar interval one year earlier. Whole-month intervals stay whole months; 29 Feb falls back to the last day of February. */
export function yearAgoPeriod(period: DateRange): DateRange {
  const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  const shift = (date: string, keepMonthEnd: boolean) => {
    const year = Number(date.slice(0, 4)) - 1, month = Number(date.slice(5, 7));
    const day = keepMonthEnd ? monthEnd(year, month) : Math.min(Number(date.slice(8)), monthEnd(year, month));
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const endsMonth = Number(period.endDate.slice(8)) === monthEnd(Number(period.endDate.slice(0, 4)), Number(period.endDate.slice(5, 7)));
  return range(shift(period.startDate, false), shift(period.endDate, endsMonth && period.startDate.endsWith("-01")));
}

export function monthlySeries(period: DateRange, rows: Array<{ month: string; amount: number }>) {
  const values = new Map(rows.map(row => [row.month, row.amount]));
  const cursor = new Date(`${period.startDate.slice(0, 7)}-01T00:00:00Z`);
  const result: Array<{ month: string; amount: number }> = [];
  while (cursor.toISOString().slice(0, 7) <= period.endDate.slice(0, 7)) {
    const month = cursor.toISOString().slice(0, 7);
    result.push({ month, amount: values.get(month) ?? 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

export const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
