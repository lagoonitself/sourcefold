//! Answering a search (docs/handoff-search.md, "Query").
//!
//! Each project is asked on its own: keywords through FTS5 (bm25) and, when the caller sent a
//! query vector, meaning through a dot product over that project's vectors. The answers of the
//! projects asked are merged, then the keyword list and the meaning list are fused with
//! Reciprocal Rank Fusion.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::time::Instant;

use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};

use super::store::{normalize, SearchStore};

/// Per list and per project.
const CANDIDATES: usize = 40;
const RRF_K: f64 = 60.0;
/// Meaning-only hits below this cosine are dropped.
const MIN_COSINE: f32 = 0.35;
const MEANING_SNIPPET_WORDS: usize = 30;
const MAX_PER_SOURCE: usize = 3;
const DEFAULT_PASSAGES: usize = 30;
const DEFAULT_NOTES: usize = 10;
const MAX_LIMIT: usize = 100;

// -----------------------------------------------------------------------------
// Request and response (the shapes in search-api.ts)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    /// "project" or "all".
    pub scope: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub query_vector: Option<Vec<f32>>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Matched {
    Keyword,
    Meaning,
    Both,
}

#[derive(Debug, Clone, Serialize)]
pub struct PassageHit {
    pub item_id: String,
    pub project_id: String,
    pub folder_id: String,
    pub title: String,
    pub kind: String,
    pub url: Option<String>,
    pub heading: String,
    pub snippet: String,
    pub passage_start: String,
    pub seconds: Option<f64>,
    pub matched: Matched,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteHit {
    pub item_id: String,
    pub project_id: String,
    pub folder_id: String,
    pub title: String,
    pub kind: String,
    pub url: Option<String>,
    /// "highlight" or "note".
    pub source: String,
    pub snippet: String,
    pub passage_start: String,
    pub seconds: Option<f64>,
    pub matched: Matched,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResponse {
    pub passages: Vec<PassageHit>,
    pub notes: Vec<NoteHit>,
    /// "used" when meaning results could be in this answer, otherwise "off".
    pub meaning: &'static str,
    pub took_ms: u64,
}

// -----------------------------------------------------------------------------
// The query language
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Term {
    pub text: String,
    pub phrase: bool,
    pub negative: bool,
}

fn has_word_char(text: &str) -> bool {
    text.chars().any(char::is_alphanumeric)
}

/// Splits the query into words, `"exact phrases"` and `-excluded` words. Terms with no letter or
/// digit in them are dropped (FTS5 would not match anything for them).
pub fn parse_query(input: &str) -> Vec<Term> {
    let chars: Vec<char> = input.chars().collect();
    let mut terms = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let mut negative = false;
        if chars[i] == '-' && chars.get(i + 1).is_some_and(|c| !c.is_whitespace()) {
            negative = true;
            i += 1;
        }
        if chars.get(i) == Some(&'"') {
            let start = i + 1;
            let mut end = start;
            while end < chars.len() && chars[end] != '"' {
                end += 1;
            }
            let text: String = chars[start..end].iter().collect();
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            i = (end + 1).min(chars.len()).max(i + 1);
            if has_word_char(&text) {
                terms.push(Term { text, phrase: true, negative });
            }
            continue;
        }
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '"' {
            i += 1;
        }
        let text: String = chars[start..i].iter().collect();
        if has_word_char(&text) {
            terms.push(Term { text, phrase: false, negative });
        }
    }
    terms
}

fn quote(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

/// The FTS5 expression for a query, or `None` when there is nothing to look for with keywords
/// (empty, or only excluded words). Every term is quoted, so nothing the user typed is read as
/// FTS5 syntax. The last term, if it is a bare word, also matches as a prefix.
pub fn build_match(terms: &[Term]) -> Option<String> {
    let positives: Vec<&Term> = terms.iter().filter(|t| !t.negative).collect();
    if positives.is_empty() {
        return None;
    }
    let last_is_bare_word = terms.last().is_some_and(|t| !t.negative && !t.phrase);
    let last_index = terms.len().saturating_sub(1);

    let mut parts: Vec<String> = Vec::new();
    for (index, term) in terms.iter().enumerate() {
        if term.negative {
            continue;
        }
        let quoted = quote(&term.text);
        if last_is_bare_word && index == last_index {
            parts.push(format!("({} OR {}*)", quoted, quoted));
        } else {
            parts.push(quoted);
        }
    }
    let positive = parts.join(" AND ");
    let negatives: Vec<String> =
        terms.iter().filter(|t| t.negative).map(|t| quote(&t.text)).collect();
    if negatives.is_empty() {
        Some(positive)
    } else {
        Some(format!("({}) NOT ({})", positive, negatives.join(" OR ")))
    }
}

// -----------------------------------------------------------------------------
// Rank fusion
// -----------------------------------------------------------------------------

/// Reciprocal Rank Fusion over two ranked lists (best first). Returns each key once with its
/// fused score and which lists had it, best first. Ties keep the keyword order, then the
/// meaning order.
pub fn rrf_merge<K: Hash + Eq + Clone>(keyword: &[K], meaning: &[K]) -> Vec<(K, f64, Matched)> {
    struct Entry<K> {
        key: K,
        score: f64,
        in_keyword: bool,
        in_meaning: bool,
        first_seen: usize,
    }
    let mut index: HashMap<K, usize> = HashMap::new();
    let mut entries: Vec<Entry<K>> = Vec::new();
    for (list, is_keyword) in [(keyword, true), (meaning, false)] {
        for (rank, key) in list.iter().enumerate() {
            let add = 1.0 / (RRF_K + (rank + 1) as f64);
            let at = *index.entry(key.clone()).or_insert_with(|| {
                entries.push(Entry {
                    key: key.clone(),
                    score: 0.0,
                    in_keyword: false,
                    in_meaning: false,
                    first_seen: entries.len(),
                });
                entries.len() - 1
            });
            let entry = &mut entries[at];
            if (is_keyword && entry.in_keyword) || (!is_keyword && entry.in_meaning) {
                continue; // a key listed twice counts once, at its best rank
            }
            entry.score += add;
            if is_keyword {
                entry.in_keyword = true;
            } else {
                entry.in_meaning = true;
            }
        }
    }
    entries.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.first_seen.cmp(&b.first_seen))
    });
    entries
        .into_iter()
        .map(|e| {
            let matched = match (e.in_keyword, e.in_meaning) {
                (true, true) => Matched::Both,
                (true, false) => Matched::Keyword,
                _ => Matched::Meaning,
            };
            (e.key, e.score, matched)
        })
        .collect()
}

