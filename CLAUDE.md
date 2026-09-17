# Strip `[External]` tags from Thunderbird subject lines

## What this is

A FiltaQuilla "JavaScript Action" filter script that removes `[External]` /
`[EXT]` / `[Extern]` tags from incoming mail subjects in Thunderbird, and
collapses the repeated `Re:` / `Fwd:` prefixes that accumulate when a thread
passes between institutions that each add their own tag.

Context: nearly all of this user's mail is external (university research, highly
collaborative), so the tag carries no signal and only trains them to ignore that
part of the subject line. IT declined to make an exception.

## Files

- `README.md` — the user-facing setup and troubleshooting guide. This is what
  colleagues are handed, so it has to stay in step with the script.
- `tidy-subject.js` — the script. Lives on disk; loaded by the filter. This is
  the only copy; the earlier `tidy-inbound-subject.js` and
  `tidy-inbound-subject-debug.js` generations were removed, the latter because
  it predated the `mime2DecodedSubject` fix and so reproduced invariant 1's bug
  while looking like the better-instrumented copy.
- `filter-action.js` — the one line pasted into the FiltaQuilla action.
- `test.js` — node harness. Run `node test.js` after any change.
- `procmail/` — an independent server-side variant: a Perl filter that rewrites
  the real `Subject:` header at delivery. An alternative to the Thunderbird
  setup rather than a companion to it, and unusable where O365 delivers the
  mailbox directly. See `procmail/PROCMAIL.md`.

## How it is wired up

FiltaQuilla filter action (one line, loads the real script from disk):

```js
Services.scriptloader.loadSubScript('file:///home/you/bin/tidy-subject.js', this);
```

Filter config in `msgFilterRules.dat`: `enabled="yes"`, `type="17"`
(= InboxRule 0x01 + Manual 0x10, i.e. on new mail before junk classification,
and on manual runs), `action="Custom"`,
`customId="filtaquilla@mesquilla.com#javascriptAction"`, `condition="ALL"`.

Requires `extensions.filtaquilla.javascriptAction.enabled` = true. This is read
**once at add-on init** and cached, so toggling it requires a Thunderbird
restart. (`JavascriptEnabled` and `javascriptActionBody.enabled` are different
features and irrelevant here — the first gates a custom *search term*, the
second a different action.)

## Design: non-destructive by choice

The script writes `hdr.subject`, which updates only Thunderbird's folder index
(`.msf`). **The message source on the IMAP server is never touched.**
Consequences:

- No IMAP re-upload. `Message-ID` / `References` / `In-Reply-To` are untouched,
  so threading cannot break. This was the deciding factor over a rewrite-based
  approach.
- Reply/forward inherits the tidied subject, so outbound mail stops propagating
  the tag pile-up. (Verified.) This is why the separate TidySubject add-on is
  not needed.
- Phone and webmail still show the original tagged subjects.
- `Repair Folder` rebuilds the index and reverts subjects. Harmless; re-run.
- Forward-only by design. Archives (~30k messages, 10+ years) are deliberately
  left alone: the archive tags are inert, and a bug in a batch rewrite would
  multiply across irreplaceable mail.

## Invariants — do not break these

1. **Read `mime2DecodedSubject`, write `subject`.** `nsIMsgDBHdr.subject`
   returns the RAW header, still RFC 2047 encoded whenever the subject contains
   any non-ASCII character. Reading it silently skipped every message with a
   curly apostrophe, accented name or dash — this was the longest-running bug in
   this project and it is invisible without a test that distinguishes the two.
   FiltaQuilla's own code reads `mime2DecodedSubject` everywhere for the same
   reason; its `_mimeAppend` writes plain decoded text back, so that is the
   established pattern.

2. **Match only bracketed, known tag strings.** Never a generic `\[.*?\]` —
   that eats `[JIRA-1234]`, mailing-list tags, and so on. Never bare-word
   matching either; `EXT` unbracketed matches inside "next", "context".

3. **Require a colon after a prefix alias.** This is what stops `Reference:` and
   `Report:` being mistaken for `Re:`.

4. **Never produce an empty subject.** A subject that is nothing but a tag is
   left alone.

5. **Gate the write on an actual change.** This gives idempotency and avoids
   pointless work on ~95% of mail.

## Why the script contains no regexes and no backslashes

Historical, and now partly moot. When the script was stored inline in the filter
action, Thunderbird's `msgFilterRules.dat` round trip mangled it — newlines
become U+2028 (FiltaQuilla repairs this explicitly at `saferEval`), and double
quotes are backslash-escaped. Two separate `SyntaxError`s resulted. Rewriting
without regexes or backslashes removed that class of failure.

Loading from disk now avoids the storage path entirely, so regexes would be safe
again. Leaving the code as plain string scanning anyway: it is readable, it is
tested, and it cannot regress this way.

## Gotchas

- `loadSubScript` **caches by URL**. After editing the file, restart Thunderbird
  or use `loadSubScriptWithOptions(url, {target: this, ignoreCache: true})`.
- The script logs `tidy-subject: INVOKED, N header(s)` on every run regardless
  of `DEBUG`; the absence of that line means the action never ran, and the count
  separates "not invoked" from "invoked, given nothing". Everything else is
  DEBUG-gated, including the readback that checks the write actually stuck.
- Messages filed into other folders by **server-side rules** never reach the
  Inbox, so `InboxRule` never sees them. They stay tagged until a manual run.
  Unresolved — see below.

## Open items

- Cover server-side-filed folders. Options: periodic manual runs, or check
  whether this Thunderbird version offers "Periodically" under *Apply filter
  when* (would add 0x80 to the filter type).
- Tag list needs extending as new institutional variants appear
  (`EXTERNAL_TAGS` at the top of the script).
- Colleagues are using this too. Anyone who took the pre-`mime2DecodedSubject`
  version has a copy that silently skips non-ASCII subjects.
- FiltaQuilla is built on Experiment APIs and is version-coupled to Thunderbird
  (currently v6.3, min TB 140). A TB update can disable it outright.
