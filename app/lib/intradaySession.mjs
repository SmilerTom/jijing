import lodash from 'lodash';

const { isArray } = lodash;

export const TRADING_SESSION_TICKS = ['09:30', '11:30', '13:00', '15:00'];

const MORNING_OPEN = 9 * 60 + 30;
const MORNING_CLOSE = 11 * 60 + 30;
const AFTERNOON_OPEN = 13 * 60;
const AFTERNOON_CLOSE = 15 * 60;

const toLabel = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

export function buildTradingSessionLabels() {
  const labels = [];
  for (let mins = MORNING_OPEN; mins <= MORNING_CLOSE; mins += 1) labels.push(toLabel(mins));
  for (let mins = AFTERNOON_OPEN; mins <= AFTERNOON_CLOSE; mins += 1) labels.push(toLabel(mins));
  return labels;
}

export function parseSessionMinutes(time) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function clampToSessionMinutes(mins) {
  if (!Number.isFinite(mins)) return null;
  if (mins < MORNING_OPEN) return MORNING_OPEN;
  if (mins <= MORNING_CLOSE) return mins;
  if (mins < AFTERNOON_OPEN) return MORNING_CLOSE;
  if (mins <= AFTERNOON_CLOSE) return mins;
  return AFTERNOON_CLOSE;
}

export function alignValuationSeriesToSession(series) {
  const labels = buildTradingSessionLabels();
  const indexByLabel = new Map(labels.map((label, index) => [label, index]));
  const values = labels.map(() => null);
  if (!isArray(series)) return { labels, values };
  for (const point of series) {
    const slot = clampToSessionMinutes(parseSessionMinutes(point?.time));
    if (slot == null) continue;
    const index = indexByLabel.get(toLabel(slot));
    const value = Number(point?.value);
    if (index == null || !Number.isFinite(value)) continue;
    values[index] = value;
  }
  return { labels, values };
}
