import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Music, Music2, Guitar, Headphones, Timer, Play, Pause, Mic, MicOff, Check, X, RotateCcw } from 'lucide-react';

/* ---------- music theory + audio utilities ---------- */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiFromNote(note, octave) {
  return (octave + 1) * 12 + NOTE_NAMES.indexOf(note);
}
function noteFromMidi(midi) {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { note, octave };
}
function freqFromMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function midiFromFreq(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

// Autocorrelation pitch detector (ACF2+), returns Hz or -1 if no clear pitch
function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
  const trimmed = buf.slice(r1, r2);
  const n = trimmed.length;
  if (n < 8) return -1;

  const c = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i; j++) c[i] += trimmed[j] * trimmed[j + i];
  }
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxVal = -1, maxPos = -1;
  for (let i = d; i < n; i++) { if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; } }
  if (maxPos <= 0) return -1;

  let T0 = maxPos;
  const x1 = c[T0 - 1] || 0, x2 = c[T0] || 0, x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);
  return T0 > 0 ? sampleRate / T0 : -1;
}

function playTone(freq, duration = 0.9) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.05);
  osc.onended = () => ctx.close();
}

function playClick(accent = false) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1500 : 950;
  gain.gain.setValueAtTime(0.35, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.06);
  osc.onended = () => ctx.close();
}

/* ---------- scale data ---------- */

const SCALES = {
  piano: {
    beginner: {
      'C Major': [['C', 4], ['D', 4], ['E', 4], ['F', 4], ['G', 4], ['A', 4], ['B', 4], ['C', 5]],
      'G Major': [['G', 3], ['A', 3], ['B', 3], ['C', 4], ['D', 4], ['E', 4], ['F#', 4], ['G', 4]],
      'A Minor Pentatonic': [['A', 3], ['C', 4], ['D', 4], ['E', 4], ['G', 4], ['A', 4]],
    },
    advanced: {
      'D Major': [['D', 4], ['E', 4], ['F#', 4], ['G', 4], ['A', 4], ['B', 4], ['C#', 5], ['D', 5]],
      'E Natural Minor': [['E', 4], ['F#', 4], ['G', 4], ['A', 4], ['B', 4], ['C', 5], ['D', 5], ['E', 5]],
      'A Harmonic Minor': [['A', 3], ['B', 3], ['C', 4], ['D', 4], ['E', 4], ['F', 4], ['G#', 4], ['A', 4]],
      'C Blues': [['C', 4], ['D#', 4], ['F', 4], ['F#', 4], ['G', 4], ['A#', 4], ['C', 5]],
      'C Chromatic': [['C', 4], ['C#', 4], ['D', 4], ['D#', 4], ['E', 4], ['F', 4], ['F#', 4], ['G', 4], ['G#', 4], ['A', 4], ['A#', 4], ['B', 4], ['C', 5]],
    },
  },
  guitar: {
    beginner: {
      'E Minor Pentatonic (open)': [['E', 2], ['G', 2], ['A', 2], ['B', 2], ['D', 3], ['E', 3]],
      'A Minor Pentatonic (open)': [['A', 2], ['C', 3], ['D', 3], ['E', 3], ['G', 3], ['A', 3]],
      'C Major (open)': [['C', 3], ['D', 3], ['E', 3], ['F', 3], ['G', 3], ['A', 3], ['B', 3], ['C', 4]],
    },
    advanced: {
      'G Major (open)': [['G', 3], ['A', 3], ['B', 3], ['C', 4], ['D', 4], ['E', 4], ['F#', 4], ['G', 4]],
      'D Major (open)': [['D', 3], ['E', 3], ['F#', 3], ['G', 3], ['A', 3], ['B', 3], ['C#', 4], ['D', 4]],
      'A Minor Natural (open)': [['A', 2], ['B', 2], ['C', 3], ['D', 3], ['E', 3], ['F', 3], ['G', 3], ['A', 3]],
      'E Blues (open)': [['E', 2], ['G', 2], ['A', 2], ['A#', 2], ['B', 2], ['D', 3], ['E', 3]],
    },
  },
};

