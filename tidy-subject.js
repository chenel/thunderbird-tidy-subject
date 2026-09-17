// ---------------------------------------------------------------------------
// Tidy [External]-style tags out of incoming subjects (message DB only).
// FiltaQuilla -> filter action "JavaScript Action".
//
// This version contains NO regular expressions and NO backslashes anywhere.
// That is deliberate: filter action values are round-tripped through
// msgFilterRules.dat, which escapes and unescapes the stored string, and a
// lost backslash silently turns a working script into a SyntaxError. Plain
// string scanning removes that whole failure mode.
//
// The message source is never modified; only Thunderbird's folder index
// changes, so Message-ID / References / In-Reply-To are untouched.
// ---------------------------------------------------------------------------

// --- config ----------------------------------------------------------------

// Bracketed tags to remove. Case-insensitive. Brackets are always required,
// so unrelated bracketed text ([JIRA-1234], [listname]) is left alone.
var EXTERNAL_TAGS = [
  "EXT", "EXTERN", "EXTERNAL", "EXTERNE",
  "EXTERNAL SENDER", "EXT SENDER", "EXTERNAL EMAIL", "SUSPICIOUS"
];

var RE_ALIASES  = ["RE", "AW", "ANTW", "SV", "ODP", "REF", "ODGOVOR"];
var FWD_ALIASES = ["FWD", "FW", "WG", "TR", "RV", "VB", "DOORST", "ENC"];

// "sequence" -> "Fwd: Re: Re: x" becomes "Fwd: Re: x"  (keep shape)
// "leftmost" -> "Fwd: Re: Re: x" becomes "Fwd: x"      (newest action only)
var COLLAPSE_MODE = "sequence";

var STORE_ORIGINAL = true;

// Set true to log every decision to the Error Console (Ctrl+Shift+J).
// One line per run is logged even with this off -- see "apply" below.
var DEBUG = false;

// --- character helpers (no escapes) ----------------------------------------

var CH_TAB = String.fromCharCode(9);
var CH_NL  = String.fromCharCode(10);
var CH_CR  = String.fromCharCode(13);

function fq_isSpace(c) {
  return c === " " || c === CH_TAB || c === CH_NL || c === CH_CR;
}
function fq_isDigit(c) {
  return c >= "0" && c <= "9";
}
function fq_skipSpaces(s, i) {
  while (i < s.length && fq_isSpace(s.charAt(i))) i++;
  return i;
}

// --- lookup tables ---------------------------------------------------------

var TAG_SET = {};
for (var ti = 0; ti < EXTERNAL_TAGS.length; ti++) {
  TAG_SET[EXTERNAL_TAGS[ti].toUpperCase()] = true;
}

var ALIASES = [];
var ALIAS_TYPE = {};
for (var ri = 0; ri < RE_ALIASES.length; ri++) {
  ALIASES.push(RE_ALIASES[ri].toUpperCase());
  ALIAS_TYPE[RE_ALIASES[ri].toUpperCase()] = "Re";
}
for (var fi = 0; fi < FWD_ALIASES.length; fi++) {
  ALIASES.push(FWD_ALIASES[fi].toUpperCase());
  ALIAS_TYPE[FWD_ALIASES[fi].toUpperCase()] = "Fwd";
}
ALIASES.sort(function (a, b) { return b.length - a.length; });

// --- tag stripping ---------------------------------------------------------
// Walk the string; whenever a bracketed run matches a known tag, drop it along
// with any trailing spaces and one optional colon.

function fq_stripTags(s) {
  var out = "";
  var i = 0;
  while (i < s.length) {
    if (s.charAt(i) === "[") {
      var close = s.indexOf("]", i + 1);
      if (close > i) {
        var inner = s.substring(i + 1, close).trim().toUpperCase();
        if (TAG_SET[inner] === true) {
          i = fq_skipSpaces(s, close + 1);
          if (s.charAt(i) === ":") i = fq_skipSpaces(s, i + 1);
          continue;
        }
      }
    }
    out += s.charAt(i);
    i++;
  }
  return out;
}

// --- prefix peeling --------------------------------------------------------
// Matches "Re:", "AW :", "Re[2]:", "Re*3:" and so on. The required colon is
// what stops "Reference" or "Report" being mistaken for a prefix.

function fq_peelPrefix(s) {
  for (var a = 0; a < ALIASES.length; a++) {
    var alias = ALIASES[a];
    if (s.length < alias.length) continue;
    if (s.substring(0, alias.length).toUpperCase() !== alias) continue;

    var j = fq_skipSpaces(s, alias.length);

    // optional [n]
    if (s.charAt(j) === "[") {
      var c = s.indexOf("]", j + 1);
      if (c > j + 1) {
        var digits = s.substring(j + 1, c);
        var allDigits = digits.length > 0;
        for (var d = 0; d < digits.length; d++) {
          if (!fq_isDigit(digits.charAt(d))) { allDigits = false; break; }
        }
        if (allDigits) j = fq_skipSpaces(s, c + 1);
      }
    // optional *n
    } else if (s.charAt(j) === "*") {
      var k = j + 1;
      while (k < s.length && fq_isDigit(s.charAt(k))) k++;
      if (k > j + 1) j = fq_skipSpaces(s, k);
    }

    if (s.charAt(j) === ":") {
      return { type: ALIAS_TYPE[alias], rest: s.substring(j + 1).trim() };
    }
  }
  return null;
}

