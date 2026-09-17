// Test harness for tidy-subject.js — run with: node test.js
//
// The critical thing this models: nsIMsgDBHdr exposes the subject twice.
//   .subject              RAW header, still RFC 2047 encoded when non-ASCII
//   .mime2DecodedSubject  decoded text
// Reading the wrong one is the bug that silently skipped every message with a
// curly apostrophe, accented letter or dash in its subject. Any stub that sets
// both to the same value will NOT catch a regression of that bug, so the cases
// below deliberately supply differing raw and decoded forms.

const fs = require('fs');
const src = fs.readFileSync(__dirname + '/tidy-subject.js', 'utf8');

function Hdr(raw, decoded) {
  this.subject = raw;
  this.mime2DecodedSubject = decoded === undefined ? raw : decoded;
  this.props = {};
  this.setStringProperty = (k, v) => { this.props[k] = v; };
}

// [raw, decoded, expected result]
const CASES = [
  // --- MIME-encoded subjects (the regression cases) ---
  ['=?utf-8?B?W0V4dGVybmFsXSBET0UgTGF1bmNoZXMgUXVhbnR1bQ==?=',
   '[External] DOE Launches Quantum',
   'DOE Launches Quantum'],
  ['=?utf-8?Q?AW=3A_[Extern]_Pr=C3=BCfungstermine?=',
   'AW: [Extern] Prüfungstermine',
   'Re: Prüfungstermine'],
  ['=?utf-8?B?W0VYVF0gY2Fmw6k=?=', '[EXT] café', 'café'],

  // --- plain ASCII ---
  ['[EXTERNAL] Grant proposal draft', undefined, 'Grant proposal draft'],
  ['RE: [External] Re: [EXT] RE: [External] Paper revisions', undefined, 'Re: Paper revisions'],
  ['Fwd: Re: [EXT] AW: [Extern] Re: [External] Manuscript', undefined, 'Fwd: Re: Manuscript'],
  ['WG: [Extern] Fwd: Re: Bericht', undefined, 'Fwd: Re: Bericht'],
  ['Re[2]: [EXT] Numbered prefix', undefined, 'Re: Numbered prefix'],
  ['Re*3: [EXT] Collapsed already', undefined, 'Re: Collapsed already'],
  ['[ external ] spaced tag', undefined, 'spaced tag'],
  ['[EXT]: colon after tag', undefined, 'colon after tag'],
  ['[EXTERNAL SENDER] Meeting', undefined, 'Meeting'],

  // --- must NOT be touched ---
  ['[JIRA-1234] Build failure', undefined, '[JIRA-1234] Build failure'],
  ['[thunderbird-dev] Patch review', undefined, '[thunderbird-dev] Patch review'],
  ['Next steps for the external review', undefined, 'Next steps for the external review'],
  ['Reference: not a prefix', undefined, 'Reference: not a prefix'],
  ['Report: quarterly', undefined, 'Report: quarterly'],
  ['Re: Already clean', undefined, 'Re: Already clean'],
  ['[EXT]', undefined, '[EXT]'],            // never empty a subject
  ['Grant proposal draft', undefined, 'Grant proposal draft'],
];

function run(headers) {
  const msgHdrs = headers;
  const Components = { interfaces: {} };
  // The script logs one line per run unconditionally. Swallow it so the
  // harness output stays readable, but let genuine errors through.
  const console = { log: () => {}, error: (...a) => globalThis.console.error(...a) };
  return eval(src);
}

let failed = 0;
const hdrs = CASES.map(c => new Hdr(c[0], c[1]));
run(hdrs);

CASES.forEach((c, i) => {
  const got = hdrs[i].subject;
  const want = c[2];
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${JSON.stringify(c[1] === undefined ? c[0] : c[1])}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
});

// Idempotency: after the write, the stored subject is plain text, so a second
// pass sees raw === decoded and must change nothing.
const second = hdrs.map(h => new Hdr(h.subject, h.subject));
const changedAgain = run(second);

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
console.log(`second pass changed ${changedAgain} (must be 0)`);
if (failed > 0 || changedAgain !== 0) process.exit(1);
