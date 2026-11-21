[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/s8fr2hf/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/s8fr2hf/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-run-20261121

A fast drop-in for csv-reader 1.0.0: it reads broken CSV files exactly the way
csv-reader does — same `{columns, rows, errors}` for every input — but about
3x faster on the practice set.

## How it works

`main.ts` is the house driver (kept as shipped): it reads every case from
`/input/cases.json`, answers each with `run` from `solve.js`, and writes
`/output/answers.json`.

`solve.js` reimplements csv-reader's broken-row policy from scratch:

- a U+FEFF at the very start is dropped;
- a record ends at LF or CRLF, and a line left with no characters is no record;
- outside a quoted field a CR not followed by LF is dropped (`stray_cr`);
- a field that opens with a quote runs to the next quote that is not doubled,
  `""` inside it one quote and each CRLF or lone CR inside it read as LF;
  what follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`); a quote that never closes is a literal
  character, and the text after it is read again as unquoted
  (`unterminated_quote`);
- rows are padded (`short_row`) or cut (`long_row`) to the first record's width.

The speed comes from scanning with native regexes that stop at the next
delimiter — one native scan per field instead of a JavaScript step per
character — and slicing whole fields at once. Field results are passed through
shared locals, never through a fresh array per field.

## Verification

On the kit's practice set (6 cases, ~10 MB of CSV): output identical to
csv-reader 1.0.0 on every case (and to `practice/reference/expected.json`),
plus 4,000 random broken-CSV fuzz cases and 80 hand-picked edge cases with
zero mismatches. Median run time over the 6 practice cases: ~156 ms against
the baseline's ~512 ms on this machine (about 3.3x faster).

## License

MIT. See [LICENSE](LICENSE).

Built for the [make.fun bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
