# Tidying `[External]` tags out of Subject headers with procmail

> This is the **server-side** variant, for mail delivered through a Unix MDA.
> It is not the Thunderbird setup — see `README.md` for that. The two are
> alternatives, not companions: procmail rewrites the real `Subject:` header at
> delivery, whereas the Thunderbird version edits only the local folder index
> and leaves the message untouched. Use this only if you control the delivery
> path; it cannot touch an Office 365 mailbox that O365 delivers to directly.

Tested against stacked tags, a folded subject, an RFC 2047-encoded German
subject, and three cases that must stay untouched.

## Install

1. Copy `tidy-subject.pl` to `~/bin/` and `chmod +x` it.
2. Paste the contents of `procmailrc-fragment` into `~/.procmailrc`.

## How this differs from the Thunderbird approach

The procmail version is a real header rewrite rather than an index edit, and
that difference cuts in both directions.

**In its favour:** it happens in flight, before the message is ever stored, so
there is no re-upload, no delete-and-reimport, and `Message-ID`, `References`
and `In-Reply-To` are never touched — the threading risk that shaped the
Thunderbird design does not arise. The clean subject is also the real one, so
it is consistent across every client including your phone.

**Against it:** it is irreversible. That is why the script writes the original
into an `X-Original-Subject` header before rewriting, and why the fragment
keeps a `:0 c` copy of everything until you trust it.

## Two things the Perl version handles that the JavaScript one did not

**Header folding.** A long subject arrives split across continuation lines and
has to be joined before matching.

**RFC 2047 encoding.** A subject from a German or French collaborator arrives
as `=?UTF-8?B?...?=`, so the script decodes it, tidies, and re-encodes only if
non-ASCII survives. This case matters specifically because it is exactly the
`AW:` / `WG:` threads where the stacking is worst. In testing, a subject
decoding to `AW: [Extern] Fwd: Re: Prüfungstermine` comes back as a correctly
re-encoded `Re: Fwd: Re: Prüfungstermine`.

## Safety

A procmail filter that exits non-zero or emits malformed headers can lose mail
outright. This script wraps its work in `eval` and prints its input verbatim on
any error, always exiting 0, so the worst outcome is an untouched message.

Keep the `w` flag — it is what makes procmail check that.

## Configuration notes

`COLLAPSE_MODE` is set to `"sequence"`.

One deliberate omission: there is no procmail condition to skip running Perl on
messages with no tag. Such a condition would save a process spawn per message,
but procmail's regex engine does not reliably support `{2,}` intervals, so
expressing "two or more stacked prefixes" gets ugly and risks silently not
matching. Running unconditionally is both simpler and more correct at personal
mail volumes.

## If you are setting this up fresh

Procmail has been effectively unmaintained since the early 2000s and has a
history of security problems. If you are not maintaining an existing procmail
setup, maildrop or a Sieve script on the delivering server would be the current
choice. The Perl filter transfers to either with only the invocation changing.
