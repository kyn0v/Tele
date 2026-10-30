import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogue, catalogueEntries, notesFor, startFretFor, stringsFor, type ChordSymbol } from '../src/music.js';
import { ContentSchema } from '../src/schema.js';

const expected = {
  D: [50, 57, 62, 66], G: [43, 47, 50, 55, 59, 67], Gm: [43, 50, 55, 58, 62, 67],
  Em: [40, 47, 52, 55, 59, 64], A: [45, 52, 57, 61, 64], C: [48, 52, 55, 60, 64],
  Am: [45, 52, 57, 60, 64], F: [41, 48, 53, 57, 60, 65], Bm: [47, 54, 59, 62, 66],
  A7: [45, 52, 55, 61, 64], Dm: [50, 57, 62, 65], E: [40, 47, 52, 56, 59, 64],
  E7: [40, 47, 50, 56, 59, 64], G7: [43, 47, 50, 55, 59, 65],
} satisfies Record<ChordSymbol, number[]>;
const pitchNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

test('every advertised voicing has independently specified MIDI notes and valid spelled pitches', () => {
  for (const { symbol, strings } of catalogueEntries()) {
    assert.deepEqual(notesFor(symbol), expected[symbol], symbol);
    for (const string of strings) {
      if (string.midi === null) { assert.equal(string.pitch, '×'); continue; }
      const pitchClass = pitchNames.indexOf(string.pitch.slice(0, -1));
      assert.equal(pitchClass, string.midi % 12, `${symbol} ${string.pitch}`);
      assert.equal(Number(string.pitch.at(-1)), Math.floor(string.midi / 12) - 1);
    }
  }
  assert.deepEqual(catalogue.D.frets, [null, null, 0, 2, 3, 2]);
  assert.deepEqual(catalogue.Gm.frets, [3, 5, 5, 3, 3, 3]);
  assert.equal(startFretFor('Gm'), 3);
  assert.equal(startFretFor('Bm'), 1);
  assert.deepEqual(stringsFor('D').map(string => string.pitch), ['×', '×', 'D3', 'A3', 'D4', 'F♯4']);
  assert.equal(stringsFor('Gm')[3]?.pitch, 'B♭3');
});

test('content schema defaults tempo and rejects unknown, ambiguous, or unbounded input', () => {
  const valid = { title: 'Board', groups: [{ id: 'a', title: 'A', chords: ['D', 'G', 'D'] }] };
  assert.equal(ContentSchema.parse(valid).tempo, 90);
  for (const bad of [
    { ...valid, extra: true }, { ...valid, tempo: 0 }, { ...valid, title: 'x'.repeat(121) },
    { ...valid, groups: [] }, { ...valid, groups: Array(13).fill(valid.groups[0]) },
    { ...valid, groups: [valid.groups[0], valid.groups[0]] },
    { ...valid, groups: [{ id: 'a', title: 'A', chords: ['H'] }] },
    { ...valid, groups: [{ id: 'a', title: 'A', chords: Array(33).fill('D') }] },
    { ...valid, groups: [{ id: '../a', title: 'A', chords: ['D'] }] },
  ]) assert.equal(ContentSchema.safeParse(bad).success, false);
});