const EAR_RANGES = {
  piano: { low: midiFromNote('C', 4), high: midiFromNote('C', 5) },
  guitar: { low: midiFromNote('E', 2), high: midiFromNote('E', 4) },
};

/* ---------- chord data ---------- */

const CHORDS = {
  C: { root: 'C', quality: 'major' },
  D: { root: 'D', quality: 'major' },
  E: { root: 'E', quality: 'major' },
  F: { root: 'F', quality: 'major' },
  G: { root: 'G', quality: 'major' },
  A: { root: 'A', quality: 'major' },
  Am: { root: 'A', quality: 'minor' },
  Em: { root: 'E', quality: 'minor' },
  Dm: { root: 'D', quality: 'minor' },
};

// low E, A, D, G, B, high e — 'x' muted, '0' open, else fret number
const GUITAR_SHAPES = {
  C: ['x', '3', '2', '0', '1', '0'],
  D: ['x', 'x', '0', '2', '3', '2'],
  E: ['0', '2', '2', '1', '0', '0'],
  F: ['1', '3', '3', '2', '1', '1'],
  G: ['3', '2', '0', '0', '0', '3'],
  A: ['x', '0', '2', '2', '2', '0'],
  Am: ['x', '0', '2', '2', '1', '0'],
  Em: ['0', '2', '2', '0', '0', '0'],
  Dm: ['x', 'x', '0', '2', '3', '1'],
};

const PROGRESSIONS = {
  'I–IV–V–I in C': ['C', 'F', 'G', 'C'],
  'I–V–vi–IV in G (pop)': ['G', 'D', 'Em', 'C'],
  'vi–IV–I–V in C (pop)': ['Am', 'F', 'C', 'G'],
  'ii–V–I in C (jazz-ish)': ['Dm', 'G', 'C'],
  'I–IV–I–V in A': ['A', 'D', 'A', 'E'],
};

function pianoChordMidis(chordName, baseOctave = 4) {
  const { root, quality } = CHORDS[chordName];
  const rootMidi = midiFromNote(root, baseOctave);
  const third = quality === 'minor' ? rootMidi + 3 : rootMidi + 4;
  const fifth = rootMidi + 7;
  return [rootMidi, third, fifth];
}

/* ---------- visual: piano keyboard ---------- */

function PianoKeyboard({ targetMidi, playedMidi, correct, chordMidis }) {
  const lowMidi = midiFromNote('C', 3);
  const highMidi = midiFromNote('C', 5);
  const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];
  const prevWhiteSemitone = { 1: 0, 3: 2, 6: 5, 8: 7, 10: 9 };

  const keys = [];
  for (let m = lowMidi; m <= highMidi; m++) {
    const semitone = ((m % 12) + 12) % 12;
    keys.push({ midi: m, semitone, isWhite: whiteOffsets.includes(semitone) });
  }
  const whiteKeys = keys.filter(k => k.isWhite);
  const blackKeys = keys.filter(k => !k.isWhite);
  const whiteIndexByMidi = {};
  whiteKeys.forEach((k, i) => { whiteIndexByMidi[k.midi] = i; });

  const WKW = 40, WKH = 160, BKW = 24, BKH = 100;
  const totalWidth = whiteKeys.length * WKW;

  const colorFor = (midi) => {
    if (chordMidis && chordMidis.length) {
      return chordMidis.includes(midi) ? 'var(--brass)' : null;
    }
    const isTarget = midi === targetMidi;
    const isPlayed = midi === playedMidi;
    if (isTarget && isPlayed) return correct ? 'var(--felt)' : 'var(--brass)';
    if (isTarget) return 'var(--brass)';
    if (isPlayed) return 'var(--felt)';
    return null;
  };

  return (
    <svg viewBox={`0 0 ${totalWidth} ${WKH}`} className="keyboard-svg" preserveAspectRatio="xMidYMid meet">
      {whiteKeys.map((k, i) => (
        <rect key={k.midi} x={i * WKW} y={0} width={WKW - 1} height={WKH}
          fill={colorFor(k.midi) || 'var(--ivory)'} stroke="var(--wood-dark)" strokeWidth="1" rx="2" />
      ))}
      {blackKeys.map((k) => {
        const prevSemitone = prevWhiteSemitone[k.semitone];
        const prevMidi = k.midi - (k.semitone - prevSemitone);
        const idx = whiteIndexByMidi[prevMidi];
        if (idx === undefined) return null;
        const x = idx * WKW + WKW - BKW / 2;
        return (
          <rect key={k.midi} x={x} y={0} width={BKW} height={BKH}
            fill={colorFor(k.midi) || 'var(--ebony)'} rx="2" />
        );
      })}
    </svg>
  );
}

