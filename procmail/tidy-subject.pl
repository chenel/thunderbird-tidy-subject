#!/usr/bin/perl
# Read RFC822 headers on stdin, emit them with the Subject: tidied.
# Safe by design: on any internal error it prints the input unchanged.
use strict;
use warnings;
use MIME::Base64 ();
use MIME::QuotedPrint ();
use Encode ();

my @EXTERNAL_TAGS = (
  "EXT","EXTERN","EXTERNAL","EXTERNE",
  "External Sender","EXT SENDER","EXTERNAL EMAIL","SUSPICIOUS",
);
my @RE_ALIASES  = qw(Re AW Antw SV Odp Ref Odgovor);
my @FWD_ALIASES = qw(Fwd Fw WG TR RV VB Doorst Enc);
my $COLLAPSE_MODE  = "sequence";   # "sequence" | "leftmost"
my $KEEP_ORIGINAL  = 1;            # add X-Original-Subject:

my $input = do { local $/; <STDIN> };
my $out = eval { tidy_headers($input) };
print defined($out) ? $out : $input;
exit 0;

sub build_tag_re {
  my $alt = join "|", map { quotemeta } sort { length($b) <=> length($a) } @EXTERNAL_TAGS;
  return qr/\[\s*(?:$alt)\s*\]\s*:?\s*/i;
}
sub build_prefix_re {
  my $alt = join "|", map { quotemeta } sort { length($b) <=> length($a) } (@RE_ALIASES, @FWD_ALIASES);
  return qr/^($alt)\s*(?:\[\d+\]|\*\d+)?\s*:\s*/i;
}

sub decode_rfc2047 {
  my ($s) = @_;
  $s =~ s/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/$1/g;   # join adjacent words
  $s =~ s{=\?([^?]+)\?([BbQq])\?([^?]*)\?=}{
    my ($cs,$enc,$txt) = ($1,$2,$3);
    my $raw = (uc $enc eq 'B') ? MIME::Base64::decode_base64($txt)
                               : do { (my $t=$txt) =~ tr/_/ /; MIME::QuotedPrint::decode_qp($t) };
    my $dec = eval { Encode::decode($cs, $raw, Encode::FB_CROAK()) };
    defined($dec) ? $dec : $raw;
  }ge;
  return $s;
}

sub encode_if_needed {
  my ($s) = @_;
  return $s if $s !~ /[^\x20-\x7e]/;                      # pure ASCII, leave alone
  my $octets = Encode::encode("UTF-8", $s);
  return "=?UTF-8?B?" . MIME::Base64::encode_base64($octets, "") . "?=";
}

sub tidy_value {
  my ($subject) = @_;
  my $tag_re    = build_tag_re();
  my $prefix_re = build_prefix_re();
  my %IS_RE  = map { lc($_) => 1 } @RE_ALIASES;
  my %IS_FWD = map { lc($_) => 1 } @FWD_ALIASES;

  my $rest = $subject;
  $rest =~ s/$tag_re//g;
  $rest =~ s/^\s+|\s+$//g;

  my @seen;
  while ($rest =~ s/$prefix_re//) {
    my $raw = lc $1;
    my $type = $IS_RE{$raw} ? "Re" : ($IS_FWD{$raw} ? "Fwd" : undef);
    last unless defined $type;
    push @seen, $type;
    $rest =~ s/$tag_re//g;
    $rest =~ s/^\s+//;
  }
  return $subject if $rest eq "";                          # never empty a subject

  my $prefix = "";
  if (@seen) {
    if ($COLLAPSE_MODE eq "sequence") {
      my @dedup; for my $t (@seen) { push @dedup, $t unless @dedup && $dedup[-1] eq $t; }
      $prefix = join "", map { "$_: " } @dedup;
    } else {
      $prefix = $seen[0] . ": ";
    }
  }
  my $new = $prefix . $rest;
  $new =~ s/\s+$//;
  return $new;
}

sub tidy_headers {
  my ($hdrs) = @_;
  my $crlf = ($hdrs =~ /\r\n/) ? "\r\n" : "\n";
  my @lines = split /\r?\n/, $hdrs, -1;
  my (@out, $i);
  for ($i = 0; $i <= $#lines; $i++) {
    if ($lines[$i] =~ /^Subject:[ \t]*(.*)$/i) {
      my $val = $1;
      while ($i + 1 <= $#lines && $lines[$i+1] =~ /^[ \t]+(.*)$/) { $val .= " " . $1; $i++; }
      my $orig    = $val;
      my $decoded = decode_rfc2047($val);
      my $tidied  = tidy_value($decoded);
      if ($tidied eq $decoded) { push @out, "Subject: $orig"; next; }
      push @out, "X-Original-Subject: $orig" if $KEEP_ORIGINAL;
      push @out, "Subject: " . encode_if_needed($tidied);
    } else {
      push @out, $lines[$i];
    }
  }
  return join $crlf, @out;
}