// -----------------------------------------------------------------------------
// Per-project lookups
// -----------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct RowData {
    item_id: String,
    ptype: String,
    heading: String,
    passage_start: String,
    seconds: Option<f64>,
    folder_id: String,
    title: String,
    kind: String,
    url: Option<String>,
    /// The passage's text, loaded only for meaning-only hits.
    text: Option<String>,
}

#[derive(Debug, Clone)]
struct KeywordHit {
    id: i64,
    bm25: f64,
    snippet: String,
    row: RowData,
}

/// Everything one project has to say about one query, for one kind of passage (body, or
/// highlight and note).
#[derive(Default)]
struct KindResult {
    keyword: Vec<KeywordHit>,
    meaning: Vec<(i64, f32)>,
}

#[derive(Default)]
struct ProjectResult {
    body: KindResult,
    notes: KindResult,
    /// Rows for meaning hits, by passage id.
    meaning_rows: HashMap<i64, RowData>,
}

const ROW_COLUMNS: &str = "p.item_id, p.type, p.heading, p.passage_start, p.seconds,
    COALESCE(s.folder_id, ''), COALESCE(s.title, ''), COALESCE(s.kind, ''), s.url";

fn row_from(row: &rusqlite::Row, offset: usize) -> rusqlite::Result<RowData> {
    Ok(RowData {
        item_id: row.get(offset)?,
        ptype: row.get(offset + 1)?,
        heading: row.get(offset + 2)?,
        passage_start: row.get(offset + 3)?,
        seconds: row.get(offset + 4)?,
        folder_id: row.get(offset + 5)?,
        title: row.get(offset + 6)?,
        kind: row.get(offset + 7)?,
        url: row.get(offset + 8)?,
        text: None,
    })
}