/* ---------- visual: guitar fretboard ---------- */

const TUNING = [
  { note: 'E', octave: 2 }, { note: 'A', octave: 2 }, { note: 'D', octave: 3 },
  { note: 'G', octave: 3 }, { note: 'B', octave: 3 }, { note: 'E', octave: 4 },
];
const NUM_FRETS = 7;

function findFretPositions(midi) {
  const positions = [];
  TUNING.forEach((t, sIdx) => {
    const openMidi = midiFromNote(t.note, t.octave);
    for (let f = 0; f <= NUM_FRETS; f++) {
      if (openMidi + f === midi) positions.push({ string: sIdx, fret: f });
    }
  });
  return positions;
}

function Fretboard({ targetMidi, playedMidi, correct }) {
  const targetPositions = targetMidi != null ? findFretPositions(targetMidi) : [];
  const playedPositions = playedMidi != null ? findFretPositions(playedMidi) : [];
  const rowH = 30, colW = 48, marginLeft = 36, top = 12;
  const width = marginLeft + (NUM_FRETS + 1) * colW;
  const height = top + rowH * 5 + 24;
  const dotFrets = [3, 5, 7];

  const xForFret = (f) => (f === 0 ? marginLeft - 16 : marginLeft + (f - 0.5) * colW);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="fretboard-svg" preserveAspectRatio="xMidYMid meet">
      <rect x={marginLeft} y={top} width={4} height={rowH * 5} fill="var(--ivory)" />
      {TUNING.map((t, i) => (
        <line key={i} x1={marginLeft} x2={width} y1={top + i * rowH} y2={top + i * rowH}
          stroke="var(--brass-dim)" strokeWidth={1 + (5 - i) * 0.25} />
      ))}
      {Array.from({ length: NUM_FRETS + 1 }).map((_, f) => (
        <line key={f} x1={marginLeft + f * colW} x2={marginLeft + f * colW} y1={top} y2={top + rowH * 5}
          stroke="var(--wood-dark)" strokeWidth={f === 0 ? 0 : 1.5} />
      ))}
      {dotFrets.map(f => (
        <circle key={f} cx={marginLeft + (f - 0.5) * colW} cy={top + rowH * 5 + 12} r={4} fill="var(--text-dim)" />
      ))}
      {TUNING.map((t, i) => (
        <text key={i} x={marginLeft - 26} y={top + i * rowH + 4} fontSize="12" fill="var(--text-dim)" textAnchor="middle">{t.note}</text>
      ))}
      {targetPositions.map((p, idx) => {
        const isAlsoPlayed = playedPositions.some(pp => pp.string === p.string && pp.fret === p.fret);
        return (
          <circle key={'t' + idx} cx={xForFret(p.fret)} cy={top + p.string * rowH} r={10}
            fill={isAlsoPlayed ? (correct ? 'var(--felt)' : 'var(--brass)') : 'var(--brass)'}
            opacity={isAlsoPlayed ? 1 : 0.85} />
        );
      })}
      {playedPositions
        .filter(p => !targetPositions.some(tp => tp.string === p.string && tp.fret === p.fret))
        .map((p, idx) => (
          <circle key={'p' + idx} cx={xForFret(p.fret)} cy={top + p.string * rowH} r={8} fill="var(--felt)" opacity={0.9} />
        ))}
    </svg>
  );
}

/* ---------- visual: chord diagram (guitar) ---------- */

