//! Turns a Sourcefold Markdown file (docs/FILE-FORMAT.md) into passages for the search index
//! (docs/handoff-search.md, "Passages").
//!
//! The front matter, the `# Title` line and the `> Saved from …` line are dropped. `## My note`
//! and `## My highlights` are cut off the end and become `note` and `highlight` entries. The body
//! is cut at headings and blank lines, then packed into passages of at most 400 words (a passage
//! ends at a heading). Markdown is stripped so a passage reads as plain text.

use std::sync::OnceLock;

use regex::{Captures, Regex};

/// A passage never has more words than this.
pub const MAX_WORDS: usize = 400;
/// Paragraphs are packed until a passage has about this many words or the next paragraph would
/// not fit; only a passage that ends at a heading (or the end of the text) can be shorter.
pub const MIN_WORDS: usize = 150;
const START_WORDS: usize = 12;
const HEADING_SEPARATOR: &str = " \u{203a} ";

const NOTE_MARKER: &str = "\n## My note\n";
const HIGHLIGHTS_MARKER: &str = "\n## My highlights\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassageType {
    Body,
    Highlight,
    Note,
}

impl PassageType {
    pub fn as_str(self) -> &'static str {
        match self {
            PassageType::Body => "body",
            PassageType::Highlight => "highlight",
            PassageType::Note => "note",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Passage {
    pub kind: PassageType,
    /// Headings above the passage, joined with " › ". Empty when there is none.
    pub heading: String,
    /// The stripped text.
    pub text: String,
    /// The first 12 words of `text`.
    pub passage_start: String,
    /// YouTube: the first timestamp in the passage.
    pub seconds: Option<f64>,
}

#[derive(Debug, Default)]
pub struct Chunked {
    /// `url:` from the front matter.
    pub front_url: Option<String>,
    /// `title:` from the front matter.
    pub front_title: Option<String>,
    pub passages: Vec<Passage>,
}

// -----------------------------------------------------------------------------
// Front matter and sections
// -----------------------------------------------------------------------------

fn split_front_matter(text: &str) -> (Option<&str>, &str) {
    let text = text.trim_start_matches('\u{feff}');
    let Some(after_open) = text.strip_prefix("---\n") else {
        return (None, text);
    };
    let mut offset = 0;
    for line in after_open.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let front = &after_open[..offset];
            let rest = &after_open[offset + line.len()..];
            return (Some(front), rest);
        }
        offset += line.len();
    }
    (None, text)
}

fn front_matter_value(front: &str, key: &str) -> Option<String> {
    for line in front.lines() {
        let Some(rest) = line.strip_prefix(key).and_then(|r| r.strip_prefix(':')) else {
            continue;
        };
        let value = rest.trim();
        if value.is_empty() {
            return None;
        }
        let unquoted = if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
            value[1..value.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
        } else if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
            value[1..value.len() - 1].replace("''", "'")
        } else {
            value.to_string()
        };
        return Some(unquoted);
    }
    None
}

/// Chunks a whole file. `item_kind` is the item's kind: a `note` item's body is type `note`.
pub fn chunk_markdown(markdown: &str, item_kind: &str) -> Chunked {
    let text = markdown.replace("\r\n", "\n");
    let (front, rest) = split_front_matter(&text);
    let mut out = Chunked::default();
    if let Some(front) = front {
        out.front_url = front_matter_value(front, "url");
        out.front_title = front_matter_value(front, "title");
    }

    let doc = format!("\n{}\n", rest);
    let (before_note, note) = match doc.rfind(NOTE_MARKER) {
        Some(i) => (format!("{}\n", &doc[..i]), Some(&doc[i + NOTE_MARKER.len()..])),
        None => (doc.clone(), None),
    };
    let (body, highlights) = match before_note.rfind(HIGHLIGHTS_MARKER) {
        Some(i) => (&before_note[..i], Some(&before_note[i + HIGHLIGHTS_MARKER.len()..])),
        None => (before_note.as_str(), None),
    };

    let body_type = if item_kind == "note" { PassageType::Note } else { PassageType::Body };
    out.passages.extend(chunk_text(body, body_type, true));
    if let Some(section) = highlights {
        out.passages.extend(parse_highlights(section));
    }
    if let Some(section) = note {
        out.passages.extend(chunk_text(section, PassageType::Note, false));
    }
    out
}