fn keyword_hits(conn: &Connection, fts: &str, body: bool) -> rusqlite::Result<Vec<KeywordHit>> {
    let types = if body { "('body')" } else { "('highlight', 'note')" };
    let sql = format!(
        "SELECT p.id, bm25(passages_fts, 1.0, 0.5),
                snippet(passages_fts, 0, char(2), char(3), '\u{2026}', 24), {ROW_COLUMNS}
         FROM passages_fts
         JOIN passages p ON p.id = passages_fts.rowid
         LEFT JOIN sources s ON s.item_id = p.item_id
         WHERE passages_fts MATCH ?1 AND p.type IN {types}
         ORDER BY bm25(passages_fts, 1.0, 0.5)
         LIMIT {CANDIDATES}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([fts], |row| {
        Ok(KeywordHit {
            id: row.get(0)?,
            bm25: row.get(1)?,
            snippet: row.get::<_, String>(2)?.replace(['\n', '\r'], " "),
            row: row_from(row, 3)?,
        })
    })?;
    rows.collect()
}

fn rows_by_id(conn: &Connection, ids: &[i64]) -> rusqlite::Result<HashMap<i64, RowData>> {
    let mut out = HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    let marks = vec!["?"; ids.len()].join(",");
    let sql = format!(
        "SELECT p.id, {ROW_COLUMNS}, p.text
         FROM passages p LEFT JOIN sources s ON s.item_id = p.item_id
         WHERE p.id IN ({marks})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
        let id: i64 = row.get(0)?;
        let mut data = row_from(row, 1)?;
        data.text = Some(row.get(10)?);
        Ok((id, data))
    })?;
    for row in rows {
        let (id, data) = row?;
        out.insert(id, data);
    }
    Ok(out)
}

fn search_project(
    store: &SearchStore,
    project_id: &str,
    fts: Option<&str>,
    vector: Option<(&[f32], &str)>,
) -> Result<ProjectResult, String> {
    let mut result = ProjectResult::default();
    let Some(handle) = store.handle(project_id, false)? else { return Ok(result) };

    if let Some(fts) = fts {
        handle.with_read(|conn| {
            result.body.keyword = keyword_hits(conn, fts, true)?;
            result.notes.keyword = keyword_hits(conn, fts, false)?;
            Ok(())
        })?;
    }

    if let Some((query, model)) = vector {
        if let Some(cache) = store.vector_cache(project_id, model)? {
            if !cache.is_empty() {
                result.body.meaning = cache.top(query, true, CANDIDATES);
                result.notes.meaning = cache.top(query, false, CANDIDATES);
                let known: HashSet<i64> = result
                    .body
                    .keyword
                    .iter()
                    .chain(result.notes.keyword.iter())
                    .map(|h| h.id)
                    .collect();
                let missing: Vec<i64> = result
                    .body
                    .meaning
                    .iter()
                    .chain(result.notes.meaning.iter())
                    .map(|(id, _)| *id)
                    .filter(|id| !known.contains(id))
                    .collect();
                result.meaning_rows = handle.with_read(|conn| rows_by_id(conn, &missing))?;
            }
        }
    }
    Ok(result)
}

// -----------------------------------------------------------------------------
// Putting the answer together
// -----------------------------------------------------------------------------

fn first_words(text: &str, count: usize) -> String {
    let words: Vec<&str> = text.split_whitespace().take(count + 1).collect();
    if words.len() > count {
        format!("{}\u{2026}", words[..count].join(" "))
    } else {
        words.join(" ")
    }
}

struct Ranked {
    project: String,
    row: RowData,
    snippet: String,
    matched: Matched,
    score: f64,
}

type Key = (usize, i64);

/// Merges the projects' answers for one kind of passage and ranks them.
fn rank_kind(
    projects: &[(String, ProjectResult)],
    pick: impl Fn(&ProjectResult) -> &KindResult,
) -> Vec<Ranked> {
    let mut keyword: Vec<(Key, f64)> = Vec::new();
    let mut meaning: Vec<(Key, f32)> = Vec::new();
    for (p, (_, result)) in projects.iter().enumerate() {
        let kind = pick(result);
        keyword.extend(kind.keyword.iter().map(|h| ((p, h.id), h.bm25)));
        meaning.extend(kind.meaning.iter().map(|(id, cos)| ((p, *id), *cos)));
    }
    // bm25 is lower for better matches; cosine is higher.
    keyword.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    meaning.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let cosines: HashMap<Key, f32> = meaning.iter().cloned().collect();

    let keyword_keys: Vec<Key> = keyword.iter().map(|(k, _)| *k).collect();
    let meaning_keys: Vec<Key> = meaning.iter().map(|(k, _)| *k).collect();

    let mut out = Vec::new();
    for ((p, id), score, matched) in rrf_merge(&keyword_keys, &meaning_keys) {
        let (project, result) = &projects[p];
        let kind = pick(result);
        let keyword_hit = kind.keyword.iter().find(|h| h.id == id);
        let (row, snippet) = match keyword_hit {
            Some(hit) => (hit.row.clone(), hit.snippet.clone()),
            None => {
                if cosines.get(&(p, id)).copied().unwrap_or(0.0) < MIN_COSINE {
                    continue;
                }
                let Some(row) = result.meaning_rows.get(&id) else { continue };
                let snippet = first_words(row.text.as_deref().unwrap_or_default(), MEANING_SNIPPET_WORDS);
                (row.clone(), snippet)
            }
        };
        out.push(Ranked { project: project.clone(), row, snippet, matched, score });
    }
    out
}