function ChordDiagram({ shape }) {
  const numFrets = 4;
  const stringGap = 26, fretGap = 30, marginTop = 28, marginLeft = 16;
  const width = marginLeft * 2 + stringGap * 5;
  const height = marginTop + fretGap * numFrets + 6;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chord-diagram-svg" preserveAspectRatio="xMidYMid meet">
      <rect x={marginLeft} y={marginTop} width={stringGap * 5} height={4} fill="var(--ivory)" />
      {shape.map((_, i) => (
        <line key={i} x1={marginLeft + i * stringGap} x2={marginLeft + i * stringGap}
          y1={marginTop} y2={marginTop + fretGap * numFrets} stroke="var(--brass-dim)" strokeWidth="1.5" />
      ))}
      {Array.from({ length: numFrets + 1 }).map((_, f) => (
        <line key={f} x1={marginLeft} x2={marginLeft + stringGap * 5}
          y1={marginTop + f * fretGap} y2={marginTop + f * fretGap} stroke="var(--wood-dark)" strokeWidth="1" />
      ))}
      {shape.map((s, i) => {
        const x = marginLeft + i * stringGap;
        if (s === 'x') return <text key={'m' + i} x={x} y={marginTop - 12} fontSize="14" fill="var(--error)" textAnchor="middle">×</text>;
        if (s === '0') return <circle key={'o' + i} cx={x} cy={marginTop - 14} r={5} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" />;
        return null;
      })}
      {shape.map((s, i) => {
        const f = parseInt(s, 10);
        if (!f) return null;
        const x = marginLeft + i * stringGap;
        const cy = marginTop + (f - 0.5) * fretGap;
        return <circle key={'f' + i} cx={x} cy={cy} r={9} fill="var(--brass)" />;
      })}
    </svg>
  );
}

/* ---------- chord practice ---------- */

function ChordPractice({ instrument }) {
  const progressionNames = Object.keys(PROGRESSIONS);
  const [progName, setProgName] = useState(progressionNames[0]);
  const [beatsPerChord, setBeatsPerChord] = useState(4);
  const [bpm, setBpm] = useState(80);
  const [playing, setPlaying] = useState(false);
  const [chordIndex, setChordIndex] = useState(0);
  const [beat, setBeat] = useState(0);

  const progression = PROGRESSIONS[progName];
  const currentChord = progression[chordIndex];

  useEffect(() => { setChordIndex(0); setBeat(0); }, [progName]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setBeat(b => {
        const nb = (b + 1) % beatsPerChord;
        playClick(nb === 0);
        if (nb === 0) setChordIndex(ci => (ci + 1) % progression.length);
        return nb;
      });
    }, 60000 / bpm);
    return () => clearInterval(id);
  }, [playing, bpm, beatsPerChord, progression.length]);

  return (
    <div className="tool-panel">
      <div className="panel-header">
        <select value={progName} onChange={e => setProgName(e.target.value)}>
          {progressionNames.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={beatsPerChord} onChange={e => setBeatsPerChord(Number(e.target.value))}>
          <option value={2}>2 beats / chord</option>
          <option value={4}>4 beats / chord</option>
          <option value={8}>8 beats / chord</option>
        </select>
      </div>

      <div className="tuner">
        <div className="tuner-note">{currentChord}</div>
        <div className="tuner-sub">beat {beat + 1} of {beatsPerChord}</div>
      </div>

      <div className="chord-diagram-wrap">
        {instrument === 'guitar'
          ? <ChordDiagram shape={GUITAR_SHAPES[currentChord]} />
          : <PianoKeyboard chordMidis={pianoChordMidis(currentChord)} />}
      </div>

      <div className="chord-sequence">
        {progression.map((c, i) => (
          <span key={i} className={`chord-chip ${i === chordIndex ? 'current' : ''}`}>{c}</span>
        ))}
      </div>

      <input type="range" min={40} max={208} value={bpm} onChange={e => setBpm(Number(e.target.value))} />
      <div className="metronome-controls">
        <button onClick={() => setPlaying(p => !p)}>
          {playing ? <><Pause size={16} /> Stop</> : <><Play size={16} /> Start</>}
        </button>
        <span className="score">{bpm} BPM</span>
        <button onClick={() => { setChordIndex(ci => (ci - 1 + progression.length) % progression.length); setBeat(0); }}>Prev chord</button>
        <button onClick={() => { setChordIndex(ci => (ci + 1) % progression.length); setBeat(0); }}>Next chord</button>
      </div>
    </div>
  );
}