// -----------------------------------------------------------------------------
// Blocks and packing
// -----------------------------------------------------------------------------

enum Elem {
    Heading(usize, String),
    Block(String, Option<f64>),
}

struct LineRegexes {
    heading: Regex,
    hr: Regex,
    footnote_def: Regex,
    list_item: Regex,
}

fn line_regexes() -> &'static LineRegexes {
    static RE: OnceLock<LineRegexes> = OnceLock::new();
    RE.get_or_init(|| LineRegexes {
        heading: Regex::new(r"^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$").unwrap(),
        hr: Regex::new(r"^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}|=+)$").unwrap(),
        footnote_def: Regex::new(r"^\[\^[^\]]+\]:").unwrap(),
        list_item: Regex::new(r"^(?:[-+*]|\d{1,3}[.)])\s+(.*)$").unwrap(),
    })
}

fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn first_words(text: &str, count: usize) -> String {
    text.split_whitespace().take(count).collect::<Vec<_>>().join(" ")
}

fn verbatim(lines: &[&str]) -> String {
    lines.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")
}

fn parse_elements(text: &str, drop_front: bool) -> Vec<Elem> {
    let re = line_regexes();
    let mut elems = Vec::new();
    let mut para: Vec<String> = Vec::new();
    let mut verbatim_lines: Vec<&str> = Vec::new();
    let mut in_code = false;
    let mut in_math = false;
    let mut dropped_title = !drop_front;
    let mut dropped_source = !drop_front;
    let mut seen = 0usize;

    fn flush_para(para: &mut Vec<String>, elems: &mut Vec<Elem>) {
        if para.is_empty() {
            return;
        }
        let (text, seconds) = strip_inline(&para.join(" "));
        para.clear();
        if !text.is_empty() {
            elems.push(Elem::Block(text, seconds));
        }
    }

    for line in text.lines() {
        let trimmed = line.trim();

        if in_code || in_math {
            let closes = if in_code {
                trimmed.starts_with("```") || trimmed.starts_with("~~~")
            } else {
                trimmed.starts_with("$$")
            };
            if closes {
                let joined = verbatim(&verbatim_lines);
                verbatim_lines.clear();
                if !joined.is_empty() {
                    elems.push(Elem::Block(joined, None));
                }
                in_code = false;
                in_math = false;
            } else {
                verbatim_lines.push(trimmed);
            }
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            flush_para(&mut para, &mut elems);
            in_code = true;
            continue;
        }
        if trimmed == "$$" || (trimmed.starts_with("$$") && !trimmed[2..].contains("$$")) {
            flush_para(&mut para, &mut elems);
            in_math = true;
            let rest = trimmed[2..].trim();
            if !rest.is_empty() {
                verbatim_lines.push(rest);
            }
            continue;
        }

        if trimmed.is_empty() {
            flush_para(&mut para, &mut elems);
            continue;
        }

        if !dropped_title && seen < 3 && trimmed.starts_with("# ") {
            dropped_title = true;
            seen += 1;
            continue;
        }
        if !dropped_source && seen < 6 && trimmed.starts_with("> Saved from ") {
            dropped_source = true;
            seen += 1;
            continue;
        }
        seen += 1;

        let mut l = trimmed;
        while let Some(rest) = l.strip_prefix('>') {
            l = rest.trim_start();
        }
        if l.is_empty() {
            flush_para(&mut para, &mut elems);
            continue;
        }
        if re.footnote_def.is_match(l) {
            flush_para(&mut para, &mut elems);
            continue;
        }
        if let Some(caps) = re.heading.captures(l) {
            flush_para(&mut para, &mut elems);
            let (heading, _) = strip_inline(&caps[2]);
            if !heading.is_empty() {
                elems.push(Elem::Heading(caps[1].len(), heading));
            }
            continue;
        }
        if re.hr.is_match(l) {
            flush_para(&mut para, &mut elems);
            continue;
        }
        if l.starts_with('|') {
            flush_para(&mut para, &mut elems);
            let cells: Vec<String> = l
                .replace("\\|", "\u{1}")
                .trim_matches('|')
                .split('|')
                .map(|c| c.replace('\u{1}', "|").trim().to_string())
                .collect();
            let is_divider = cells
                .iter()
                .all(|c| !c.is_empty() && c.chars().all(|ch| ch == '-' || ch == ':') && c.contains('-'));
            if is_divider {
                continue;
            }
            let row = cells.into_iter().filter(|c| !c.is_empty()).collect::<Vec<_>>().join(" ");
            let (text, seconds) = strip_inline(&row);
            if !text.is_empty() {
                elems.push(Elem::Block(text, seconds));
            }
            continue;
        }
        if let Some(caps) = re.list_item.captures(l) {
            flush_para(&mut para, &mut elems);
            para.push(caps[1].to_string());
            continue;
        }
        para.push(l.to_string());
    }
    if !verbatim_lines.is_empty() {
        let joined = verbatim(&verbatim_lines);
        if !joined.is_empty() {
            elems.push(Elem::Block(joined, None));
        }
    }
    flush_para(&mut para, &mut elems);
    elems
}