/// The query as the store sees it: the vector normalized, only if it fits and a model is named.
fn usable_vector(request: &SearchRequest) -> Option<(Vec<f32>, String)> {
    let model = request.model.as_deref().map(str::trim).filter(|m| !m.is_empty())?;
    let vector = normalize(request.query_vector.as_deref()?)?;
    Some((vector, model.to_string()))
}

pub fn run(store: &SearchStore, request: &SearchRequest) -> Result<SearchResponse, String> {
    let started = Instant::now();
    let projects: Vec<String> = match request.scope.as_str() {
        "all" => store.list_projects(),
        "project" => match request.project_id.as_deref() {
            Some(id) if !id.is_empty() => vec![id.to_string()],
            _ => return Err("Open a project to search in it.".to_string()),
        },
        other => return Err(format!("Unknown search scope \"{}\".", other)),
    };

    let terms = parse_query(&request.query);
    let fts = build_match(&terms);
    let vector = usable_vector(request);
    let limit = request.limit.map(|l| (l as usize).clamp(1, MAX_LIMIT));
    let passage_limit = limit.unwrap_or(DEFAULT_PASSAGES);
    let note_limit = limit.map_or(DEFAULT_NOTES, |l| l.min(DEFAULT_NOTES));

    if fts.is_none() && vector.is_none() {
        return Ok(SearchResponse {
            passages: Vec::new(),
            notes: Vec::new(),
            meaning: "off",
            took_ms: started.elapsed().as_millis() as u64,
        });
    }

    let mut results: Vec<(String, ProjectResult)> = Vec::new();
    for project in projects {
        let result = search_project(
            store,
            &project,
            fts.as_deref(),
            vector.as_ref().map(|(v, m)| (v.as_slice(), m.as_str())),
        );
        match result {
            Ok(result) => results.push((project, result)),
            // One unreadable project shouldn't blank the answer from the others.
            Err(message) if request.scope == "all" => {
                eprintln!("search: skipped project {}: {}", project, message);
            }
            Err(message) => return Err(message),
        }
    }

    let meaning_used = results
        .iter()
        .any(|(_, r)| !r.body.meaning.is_empty() || !r.notes.meaning.is_empty());

    let mut passages = Vec::new();
    let mut per_source: HashMap<(String, String), usize> = HashMap::new();
    for ranked in rank_kind(&results, |r| &r.body) {
        let count = per_source.entry((ranked.project.clone(), ranked.row.item_id.clone())).or_insert(0);
        if *count >= MAX_PER_SOURCE {
            continue;
        }
        *count += 1;
        passages.push(PassageHit {
            item_id: ranked.row.item_id,
            project_id: ranked.project,
            folder_id: ranked.row.folder_id,
            title: ranked.row.title,
            kind: ranked.row.kind,
            url: ranked.row.url,
            heading: ranked.row.heading,
            snippet: ranked.snippet,
            passage_start: ranked.row.passage_start,
            seconds: ranked.row.seconds,
            matched: ranked.matched,
            score: ranked.score,
        });
        if passages.len() >= passage_limit {
            break;
        }
    }

    let mut notes = Vec::new();
    for ranked in rank_kind(&results, |r| &r.notes) {
        notes.push(NoteHit {
            item_id: ranked.row.item_id,
            project_id: ranked.project,
            folder_id: ranked.row.folder_id,
            title: ranked.row.title,
            kind: ranked.row.kind,
            url: ranked.row.url,
            source: if ranked.row.ptype == "highlight" { "highlight" } else { "note" }.to_string(),
            snippet: ranked.snippet,
            passage_start: ranked.row.passage_start,
            seconds: ranked.row.seconds,
            matched: ranked.matched,
            score: ranked.score,
        });
        if notes.len() >= note_limit {
            break;
        }
    }

    Ok(SearchResponse {
        passages,
        notes,
        meaning: if meaning_used { "used" } else { "off" },
        took_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(text: &str) -> Term {
        Term { text: text.into(), phrase: false, negative: false }
    }

    #[test]
    fn parses_words_phrases_and_exclusions() {
        let terms = parse_query("  turbo  \"boost   pressure\" -lag -\"old design\" end ");
        assert_eq!(
            terms,
            vec![
                t("turbo"),
                Term { text: "boost pressure".into(), phrase: true, negative: false },
                Term { text: "lag".into(), phrase: false, negative: true },
                Term { text: "old design".into(), phrase: true, negative: true },
                t("end"),
            ]
        );
        // A lone dash, punctuation and an unclosed quote.
        assert_eq!(parse_query("- ? !!"), vec![]);
        assert_eq!(
            parse_query("\"never closed"),
            vec![Term { text: "never closed".into(), phrase: true, negative: false }]
        );
        assert_eq!(parse_query("co-op"), vec![t("co-op")]);
        assert_eq!(parse_query("\"\" \"  \""), vec![]);
    }

    #[test]
    fn every_term_is_quoted_and_fts_syntax_is_inert() {
        let expr = build_match(&parse_query("cats AND dogs NEAR(a b) col:x ^start")).unwrap();
        for word in ["cats", "AND", "dogs", "NEAR(a", "b)", "col:x", "^start"] {
            assert!(expr.contains(&format!("\"{}\"", word)), "{expr} should quote {word}");
        }
        // Quotes inside a phrase can't appear (they end it), but a quote char in a bare word is
        // split off by the parser, so the expression stays balanced.
        let expr = build_match(&parse_query("say\"hi\"there")).unwrap();
        assert_eq!(expr.matches('"').count() % 2, 0);
        assert_eq!(quote("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn the_last_bare_word_gets_a_prefix() {
        assert_eq!(
            build_match(&parse_query("turbo lag")).unwrap(),
            "\"turbo\" AND (\"lag\" OR \"lag\"*)"
        );
        // A phrase or an exclusion at the end doesn't.
        assert_eq!(build_match(&parse_query("turbo \"lag time\"")).unwrap(), "\"turbo\" AND \"lag time\"");
        assert_eq!(build_match(&parse_query("turbo -lag")).unwrap(), "(\"turbo\") NOT (\"lag\")");
    }

    #[test]
    fn only_excluded_words_find_nothing_by_keyword() {
        assert_eq!(build_match(&parse_query("-lag")), None);
        assert_eq!(build_match(&parse_query("-lag -\"old design\"")), None);
        assert_eq!(build_match(&parse_query("")), None);
        assert_eq!(build_match(&parse_query("   ")), None);
    }

    #[test]
    fn rrf_fuses_by_rank_and_labels_where_a_hit_came_from() {
        let fused = rrf_merge(&["a", "b", "c"], &["c", "d", "a"]);
        let keys: Vec<&str> = fused.iter().map(|(k, _, _)| *k).collect();
        // a: 1/61 + 1/63, c: 1/63 + 1/61 (same score, a was seen first), b: 1/62, d: 1/62.
        assert_eq!(keys, vec!["a", "c", "b", "d"]);
        let matched: HashMap<&str, Matched> = fused.iter().map(|(k, _, m)| (*k, *m)).collect();
        assert_eq!(matched["a"], Matched::Both);
        assert_eq!(matched["b"], Matched::Keyword);
        assert_eq!(matched["d"], Matched::Meaning);
        let a = fused.iter().find(|(k, _, _)| *k == "a").unwrap().1;
        assert!((a - (1.0 / 61.0 + 1.0 / 63.0)).abs() < 1e-12);
        let b = fused.iter().find(|(k, _, _)| *k == "b").unwrap().1;
        assert!((b - 1.0 / 62.0).abs() < 1e-12);

        assert!(rrf_merge::<u8>(&[], &[]).is_empty());
        let only_meaning = rrf_merge(&[], &[1, 2]);
        assert!(only_meaning.iter().all(|(_, _, m)| *m == Matched::Meaning));
    }

    #[test]
    fn first_words_cuts_at_thirty() {
        let text = (0..50).map(|i| format!("w{i}")).collect::<Vec<_>>().join(" ");
        let snippet = first_words(&text, 30);
        assert!(snippet.ends_with('\u{2026}'));
        assert_eq!(snippet.split_whitespace().count(), 30);
        assert_eq!(first_words("short one", 30), "short one");
    }
}