/* ---------- note trainer ---------- */

function NoteTrainer({ instrument, micOn, micError, detected, startMic, stopMic }) {
  const groups = SCALES[instrument];
  const allScales = { ...groups.beginner, ...groups.advanced };
  const [scaleName, setScaleName] = useState(Object.keys(groups.beginner)[0]);

  useEffect(() => {
    setScaleName(Object.keys(SCALES[instrument].beginner)[0]);
  }, [instrument]);

  const [index, setIndex] = useState(0);
  const [justMatched, setJustMatched] = useState(false);

  useEffect(() => { setIndex(0); setJustMatched(false); }, [scaleName, instrument]);

  const sequence = allScales[scaleName];
  const target = sequence[index];
  const targetMidi = target ? midiFromNote(target[0], target[1]) : null;
  const playedMidi = detected ? midiFromNote(detected.note, detected.octave) : null;
  const isCorrect = targetMidi != null && playedMidi === targetMidi;
  const atEnd = index === sequence.length - 1;

  useEffect(() => {
    if (isCorrect && !justMatched) {
      setJustMatched(true);
      if (!atEnd) {
        const t = setTimeout(() => { setIndex(i => i + 1); setJustMatched(false); }, 450);
        return () => clearTimeout(t);
      }
    }
    if (!isCorrect) setJustMatched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCorrect]);

  const done = atEnd && isCorrect;

  return (
    <div className="tool-panel">
      <div className="panel-header">
        <select value={scaleName} onChange={e => setScaleName(e.target.value)}>
          <optgroup label="Beginner">
            {Object.keys(groups.beginner).map(s => <option key={s} value={s}>{s}</option>)}
          </optgroup>
          <optgroup label="Advanced">
            {Object.keys(groups.advanced).map(s => <option key={s} value={s}>{s}</option>)}
          </optgroup>
        </select>
        <button className="mic-btn" onClick={micOn ? stopMic : startMic}>
          {micOn ? <><MicOff size={16} /> Stop mic</> : <><Mic size={16} /> Start mic</>}
        </button>
      </div>

      {micError && <p className="error-text">{micError}</p>}

      <div className="tuner">
        <div className="tuner-note">{target ? `${target[0]}${target[1]}` : '—'}</div>
        <div className="tuner-sub">
          {detected
            ? `hearing ${detected.note}${detected.octave} · ${detected.cents > 0 ? '+' : ''}${detected.cents}¢`
            : micOn ? 'listening…' : `play this note on your ${instrument} once the mic is on`}
        </div>
      </div>

      {instrument === 'piano'
        ? <PianoKeyboard targetMidi={targetMidi} playedMidi={playedMidi} correct={isCorrect} />
        : <Fretboard targetMidi={targetMidi} playedMidi={playedMidi} correct={isCorrect} />}

      <div className="progress">
        {sequence.map((_, i) => (
          <span key={i} className={`dot ${i < index || (i === index && justMatched) ? 'done' : i === index ? 'current' : ''}`} />
        ))}
      </div>

      {done && (
        <p className="success-text">
          Scale complete — nice work.
          <button className="link-btn" onClick={() => { setIndex(0); setJustMatched(false); }}><RotateCcw size={14} /> Replay</button>
        </p>
      )}
    </div>
  );
}

/* ---------- ear trainer ---------- */

