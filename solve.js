// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly the answer
// csv-reader's readCsv returns for {text, header} — {columns, rows, errors} —
// but reads the text with bulk slices instead of one character at a time.
//
// The policy is csv-reader's own (see the kit's baselines/csv-reader/):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote and each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote); a quote inside an unquoted field is a literal;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded (short_row) or cut (long_row) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met, a field's quote_junk
//     when the field ends and a record's short_row or long_row when it ends;
//     line is the 1-based line its record starts on, row its index in rows
//     (null for the header).
//
// Speed comes from scanning with native regexes that stop at the next
// delimiter (one native scan per field instead of a JavaScript step per
// character) and slicing whole fields at once, so the common case — a plain
// unquoted field — costs one regex match and one slice. Field results are
// passed through shared locals, never through a fresh array per field.

const DELIM = /[,\r\n]/g; // next delimiter outside quotes
const QSPEC = /["\r\n]/g; // next special character inside quotes

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and (for an unquoted read)
  // how many characters the unquoted scan kept.
  let fv = '';
  let fe = END;
  let fa = 0;

  // Reads unquoted characters onto `value` up to the next comma or line break.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        added += len - pos;
        value += text.slice(pos);
        pos = len;
        fv = value;
        fe = END;
        fa = added;
        return;
      }
      const idx = m.index;
      const c = m[0];
      if (c === ',') {
        added += idx - pos;
        value += text.slice(pos, idx);
        pos = idx + 1;
        fv = value;
        fe = COMMA;
        fa = added;
        return;
      }
      if (c === '\n') {
        added += idx - pos;
        value += text.slice(pos, idx);
        pos = idx + 1;
        line += 1;
        fv = value;
        fe = LINE_BREAK;
        fa = added;
        return;
      }
      // A CR: a line break when followed by LF, else a dropped stray_cr.
      if (text.charCodeAt(idx + 1) === 10) {
        added += idx - pos;
        value += text.slice(pos, idx);
        pos = idx + 2;
        line += 1;
        fv = value;
        fe = LINE_BREAK;
        fa = added;
        return;
      }
      added += idx - pos;
      value += text.slice(pos, idx);
      pos = idx + 1;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    for (;;) {
      QSPEC.lastIndex = pos;
      const m = QSPEC.exec(text);
      if (m === null) {
        value += text.slice(pos);
        pos = len;
        break;
      }
      const idx = m.index;
      const c = m[0];
      if (c === '"') {
        if (text.charCodeAt(idx + 1) === 34) {
          value += text.slice(pos, idx);
          value += '"';
          pos = idx + 2;
          continue;
        }
        value += text.slice(pos, idx);
        pos = idx + 1;
        closed = true;
        break;
      }
      if (c === '\r') {
        // CRLF and a lone CR inside quotes are each one LF.
        value += text.slice(pos, idx);
        value += '\n';
        line += 1;
        pos = text.charCodeAt(idx + 1) === 10 ? idx + 2 : idx + 1;
        continue;
      }
      value += text.slice(pos, idx);
      value += '\n';
      line += 1;
      pos = idx + 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    if (pos >= len) {
      fv = value;
      fe = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fv = value;
      fe = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(value);
    if (fa > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fv);
    } while (fe === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
