import { z } from 'zod';

export type Frets = readonly [number | null, number | null, number | null, number | null, number | null, number | null];
type Voicing = { frets: Frets; spelling: Readonly<Record<number, string>> };

export const catalogue = {
  D: { frets: [null, null, 0, 2, 3, 2], spelling: { 2: 'D', 6: 'F♯', 9: 'A' } },
  G: { frets: [3, 2, 0, 0, 0, 3], spelling: { 7: 'G', 11: 'B', 2: 'D' } },
  Gm: { frets: [3, 5, 5, 3, 3, 3], spelling: { 7: 'G', 10: 'B♭', 2: 'D' } },
  Em: { frets: [0, 2, 2, 0, 0, 0], spelling: { 4: 'E', 7: 'G', 11: 'B' } },
  A: { frets: [null, 0, 2, 2, 2, 0], spelling: { 9: 'A', 1: 'C♯', 4: 'E' } },
  C: { frets: [null, 3, 2, 0, 1, 0], spelling: { 0: 'C', 4: 'E', 7: 'G' } },
  Am: { frets: [null, 0, 2, 2, 1, 0], spelling: { 9: 'A', 0: 'C', 4: 'E' } },
  F: { frets: [1, 3, 3, 2, 1, 1], spelling: { 5: 'F', 9: 'A', 0: 'C' } },
  Bm: { frets: [null, 2, 4, 4, 3, 2], spelling: { 11: 'B', 2: 'D', 6: 'F♯' } },
  A7: { frets: [null, 0, 2, 0, 2, 0], spelling: { 9: 'A', 1: 'C♯', 4: 'E', 7: 'G' } },
  Dm: { frets: [null, null, 0, 2, 3, 1], spelling: { 2: 'D', 5: 'F', 9: 'A' } },
  E: { frets: [0, 2, 2, 1, 0, 0], spelling: { 4: 'E', 8: 'G♯', 11: 'B' } },
  E7: { frets: [0, 2, 0, 1, 0, 0], spelling: { 4: 'E', 8: 'G♯', 11: 'B', 2: 'D' } },
  G7: { frets: [3, 2, 0, 0, 0, 1], spelling: { 7: 'G', 11: 'B', 2: 'D', 5: 'F' } },
} satisfies Record<string, Voicing>;

const symbols = Object.keys(catalogue).filter((key): key is keyof typeof catalogue => Object.hasOwn(catalogue, key));
export const ChordSymbolSchema = z.enum(symbols);
export type ChordSymbol = z.infer<typeof ChordSymbolSchema>;
export const standardTuning = [40, 45, 50, 55, 59, 64] satisfies readonly number[];

export function stringsFor(symbol: ChordSymbol) {
  const voicing: Voicing = catalogue[symbol];
  return voicing.frets.map((fret, index) => {
    const openMidi = standardTuning[index];
    if (openMidi === undefined) throw new Error('Missing standard tuning string');
    if (fret === null) return { fret, midi: null, pitch: '×' };
    const midi = openMidi + fret;
    const name = voicing.spelling[midi % 12];
    if (!name) throw new Error(`Missing pitch spelling for ${symbol}`);
    return { fret, midi, pitch: `${name}${Math.floor(midi / 12) - 1}` };
  });
}

export function notesFor(symbol: ChordSymbol): number[] {
  return stringsFor(symbol).flatMap(({ midi }) => midi === null ? [] : [midi]);
}

export function startFretFor(symbol: ChordSymbol): number {
  const frets: Frets = catalogue[symbol].frets;
  const pressed = frets.flatMap(fret => fret !== null && fret > 0 ? [fret] : []);
  return Math.max(...pressed) <= 4 ? 1 : Math.min(...pressed);
}

export function catalogueEntries() {
  return ChordSymbolSchema.options.map(symbol => ({
    symbol, frets: catalogue[symbol].frets, startFret: startFretFor(symbol), strings: stringsFor(symbol),
  }));
}