function EarTrainer({ instrument }) {
  const range = EAR_RANGES[instrument];
  const [target, setTarget] = useState(null);
  const [choices, setChoices] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const newRound = useCallback(() => {
    const span = range.high - range.low;
    const t = range.low + Math.floor(Math.random() * (span + 1));
    const distractors = new Set();
    while (distractors.size < 3) {
      const d = range.low + Math.floor(Math.random() * (span + 1));
      if (d !== t) distractors.add(d);
    }
    setTarget(t);
    setChoices([t, ...distractors].sort(() => Math.random() - 0.5));
    setFeedback(null);
  }, [range]);

  useEffect(() => { newRound(); }, [instrument, newRound]);

  const guess = (m) => {
    const correct = m === target;
    setFeedback(correct ? 'correct' : 'wrong');
    setScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
  };

  return (
    <div className="tool-panel">
      <div className="panel-header">
        <span className="score">{score.right} / {score.total} correct</span>
        <button onClick={() => target != null && playTone(freqFromMidi(target))}><Play size={16} /> Play note</button>
      </div>

      <div className="ear-choices">
        {choices.map(m => {
          const { note, octave } = noteFromMidi(m);
          const isTarget = m === target;
          return (
            <button
              key={m}
              disabled={!!feedback}
              className={`choice-btn ${feedback && isTarget ? 'correct' : ''}`}
              onClick={() => guess(m)}
            >
              {note}{octave}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className={`feedback ${feedback}`}>
          {feedback === 'correct' ? <><Check size={18} /> Correct.</> : <><X size={18} /> Not quite.</>}
          <button className="link-btn" onClick={newRound}>Next note</button>
        </div>
      )}
    </div>
  );
}

/* ---------- metronome ---------- */

function Metronome() {
  const [bpm, setBpm] = useState(90);
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(0);
  const tapTimes = useRef([]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setBeat(b => { const nb = (b + 1) % 4; playClick(nb === 0); return nb; });
    }, 60000 / bpm);
    return () => clearInterval(id);
  }, [playing, bpm]);

  const tap = () => {
    const now = performance.now();
    tapTimes.current = tapTimes.current.filter(t => now - t < 2000).concat(now);
    if (tapTimes.current.length >= 2) {
      const gaps = [];
      for (let i = 1; i < tapTimes.current.length; i++) gaps.push(tapTimes.current[i] - tapTimes.current[i - 1]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      setBpm(Math.max(40, Math.min(208, Math.round(60000 / avg))));
    }
  };

  return (
    <div className="tool-panel">
      <div className="metronome-display">
        <div className="pendulum-track">
          <div className="pendulum" style={{
            transform: `rotate(${beat % 2 === 0 ? -24 : 24}deg)`,
            transitionDuration: `${60000 / bpm}ms`,
          }} />
        </div>
        <div className="bpm-value">{bpm}<span> BPM</span></div>
      </div>
      <input type="range" min={40} max={208} value={bpm} onChange={e => setBpm(Number(e.target.value))} />
      <div className="metronome-controls">
        <button onClick={() => setPlaying(p => !p)}>
          {playing ? <><Pause size={16} /> Stop</> : <><Play size={16} /> Start</>}
        </button>
        <button onClick={tap}>Tap tempo</button>
      </div>
    </div>
  );
}

/* ---------- app shell ---------- */