// --- transform -------------------------------------------------------------

function fq_tidy(subject) {
  if (typeof subject !== "string" || subject.length === 0) return subject;

  var rest = fq_stripTags(subject).trim();
  var seen = [];

  for (;;) {
    var hit = fq_peelPrefix(rest);
    if (hit === null) break;
    seen.push(hit.type);
    rest = fq_stripTags(hit.rest).trim();
  }

  if (rest.length === 0) return subject;   // never empty a subject

  var prefix = "";
  if (seen.length > 0) {
    if (COLLAPSE_MODE === "sequence") {
      var dedup = [];
      for (var q = 0; q < seen.length; q++) {
        if (dedup.length === 0 || dedup[dedup.length - 1] !== seen[q]) dedup.push(seen[q]);
      }
      for (var p = 0; p < dedup.length; p++) prefix += dedup[p] + ": ";
    } else {
      prefix = seen[0] + ": ";
    }
  }
  return (prefix + rest).trim();
}

// --- reading the subject ----------------------------------------------------
// nsIMsgDBHdr.subject returns the RAW header, which is still RFC 2047 encoded
// whenever the subject contains any non-ASCII character (curly apostrophes,
// accented names, dashes). mime2DecodedSubject is the decoded text, and is
// what FiltaQuilla itself reads everywhere. Writing plain decoded text back
// into .subject is FiltaQuilla's own pattern too.

function fq_readSubject(hdr) {
  var s;
  try {
    s = hdr.mime2DecodedSubject;
    if (typeof s === "string" && s.length > 0) return s;
  } catch (e) { /* fall through */ }
  return hdr.subject;
}

// --- naming the folder ------------------------------------------------------
// Only for the log line. nsIMsgFolder has carried the display name under more
// than one property across Thunderbird versions, so try them in turn rather
// than pick one and be silently wrong. Deliberately NOT the folder URI: that
// carries the username and host, and this line ends up pasted into bug reports.

function fq_folderName(hdr) {
  try {
    var f = hdr.folder;
    if (f) {
      if (typeof f.localizedName === "string" && f.localizedName.length > 0) return f.localizedName;
      if (typeof f.prettyName === "string" && f.prettyName.length > 0) return f.prettyName;
      if (typeof f.name === "string" && f.name.length > 0) return f.name;
    }
  } catch (e) { /* fall through */ }
  return "unnamed";
}

// A filter run is per-folder, so this is normally one name. It is written to
// cope with more than one anyway: with applyIncomingFilters set, which folders
// fire is the whole question, and a line that named only the first folder of
// several would mislead in exactly the case it exists to diagnose.

function fq_folderNames(list) {
  var names = [];
  for (var n = 0; n < list.length; n++) {
    var nm = fq_folderName(list[n]);
    var have = false;
    for (var m = 0; m < names.length; m++) {
      if (names[m] === nm) { have = true; break; }
    }
    if (!have) names.push(nm);
  }
  return names.join(", ");
}

// --- apply -----------------------------------------------------------------

(function () {
  var list = [];
  if (typeof msgHdrs.length === "number" && typeof msgHdrs.slice === "function") {
    list = msgHdrs;
  } else if (typeof msgHdrs.queryElementAt === "function") {
    for (var i = 0; i < msgHdrs.length; i++) {
      list.push(msgHdrs.queryElementAt(i, Components.interfaces.nsIMsgDBHdr));
    }
  } else {
    list = Array.from(msgHdrs);
  }

  // The one unconditional log line. With DEBUG off the script would otherwise
  // say nothing at all, and a filter that works looks exactly like a filter
  // that never ran. The header count distinguishes "not invoked" from
  // "invoked, given nothing"; the folder name tells you which folders the run
  // actually reached, which is what confirms or refutes applyIncomingFilters.
  if (list.length > 0) {
    console.log('tidy-subject: INVOKED on ' + fq_folderNames(list) +
                ', ' + list.length + ' header(s)');
  } else {
    console.log('tidy-subject: INVOKED, 0 header(s) (no folder to name)');
  }

  var changed = 0;
  for (var j = 0; j < list.length; j++) {
    var hdr = list[j];
    try {
      var orig = fq_readSubject(hdr);
      var tidied = fq_tidy(orig);
      if (tidied === orig) continue;
      if (STORE_ORIGINAL) hdr.setStringProperty("x-original-subject", orig);
      hdr.subject = tidied;
      if (DEBUG) {
        // Read back: the write goes to the folder index, and a write that does
        // not stick is silent otherwise.
        var readback = hdr.subject;
        console.log('tidy-subject: [' + orig + '] ==> [' + tidied +
                    '] readback=[' + readback + '] stuck=' + (readback === tidied));
      }
      changed++;
    } catch (ex) {
      console.error("tidy-subject: " + ex);
    }
  }

  if (DEBUG) console.log('tidy-subject: DONE, ' + changed + ' changed');

  return changed;
})();