/// Splits a block of more than `MAX_WORDS` words at sentence ends (a single sentence that long is
/// cut at the word limit).
fn split_long(text: &str) -> Vec<String> {
    if word_count(text) <= MAX_WORDS {
        return vec![text.to_string()];
    }
    let mut sentences: Vec<String> = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        if matches!(chars[i], '.' | '!' | '?' | '\u{2026}') {
            let mut j = i + 1;
            while j < chars.len() && matches!(chars[j], '"' | '\'' | ')' | '\u{201d}' | '\u{2019}') {
                j += 1;
            }
            if j >= chars.len() || chars[j].is_whitespace() {
                sentences.push(chars[start..j].iter().collect());
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                start = j;
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    if start < chars.len() {
        sentences.push(chars[start..].iter().collect());
    }

    let mut pieces: Vec<String> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut current_words = 0;
    let flush = |current: &mut Vec<String>, current_words: &mut usize, pieces: &mut Vec<String>| {
        if !current.is_empty() {
            pieces.push(current.join(" "));
            current.clear();
            *current_words = 0;
        }
    };
    for sentence in sentences {
        let words = word_count(&sentence);
        if words > MAX_WORDS {
            flush(&mut current, &mut current_words, &mut pieces);
            let all: Vec<&str> = sentence.split_whitespace().collect();
            for chunk in all.chunks(MAX_WORDS) {
                pieces.push(chunk.join(" "));
            }
            continue;
        }
        if current_words + words > MAX_WORDS {
            flush(&mut current, &mut current_words, &mut pieces);
        }
        current_words += words;
        current.push(sentence);
    }
    flush(&mut current, &mut current_words, &mut pieces);
    pieces
}

struct Packer {
    kind: PassageType,
    stack: Vec<(usize, String)>,
    heading: String,
    blocks: Vec<String>,
    seconds: Option<f64>,
    words: usize,
    out: Vec<Passage>,
}

impl Packer {
    fn heading_path(&self) -> String {
        self.stack.iter().map(|(_, h)| h.as_str()).collect::<Vec<_>>().join(HEADING_SEPARATOR)
    }

    fn flush(&mut self) {
        if !self.blocks.is_empty() {
            let text = self.blocks.join("\n");
            self.out.push(Passage {
                kind: self.kind,
                heading: std::mem::take(&mut self.heading),
                passage_start: first_words(&text, START_WORDS),
                text,
                seconds: self.seconds.take(),
            });
            self.blocks.clear();
        }
        self.words = 0;
        self.seconds = None;
    }

    fn set_heading(&mut self, level: usize, text: String) {
        self.flush();
        while self.stack.last().is_some_and(|(l, _)| *l >= level) {
            self.stack.pop();
        }
        self.stack.push((level, text));
    }

    fn add(&mut self, text: String, seconds: Option<f64>) {
        for piece in split_long(&text) {
            let words = word_count(&piece);
            if !self.blocks.is_empty() && self.words + words > MAX_WORDS {
                self.flush();
            }
            if self.blocks.is_empty() {
                self.heading = self.heading_path();
            }
            if self.seconds.is_none() {
                self.seconds = seconds;
            }
            self.words += words;
            self.blocks.push(piece);
        }
    }
}

fn chunk_text(text: &str, kind: PassageType, drop_front: bool) -> Vec<Passage> {
    let mut packer = Packer {
        kind,
        stack: Vec::new(),
        heading: String::new(),
        blocks: Vec::new(),
        seconds: None,
        words: 0,
        out: Vec::new(),
    };
    for elem in parse_elements(text, drop_front) {
        match elem {
            Elem::Heading(level, text) => packer.set_heading(level, text),
            Elem::Block(text, seconds) => packer.add(text, seconds),
        }
    }
    packer.flush();
    packer.out
}

// -----------------------------------------------------------------------------
// Highlights
// -----------------------------------------------------------------------------

fn parse_clock(text: &str) -> Option<f64> {
    let mut total = 0u64;
    let mut parts = 0;
    for part in text.split(':') {
        total = total * 60 + part.parse::<u64>().ok()?;
        parts += 1;
    }
    (1..=3).contains(&parts).then_some(total as f64)
}

fn parse_highlights(section: &str) -> Vec<Passage> {
    struct Pending {
        quote: String,
        details: Vec<String>,
        seconds: Option<f64>,
    }
    fn finish(pending: Option<Pending>, out: &mut Vec<Passage>) {
        let Some(p) = pending else { return };
        if p.quote.is_empty() {
            return;
        }
        let mut text = p.quote.clone();
        if !p.details.is_empty() {
            text.push('\n');
            text.push_str(&p.details.join(" "));
        }
        out.push(Passage {
            kind: PassageType::Highlight,
            heading: String::new(),
            passage_start: first_words(&p.quote, START_WORDS),
            text,
            seconds: p.seconds,
        });
    }

    let plain_clock = Regex::new(r"^(?:\d{1,2}:)?\d{1,2}:\d{2}$").unwrap();
    let mut out = Vec::new();
    let mut pending: Option<Pending> = None;
    let normalized = section.replace("\r\n", "\n");
    for block in normalized.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        if block.starts_with('>') || block.starts_with("![") {
            finish(pending.take(), &mut out);
            let raw: Vec<&str> = block
                .lines()
                .map(|l| l.trim().trim_start_matches('>').trim())
                .filter(|l| !l.is_empty())
                .collect();
            let (quote, _) = strip_inline(&raw.join(" "));
            pending = Some(Pending { quote, details: Vec::new(), seconds: None });
        } else if let Some(p) = pending.as_mut() {
            let joined = block.lines().map(str::trim).collect::<Vec<_>>().join(" ");
            for part in joined.split(" \u{b7} ") {
                let part = part.trim();
                if plain_clock.is_match(part) {
                    p.seconds = p.seconds.or_else(|| parse_clock(part));
                    continue;
                }
                let (text, seconds) = strip_inline(part);
                if seconds.is_some() {
                    p.seconds = p.seconds.or(seconds);
                }
                if !text.is_empty() {
                    p.details.push(text);
                }
            }
        }
    }
    finish(pending, &mut out);
    out
}

// -----------------------------------------------------------------------------
// Inline Markdown
// -----------------------------------------------------------------------------

struct InlineRegexes {
    youtube_time: Regex,
    youtube_t: Regex,
    image: Regex,
    link: Regex,
    footnote_mark: Regex,
    number_mark: Regex,
    autolink: Regex,
    html_tag: Regex,
    math: Regex,
}

fn inline_regexes() -> &'static InlineRegexes {
    static RE: OnceLock<InlineRegexes> = OnceLock::new();
    RE.get_or_init(|| {
        let dest = r#"(?:<[^>]*>|(?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?"#;
        InlineRegexes {
            youtube_time: Regex::new(
                r"\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]\(<?(https?://(?:youtu\.be/|(?:www\.|m\.)?youtube\.com/)[^)\s>]*)>?\)\s?",
            )
            .unwrap(),
            youtube_t: Regex::new(r"[?&]t=(\d+)").unwrap(),
            image: Regex::new(&format!(r"!\[((?:[^\]\\]|\\.)*)\]\({}\)", dest)).unwrap(),
            link: Regex::new(&format!(r"\[((?:[^\[\]\\]|\\.)*)\]\({}\)", dest)).unwrap(),
            footnote_mark: Regex::new(r"\[\^[^\]\s]+\]").unwrap(),
            number_mark: Regex::new(r"\[\d{1,4}\]").unwrap(),
            autolink: Regex::new(r"<(https?://[^>\s]+)>").unwrap(),
            html_tag: Regex::new(
                r"(?i)</?(?:a|abbr|b|blockquote|br|center|cite|code|del|details|div|em|figcaption|figure|font|h[1-6]|hr|i|iframe|img|ins|li|mark|ol|p|picture|pre|small|source|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul|video)(?:\s[^<>]*)?/?>",
            )
            .unwrap(),
            math: Regex::new(r"\$(\S[^$\n]*?\S|\S)\$").unwrap(),
        }
    })
}

fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    text.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

const MATH_OPEN: char = '\u{1}';
const MATH_CLOSE: char = '\u{2}';

/// Plain text for one run of Markdown, and the first YouTube timestamp it had (in seconds).
pub fn strip_inline(input: &str) -> (String, Option<f64>) {
    let re = inline_regexes();
    let mut seconds: Option<f64> = None;

    let text = re.youtube_time.replace_all(input, |caps: &Captures| {
        if seconds.is_none() {
            seconds = re
                .youtube_t
                .captures(&caps[2])
                .and_then(|c| c[1].parse::<f64>().ok())
                .or_else(|| parse_clock(&caps[1]));
        }
        ""
    });
    let text = re.image.replace_all(&text, "$1");
    let text = re.link.replace_all(&text, "$1");
    let text = re.footnote_mark.replace_all(&text, "");
    let text = re.number_mark.replace_all(&text, "");
    let text = re.autolink.replace_all(&text, "$1");
    let text = re.html_tag.replace_all(&text, "");
    let text = decode_entities(&text);
    let text = re.math.replace_all(&text, |caps: &Captures| {
        format!("{}{}{}", MATH_OPEN, &caps[1], MATH_CLOSE)
    });

    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut in_math = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == MATH_OPEN {
            in_math = true;
        } else if c == MATH_CLOSE {
            in_math = false;
        } else if in_math {
            out.push(c);
        } else {
            match c {
                '\\' if chars.get(i + 1).is_some_and(|n| n.is_ascii_punctuation()) => {
                    out.push(chars[i + 1]);
                    i += 1;
                }
                '*' | '`' => {}
                '~' if chars.get(i + 1) == Some(&'~') => i += 1,
                '_' => {
                    let prev = i.checked_sub(1).map(|p| chars[p]);
                    let next = chars.get(i + 1).copied();
                    let inside_word = prev.is_some_and(char::is_alphanumeric)
                        && next.is_some_and(char::is_alphanumeric);
                    if inside_word {
                        out.push(c);
                    }
                }
                _ => out.push(c),
            }
        }
        i += 1;
    }

    let collapsed = out.replace("$$", " ").split_whitespace().collect::<Vec<_>>().join(" ");
    (collapsed, seconds)
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const YOUTUBE: &str = include_str!("../../../../../packages/core/test/golden/youtube.md");
    const GROKIPEDIA: &str = include_str!("../../../../../packages/core/test/golden/grokipedia.md");
    const WIKIPEDIA: &str = include_str!("../../../../../packages/core/test/golden/wikipedia.md");
    const SUBSTACK: &str = include_str!("../../../../../packages/core/test/golden/substack.md");
    const HIGHLIGHTS: &str =
        include_str!("../../../../../packages/core/test/golden/item-with-highlights.md");
    const NOTE: &str = include_str!("../../../../../packages/core/test/golden/note.md");
    const ITEM_WITH_NOTE: &str =
        include_str!("../../../../../packages/core/test/golden/item-with-note.md");
    const X_THREAD: &str = include_str!("../../../../../packages/core/test/golden/x-thread.md");

    fn all_goldens() -> Vec<(&'static str, &'static str, &'static str)> {
        vec![
            ("youtube", YOUTUBE, "youtube"),
            ("grokipedia", GROKIPEDIA, "grokipedia"),
            ("wikipedia", WIKIPEDIA, "wikipedia"),
            ("substack", SUBSTACK, "substack"),
            ("highlights", HIGHLIGHTS, "youtube"),
            ("note", NOTE, "note"),
            ("item-with-note", ITEM_WITH_NOTE, "grokipedia"),
            ("x-thread", X_THREAD, "x"),
        ]
    }

    fn of_type(chunked: &Chunked, kind: PassageType) -> Vec<&Passage> {
        chunked.passages.iter().filter(|p| p.kind == kind).collect()
    }

    #[test]
    fn no_golden_passage_has_markdown_leftovers_or_the_dropped_lines() {
        for (name, md, kind) in all_goldens() {
            let chunked = chunk_markdown(md, kind);
            assert!(!chunked.passages.is_empty(), "{name} has passages");
            for p in &chunked.passages {
                assert!(!p.text.contains("]("), "{name}: link left in {:?}", p.text);
                assert!(!p.text.contains("[^"), "{name}: footnote left in {:?}", p.text);
                assert!(!p.text.contains("Saved from"), "{name}: source line left");
                assert!(!p.text.contains("source: "), "{name}: front matter left");
                assert!(!p.text.contains("**"), "{name}: bold left in {:?}", p.text);
                assert!(!p.text.trim().is_empty());
                assert!(word_count(&p.text) <= MAX_WORDS);
                assert!(word_count(&p.passage_start) <= START_WORDS);
                assert!(p.text.starts_with(&p.passage_start) || p.text.split_whitespace().take(START_WORDS).eq(p.passage_start.split_whitespace()));
            }
        }
    }

    #[test]
    fn youtube_transcript_and_description() {
        let chunked = chunk_markdown(YOUTUBE, "youtube");
        assert_eq!(
            chunked.front_url.as_deref(),
            Some("https://www.youtube.com/watch?v=abcDEF12345")
        );
        assert_eq!(chunked.front_title.as_deref(), Some("How a Turbocharger Works"));
        assert_eq!(chunked.passages.len(), 2);
        let transcript = &chunked.passages[0];
        assert_eq!(transcript.heading, "Transcript");
        assert_eq!(transcript.seconds, Some(0.0));
        assert!(transcript.text.contains("The exhaust spins a turbine"));
        assert!(transcript.text.contains("Thanks for watching."));
        assert_eq!(
            transcript.passage_start,
            "Hello and welcome. Today we look at how a turbocharger works. The"
        );
        assert!(!transcript.text.contains("0:47"));
        assert!(!transcript.text.contains("youtu.be"));
        let description = &chunked.passages[1];
        assert_eq!(description.heading, "Description");
        assert_eq!(description.seconds, None);
        assert!(description.text.starts_with("How turbos work."));
    }

    #[test]
    fn youtube_timestamps_give_seconds_of_the_first_one() {
        let md = "# T\n\n## Transcript\n\n[1:02:05](https://youtu.be/abc?t=3725) Late start here.\n\n[1:03:00](https://youtu.be/abc?t=3780) Later.\n";
        let chunked = chunk_markdown(md, "youtube");
        assert_eq!(chunked.passages.len(), 1);
        assert_eq!(chunked.passages[0].seconds, Some(3725.0));
    }

    #[test]
    fn highlights_and_note_are_split_off() {
        let chunked = chunk_markdown(HIGHLIGHTS, "youtube");
        let body = of_type(&chunked, PassageType::Body);
        let highlights = of_type(&chunked, PassageType::Highlight);
        let notes = of_type(&chunked, PassageType::Note);
        assert_eq!(body.len(), 2);
        assert!(body.iter().all(|p| !p.text.contains("Turbo lag was the main obstacle")));
        assert_eq!(highlights.len(), 3);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].text, "Good for the script.");
        assert_eq!(notes[0].heading, "");

        assert!(highlights[0].text.starts_with("The exhaust spins a turbine"));
        assert!(highlights[0].text.contains("Note: Intro line for the script"));
        assert_eq!(highlights[0].seconds, Some(47.0));
        assert_eq!(
            highlights[0].passage_start,
            "The exhaust spins a turbine, and the turbine drives a compressor."
        );

        assert_eq!(highlights[1].text, "Cutaway of a turbocharger");
        assert_eq!(highlights[1].seconds, None);

        assert!(highlights[2].text.starts_with("Turbo lag was the main obstacle to early adoption."));
        assert!(highlights[2].text.contains("Cited: sae.org, example.com"));
        assert!(highlights[2].text.contains("Note: Check the date"));
        assert_eq!(highlights[2].seconds, Some(3725.0));
        assert!(highlights.iter().all(|p| !p.text.contains("](")));
    }

    #[test]
    fn a_file_with_a_note_but_no_highlights() {
        let chunked = chunk_markdown(ITEM_WITH_NOTE, "grokipedia");
        let body = of_type(&chunked, PassageType::Body);
        let notes = of_type(&chunked, PassageType::Note);
        assert_eq!(body.len(), 1);
        assert!(body[0].text.starts_with("Quantum teleportation is a technique"));
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].text, "Remember to compare with quantum entanglement.");
        assert!(of_type(&chunked, PassageType::Highlight).is_empty());
    }

    #[test]
    fn a_note_item_body_is_type_note() {
        let chunked = chunk_markdown(NOTE, "note");
        assert_eq!(chunked.passages.len(), 1);
        assert_eq!(chunked.passages[0].kind, PassageType::Note);
        assert_eq!(chunked.passages[0].text, "Discussed Q4 roadmap and deliverables.");
    }

    #[test]
    fn wikipedia_headings_footnotes_tables_and_math() {
        let chunked = chunk_markdown(WIKIPEDIA, "wikipedia");
        let headings: Vec<&str> = chunked.passages.iter().map(|p| p.heading.as_str()).collect();
        assert_eq!(headings, vec!["", "History", "History \u{203a} Early use"]);

        let lead = &chunked.passages[0];
        assert!(lead.text.starts_with("In an internal combustion engine, a turbocharger is a forced induction device"));
        assert!(lead.text.contains("compresses the intake air."));
        assert!(!lead.text.contains("[^1]"));
        assert!(lead.text.contains("Field Value"));
        assert!(lead.text.contains("Invented 1905"));
        assert!(lead.text.contains("Inventor Alfred B\u{fc}chi"));
        assert!(!lead.text.contains('|'));
        assert!(!lead.text.contains("---"));
        assert!(lead.text.contains("A turbocharger (item 10) on a piston engine"));
        assert!(!lead.text.contains("upload.wikimedia"));

        let history = &chunked.passages[1];
        assert!(history.text.contains("p_{2}/p_{1}"));
        assert!(!history.text.contains('$'));
        assert!(history.text.contains("\\eta = \\frac {T_{1}}{T_{2}}"));

        // The reference list is not indexed.
        assert!(chunked.passages.iter().all(|p| !p.text.contains("Karim")));
        assert!(chunked.passages.iter().all(|p| !p.text.contains("Bosch")));
        assert!(chunked.passages[2].text.contains("Aircraft engines"));
        assert!(!chunked.passages[2].text.contains("- "));
    }

    #[test]
    fn grokipedia_and_substack_keep_their_sections() {
        let g = chunk_markdown(GROKIPEDIA, "grokipedia");
        assert_eq!(g.passages.len(), 1);
        assert_eq!(g.passages[0].heading, "Overview");
        assert!(g.passages[0].text.starts_with("Artificial general intelligence (AGI)"));

        let s = chunk_markdown(SUBSTACK, "substack");
        assert_eq!(s.passages.len(), 2);
        // The italic subtitle sits above the first heading.
        assert_eq!(s.passages[0].heading, "");
        assert_eq!(s.passages[0].text, "How modular software is changing developer productivity");
        assert_eq!(s.passages[1].heading, "Introduction");
    }

    #[test]
    fn x_thread_keeps_the_posts_without_markup() {
        let chunked = chunk_markdown(X_THREAD, "x");
        let text: String = chunked.passages.iter().map(|p| p.text.clone()).collect::<Vec<_>>().join("\n");
        assert!(text.contains("Alice (@alice) \u{b7} 2026-10-14 \u{b7} link"));
        assert!(text.contains("First post in the thread."));
        assert!(text.contains("Replying to Alice with interesting point."));
        assert!(!text.contains('>'));
    }

    fn words(prefix: &str, count: usize) -> String {
        (0..count).map(|i| format!("{prefix}{i}")).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn passages_are_packed_between_the_word_bounds_and_end_at_headings() {
        let mut md = String::from("---\nsource: web\ntitle: Long\n---\n\n# Long\n\n");
        for section in ["Alpha", "Beta"] {
            md.push_str(&format!("## {section}\n\n"));
            for n in 0..14 {
                md.push_str(&format!("{}.\n\n", words(&format!("{}{}w", section.to_lowercase(), n), 90)));
            }
        }
        let chunked = chunk_markdown(&md, "web");
        assert!(chunked.passages.len() > 4);
        for section in ["Alpha", "Beta"] {
            let in_section: Vec<&Passage> =
                chunked.passages.iter().filter(|p| p.heading == section).collect();
            assert!(in_section.len() >= 3, "{section}");
            for (i, p) in in_section.iter().enumerate() {
                let count = word_count(&p.text);
                assert!(count <= MAX_WORDS, "{count} words");
                if i + 1 < in_section.len() {
                    assert!(count >= MIN_WORDS, "{count} words in a passage that is not last");
                }
            }
        }
        // A passage never mixes the two sections.
        assert!(chunked
            .passages
            .iter()
            .all(|p| !(p.text.contains("alpha") && p.text.contains("beta"))));
    }

    #[test]
    fn a_paragraph_over_400_words_is_split_at_sentence_ends() {
        let sentences: Vec<String> =
            (0..60).map(|i| format!("{}.", words(&format!("s{i}x"), 20))).collect();
        let md = format!("# T\n\n{}\n", sentences.join(" "));
        let chunked = chunk_markdown(&md, "web");
        assert!(chunked.passages.len() >= 3);
        for p in &chunked.passages {
            assert!(word_count(&p.text) <= MAX_WORDS);
            assert!(p.text.trim_end().ends_with('.'));
        }
        let rejoined: usize = chunked.passages.iter().map(|p| word_count(&p.text)).sum();
        assert_eq!(rejoined, 60 * 20);
    }

    #[test]
    fn a_single_endless_sentence_is_cut_at_the_word_limit() {
        let md = format!("# T\n\n{}\n", words("w", 1000));
        let chunked = chunk_markdown(&md, "web");
        assert_eq!(chunked.passages.len(), 3);
        assert!(chunked.passages.iter().all(|p| word_count(&p.text) <= MAX_WORDS));
    }

    #[test]
    fn heading_paths_nest_and_reset() {
        let md = "# T\n\n## A\n\nunder a\n\n### B\n\nunder b\n\n#### C\n\nunder c\n\n### D\n\nunder d\n\n## E\n\nunder e\n";
        let chunked = chunk_markdown(md, "web");
        let headings: Vec<&str> = chunked.passages.iter().map(|p| p.heading.as_str()).collect();
        assert_eq!(
            headings,
            vec![
                "A",
                "A \u{203a} B",
                "A \u{203a} B \u{203a} C",
                "A \u{203a} D",
                "E"
            ]
        );
    }

    #[test]
    fn strips_inline_markdown() {
        let cases = [
            ("a [link text](https://x.com/a_b) here", "a link text here"),
            ("see ![an image](https://x.com/i.png) now", "see an image now"),
            ("![](https://x.com/i.png)", ""),
            ("[x](<https://x.com/a (old).pdf>) ok", "x ok"),
            ("[x](https://en.wikipedia.org/wiki/Foo_(bar)) ok", "x ok"),
            ("fact.[^12][^3] more [4] text", "fact. more text"),
            ("**bold** *it* _under_ ~~gone~~ `code`", "bold it under gone code"),
            ("snake_case_name stays", "snake_case_name stays"),
            ("a<br>b <b>c</b> &amp; d", "ab c & d"),
            ("x $a_1$ and $$ y", "x a_1 and y"),
            ("<https://x.com/p> end", "https://x.com/p end"),
            ("\\*literal\\*", "*literal*"),
            ("price is 5 < 6 and 7 > 3", "price is 5 < 6 and 7 > 3"),
        ];
        for (input, expected) in cases {
            assert_eq!(strip_inline(input).0, expected, "input: {input}");
        }
        let (text, seconds) = strip_inline("[0:47](https://youtu.be/abc?t=47) The exhaust.");
        assert_eq!(text, "The exhaust.");
        assert_eq!(seconds, Some(47.0));
        let (_, seconds) = strip_inline("[1:02:05](https://www.youtube.com/watch?v=abc) x");
        assert_eq!(seconds, Some(3725.0));
    }

    #[test]
    fn crlf_and_missing_front_matter_are_fine() {
        let md = "# Title\r\n\r\n> Saved from [Web](https://x.com) on 2026-01-01.\r\n\r\nBody text here.\r\n";
        let chunked = chunk_markdown(md, "web");
        assert_eq!(chunked.front_url, None);
        assert_eq!(chunked.passages.len(), 1);
        assert_eq!(chunked.passages[0].text, "Body text here.");
        assert!(chunk_markdown("", "web").passages.is_empty());
        assert!(chunk_markdown("---\ntitle: x\n---\n", "web").passages.is_empty());
    }

    #[test]
    fn the_last_note_heading_wins() {
        let md = "# T\n\nBody mentions\n\n## My note\n\nnot a real note\n\nmore body\n\n## My note\n\nthe real note\n";
        let chunked = chunk_markdown(md, "web");
        let notes = of_type(&chunked, PassageType::Note);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].text, "the real note");
    }
}