export default function Woodshed() {
  const [instrument, setInstrument] = useState('piano');
  const [tool, setTool] = useState('trainer');
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState(null);
  const [detected, setDetected] = useState(null);

  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);

  const stopMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    audioCtxRef.current = null;
    streamRef.current = null;
    setMicOn(false);
    setDetected(null);
  }, []);

  const startMic = useCallback(async () => {
    try {
      setMicError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      setMicOn(true);

      const buf = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, ctx.sampleRate);
        if (freq > 60 && freq < 1500) {
          const midiExact = midiFromFreq(freq);
          const midiRounded = Math.round(midiExact);
          const { note, octave } = noteFromMidi(midiRounded);
          setDetected({ note, octave, cents: Math.round((midiExact - midiRounded) * 100), freq });
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      setMicError('Microphone access was blocked. Allow the mic permission in your browser to use live pitch detection.');
    }
  }, []);

  useEffect(() => () => stopMic(), [stopMic]);

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Space+Grotesk:wght@400;500;600&display=swap');

        :root {
          --bg: #1c140f;
          --panel: #241a13;
          --panel-2: #2f2118;
          --brass: #c9a24b;
          --brass-dim: #8a713a;
          --felt: #4f7d68;
          --ivory: #f3ead9;
          --ebony: #17110d;
          --wood-dark: #0f0a07;
          --text: #f3ead9;
          --text-dim: #a99783;
          --error: #c46a52;
        }

        * { box-sizing: border-box; }

        .app {
          display: flex;
          min-height: 640px;
          background: var(--bg);
          color: var(--text);
          font-family: 'Space Grotesk', sans-serif;
        }

        .rail {
          width: 210px;
          flex-shrink: 0;
          background: var(--panel);
          border-right: 1px solid var(--brass-dim);
          padding: 24px 16px;
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        .brand {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 22px;
          color: var(--brass);
          letter-spacing: 0.01em;
        }
        .brand-sub { font-size: 12px; color: var(--text-dim); margin-top: 2px; }

        .nav-group { display: flex; flex-direction: column; gap: 4px; }
        .nav-label { font-size: 11px; color: var(--text-dim); margin-bottom: 6px; }

        .rail button {
          display: flex;
          align-items: center;
          gap: 8px;
          background: transparent;
          border: none;
          border-left: 2px solid transparent;
          color: var(--text-dim);
          padding: 8px 10px;
          font-family: inherit;
          font-size: 14px;
          text-align: left;
          border-radius: 3px;
          cursor: pointer;
        }
        .rail button:hover { color: var(--text); background: var(--panel-2); }
        .rail button.active { color: var(--brass); border-left-color: var(--brass); background: var(--panel-2); }

        .stage {
          flex: 1;
          padding: 32px 40px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          max-width: 640px;
        }

        .tool-panel { display: flex; flex-direction: column; gap: 18px; }

        .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

        select, .panel-header button, .metronome-controls button {
          background: var(--panel-2);
          border: 1px solid var(--brass-dim);
          color: var(--text);
          padding: 8px 12px;
          border-radius: 4px;
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        select:focus-visible, button:focus-visible, input:focus-visible {
          outline: 2px solid var(--brass);
          outline-offset: 2px;
        }
        .panel-header button:hover, .metronome-controls button:hover { border-color: var(--brass); }

        .error-text { color: var(--error); font-size: 13px; }

        .tuner {
          background: var(--panel);
          border: 1px solid var(--brass-dim);
          border-radius: 6px;
          padding: 22px;
          text-align: center;
        }
        .tuner-note { font-family: 'Fraunces', serif; font-size: 46px; font-weight: 600; color: var(--brass); line-height: 1; }
        .tuner-sub { color: var(--text-dim); font-size: 13px; margin-top: 8px; }

        .keyboard-svg, .fretboard-svg { width: 100%; height: auto; }

        .progress { display: flex; gap: 6px; justify-content: center; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--panel-2); border: 1px solid var(--brass-dim); }
        .dot.done { background: var(--felt); border-color: var(--felt); }
        .dot.current { background: var(--brass); border-color: var(--brass); }

        .success-text { text-align: center; color: var(--felt); font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .link-btn { background: none; border: none; color: var(--brass); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-family: inherit; font-size: 13px; }

        .score { color: var(--text-dim); font-size: 13px; }

        .ear-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .choice-btn {
          background: var(--panel);
          border: 1px solid var(--brass-dim);
          color: var(--text);
          padding: 16px;
          border-radius: 6px;
          font-family: 'Fraunces', serif;
          font-size: 20px;
          cursor: pointer;
        }
        .choice-btn:hover:not(:disabled) { border-color: var(--brass); }
        .choice-btn:disabled { cursor: default; }
        .choice-btn.correct { border-color: var(--felt); background: rgba(79,125,104,0.2); color: var(--felt); }

        .feedback { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 14px; }
        .feedback.correct { color: var(--felt); }
        .feedback.wrong { color: var(--error); }

        .metronome-display { display: flex; flex-direction: column; align-items: center; gap: 12px; background: var(--panel); border: 1px solid var(--brass-dim); border-radius: 6px; padding: 24px; }
        .pendulum-track { width: 140px; height: 90px; position: relative; }
        .pendulum {
          position: absolute;
          bottom: 0;
          left: 50%;
          width: 3px;
          height: 85px;
          background: var(--brass);
          transform-origin: bottom center;
          transition-timing-function: ease-in-out;
        }
        .pendulum::after {
          content: '';
          position: absolute;
          top: -6px;
          left: -5px;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: var(--brass);
        }
        .bpm-value { font-family: 'Fraunces', serif; font-size: 36px; color: var(--brass); }
        .bpm-value span { font-size: 13px; color: var(--text-dim); font-family: 'Space Grotesk', sans-serif; margin-left: 4px; }

        input[type="range"] { width: 100%; accent-color: var(--brass); }

        .metronome-controls { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

        .chord-diagram-wrap { display: flex; justify-content: center; }
        .chord-diagram-svg { width: 160px; height: auto; }

        .chord-sequence { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
        .chord-chip {
          font-family: 'Fraunces', serif;
          font-size: 14px;
          padding: 4px 10px;
          border: 1px solid var(--brass-dim);
          border-radius: 4px;
          color: var(--text-dim);
        }
        .chord-chip.current { color: var(--brass); border-color: var(--brass); background: var(--panel-2); }

        .instructions { color: var(--text-dim); font-size: 13px; line-height: 1.5; }

        @media (max-width: 680px) {
          .app { flex-direction: column; min-height: auto; }
          .rail { width: 100%; flex-direction: row; align-items: center; gap: 16px; overflow-x: auto; border-right: none; border-bottom: 1px solid var(--brass-dim); }
          .nav-group { flex-direction: row; }
          .nav-label { display: none; }
          .stage { padding: 20px; max-width: 100%; }
          .ear-choices { grid-template-columns: 1fr; }
        }
      `}</style>

      <nav className="rail">
        <div>
          <div className="brand">Woodshed</div>
          <div className="brand-sub">practice with your own instrument</div>
        </div>

        <div className="nav-group">
          <span className="nav-label">Instrument</span>
          <button className={instrument === 'piano' ? 'active' : ''} onClick={() => setInstrument('piano')}>
            <Music size={17} /> Piano
          </button>
          <button className={instrument === 'guitar' ? 'active' : ''} onClick={() => setInstrument('guitar')}>
            <Guitar size={17} /> Guitar
          </button>
        </div>

        <div className="nav-group">
          <span className="nav-label">Practice</span>
          <button className={tool === 'trainer' ? 'active' : ''} onClick={() => setTool('trainer')}>
            <Check size={17} /> Note trainer
          </button>
          <button className={tool === 'chords' ? 'active' : ''} onClick={() => setTool('chords')}>
            <Music2 size={17} /> Chord practice
          </button>
          <button className={tool === 'ear' ? 'active' : ''} onClick={() => setTool('ear')}>
            <Headphones size={17} /> Ear training
          </button>
          <button className={tool === 'metronome' ? 'active' : ''} onClick={() => setTool('metronome')}>
            <Timer size={17} /> Metronome
          </button>
        </div>
      </nav>

      <main className="stage">
        {tool === 'trainer' && (
          <>
            <p className="instructions">
              Pick a scale, turn on the mic, and play each note on your {instrument} in order — the {instrument === 'piano' ? 'key' : 'fret dot'} lights up brass for the target and green once you nail it.
            </p>
            <NoteTrainer instrument={instrument} micOn={micOn} micError={micError} detected={detected} startMic={startMic} stopMic={stopMic} />
          </>
        )}
        {tool === 'chords' && (
          <>
            <p className="instructions">
              Follow a chord progression at your own tempo — {instrument === 'guitar' ? 'the diagram shows finger placement' : 'the keyboard highlights each chord tone'}, and the chord advances on the beat once you hit start.
            </p>
            <ChordPractice instrument={instrument} />
          </>
        )}
        {tool === 'ear' && (
          <>
            <p className="instructions">A note plays through your speakers — name it by ear. No mic needed here.</p>
            <EarTrainer instrument={instrument} />
          </>
        )}
        {tool === 'metronome' && (
          <>
            <p className="instructions">Set a tempo, or tap it in by clicking along a few times.</p>
            <Metronome />
          </>
        )}
      </main>
    </div>
  );
}
