# Strip `[External]` tags from Thunderbird subject lines

Removes `[External]`, `[EXT]`, `[Extern]` and similar tags from mail subjects,
and collapses the `Re:` / `Fwd:` pile-up that builds when a thread passes
between institutions that each add their own tag.

```
RE: [External] Re: [EXT] RE: [External] Paper revisions
                                    ->  Re: Paper revisions
```

It also cleans the outbound side: replies inherit the tidied subject, so you
stop passing accumulated tags on to everyone else in the thread.

## It does not modify your mail

The script edits only Thunderbird's local folder index (`.msf`). The message on
the server, headers and all, is untouched. That means:

- Nothing is re-uploaded over IMAP, and threading cannot break — `Message-ID`,
  `References` and `In-Reply-To` are never altered.
- Your phone and webmail still show the original tagged subjects. Only
  Thunderbird sees the clean version.
- `Repair Folder` rebuilds the index and restores the original subjects.
  Harmless — just run the filter again.
- Only mail arriving from now on is affected. Existing archives are left alone
  unless you run the filter over them manually.

## Requirements

- Thunderbird 140 or later
- The [FiltaQuilla](https://addons.thunderbird.net/thunderbird/addon/filtaquilla/)
  add-on

## Setup

### 1. Enable the JavaScript Action

Install FiltaQuilla, open its settings, and tick **Javascript Action**. It ships
disabled.

This corresponds to `extensions.filtaquilla.javascriptAction.enabled` in
`about:config`. FiltaQuilla reads it **once at startup**, so if you change it,
restart Thunderbird — toggling it alone may not take effect.

(Do not confuse it with **Javascript** or **Javascript Action with Body**, which
are different features and are not needed here.)

### 2. Put the script on disk

Save `tidy-subject.js` somewhere stable, e.g. `~/bin/tidy-subject.js`.

### 3. Create the filter

*Tools → Message Filters → New*, then:

- **Apply filter when:** tick *Getting New Mail* and *Manually Run*
- **Match all messages**
- **Action:** *JavaScript Action*

For the action's script, paste this single line, with the path adjusted:

```js
Services.scriptloader.loadSubScript('file:///home/you/bin/tidy-subject.js', this);
```

Save, then select a few messages and use **Run Filter Now** to check it works.

### Why load from a file rather than pasting the script in

Recommended, and not only for editing convenience. Thunderbird stores filter
actions in `msgFilterRules.dat`, and that round trip rewrites the stored text:
newlines are saved as U+2028 and every double quote is backslash-escaped.
FiltaQuilla repairs some of this on the way back out, but a long inline script
is exposed to it every time the file is rewritten, and corruption shows up as a
filter that silently stops working.

The one-line loader has nothing to mangle, and the real code sits in a plain
file you can edit in a real editor and keep under version control.

If you would rather paste the whole script into the action box, that does work —
but if it later stops working for no apparent reason, this is the first thing to
suspect.

**Caching:** `loadSubScript` caches by URL, so after editing the script you may
still be running the old version. Restart Thunderbird after edits, or use:

```js
Services.scriptloader.loadSubScriptWithOptions(
  'file:///home/you/bin/tidy-subject.js', {target: this, ignoreCache: true});
```

## Configuration

At the top of `tidy-subject.js`:

- `EXTERNAL_TAGS` — tags to strip. Add whatever variants your collaborators'
  institutions use. **Keep the brackets required.** Do not loosen this to match
  any bracketed text, or it will start eating `[JIRA-1234]` and mailing-list
  tags; do not match bare words either, or `EXT` will match inside "next" and
  "context".
- `RE_ALIASES` / `FWD_ALIASES` — reply and forward prefixes, including localised
  ones (`AW:`, `WG:`, `SV:`, `TR:` …).
- `COLLAPSE_MODE` — `"sequence"` keeps the thread's shape
  (`Fwd: Re: Re: x` → `Fwd: Re: x`); `"leftmost"` keeps only the newest action
  (`Fwd: Re: Re: x` → `Fwd: x`).
- `DEBUG` — set `true` to log each decision to the Error Console.

Run `node test.js` after editing to confirm nothing broke.

## Troubleshooting

Open the Error Console with **Ctrl+Shift+J**, set `DEBUG = true`, and run the
filter manually.

| What you see | What it means |
|---|---|
| Nothing at all | The action is not being invoked. Check that FiltaQuilla is enabled and not disabled by a Thunderbird update, and that the JavaScript Action pref is on — then restart. |
| `INVOKED`, `0 header(s)` | The action runs but receives nothing. Check the filter's scope and conditions. |
| Runs, but a message is skipped | Its tag is probably not in `EXTERNAL_TAGS`. Check the exact spelling. |
| A `SyntaxError` | The script text is damaged — re-copy the file. |

The script logs `INVOKED, N header(s)` on every run even with `DEBUG = false`,
so the absence of that line is itself the diagnosis: the action never ran.
Everything else — the per-message before and after, the readback that confirms
the write stuck, and the final count — appears only with `DEBUG = true`.

## Known limitations

- **Server-side rules.** Mail that your mail server files into a folder other
  than the Inbox never passes through Thunderbird's incoming filters, so it
  stays tagged. Run the filter manually on those folders, or check whether your
  Thunderbird offers *Periodically* under *Apply filter when*.
- **FiltaQuilla is version-coupled.** It uses Experiment APIs, so a Thunderbird
  update can disable it outright.

## A note if you took an early copy of this

Versions before the `mime2DecodedSubject` fix silently skipped any subject
containing a non-ASCII character — a curly apostrophe, an accented name, an
em dash. Those subjects arrive RFC 2047-encoded, and the old code read the raw
encoded header rather than the decoded text, so it saw no tag to strip and
reported success. If tags are still appearing on some messages but not others,
this is why: update to the current version.
