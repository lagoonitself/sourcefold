//! Tests that run the whole search path (catalog entries -> indexer -> query) on a temp folder.
//! They never touch the app's real data folder: every test makes its own `SearchStore`.

use std::fs;
use std::path::{Path, PathBuf};

use super::catalog::{self, CatalogEntry, CatalogState};
use super::indexer::{sync_catalog, sync_project};
use super::query::{self, Matched, SearchRequest};
use super::store::{SearchStore, VECTOR_DIMS};

struct Temp(PathBuf);

impl Temp {
    fn new(name: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("sourcefold-search-{}-{}", name, uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }
    fn store(&self) -> SearchStore {
        SearchStore::new(self.0.join("search"))
    }
    fn files(&self) -> PathBuf {
        let dir = self.0.join("files");
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn md(title: &str, body: &str) -> String {
    format!("---\nsource: web\ntitle: {title}\nurl: https://example.com/x\n---\n\n# {title}\n\n{body}\n")
}

fn entry(files: &Path, project: &str, id: &str, title: &str, body: &str) -> CatalogEntry {
    let path = files.join(format!("{id}.md"));
    fs::write(&path, md(title, body)).unwrap();
    CatalogEntry {
        item_id: id.into(),
        project_id: project.into(),
        folder_id: format!("{project}-group"),
        title: title.into(),
        kind: "web".into(),
        url: None,
        path,
    }
}

fn request(query: &str, scope: &str, project: Option<&str>) -> SearchRequest {
    SearchRequest {
        query: query.into(),
        scope: scope.into(),
        project_id: project.map(String::from),
        query_vector: None,
        model: None,
        limit: None,
    }
}

fn catalog_of(entries: Vec<CatalogEntry>) -> catalog::Catalog {
    catalog::Catalog { state: CatalogState::Ready, entries }
}

fn unit_vector(hot: usize) -> Vec<f32> {
    let mut v = vec![0.0; VECTOR_DIMS];
    v[hot] = 1.0;
    v
}

#[test]
fn a_project_search_never_returns_another_projects_text() {
    let t = Temp::new("isolation");
    let store = t.store();
    let files = t.files();
    let catalog = catalog_of(vec![
        entry(&files, "alpha", "a1", "Alpha Notes", "The turbocharger spins fast in project alpha."),
        entry(&files, "beta", "b1", "Beta Notes", "A turbocharger also appears in project beta."),
    ]);
    sync_catalog(&store, &catalog);
    assert!(store.index_path("alpha").exists() && store.index_path("beta").exists());

    let only_alpha = query::run(&store, &request("turbocharger", "project", Some("alpha"))).unwrap();
    assert_eq!(only_alpha.passages.len(), 1);
    assert_eq!(only_alpha.passages[0].project_id, "alpha");
    assert_eq!(only_alpha.passages[0].item_id, "a1");
    assert!(!only_alpha.passages[0].snippet.contains("beta"));

    let only_beta = query::run(&store, &request("turbocharger", "project", Some("beta"))).unwrap();
    assert_eq!(only_beta.passages.len(), 1);
    assert_eq!(only_beta.passages[0].project_id, "beta");

    let all = query::run(&store, &request("turbocharger", "all", None)).unwrap();
    let mut projects: Vec<&str> = all.passages.iter().map(|p| p.project_id.as_str()).collect();
    projects.sort_unstable();
    assert_eq!(projects, vec!["alpha", "beta"]);

    // A word only project B has can't be found from A.
    let none = query::run(&store, &request("beta", "project", Some("alpha"))).unwrap();
    assert!(none.passages.is_empty());

    // A project that has no index answers with nothing; a project scope needs a project.
    assert!(query::run(&store, &request("turbo", "project", Some("nope"))).unwrap().passages.is_empty());
    assert!(query::run(&store, &request("turbo", "project", None)).is_err());
    assert!(query::run(&store, &request("turbo", "world", None)).is_err());
}

#[test]
fn rows_carry_the_catalog_fields_and_marked_snippets() {
    let t = Temp::new("rows");
    let store = t.store();
    let files = t.files();
    let catalog = catalog_of(vec![entry(
        &files,
        "alpha",
        "a1",
        "How Turbos Work",
        "## Boost\n\nThe turbocharger forces extra air into the engine.",
    )]);
    sync_catalog(&store, &catalog);

    let response = query::run(&store, &request("turbocharger", "project", Some("alpha"))).unwrap();
    let hit = &response.passages[0];
    assert_eq!(hit.title, "How Turbos Work");
    assert_eq!(hit.kind, "web");
    assert_eq!(hit.folder_id, "alpha-group");
    assert_eq!(hit.url.as_deref(), Some("https://example.com/x"));
    assert_eq!(hit.heading, "Boost");
    assert_eq!(hit.matched, Matched::Keyword);
    assert!(hit.snippet.contains("\u{2}turbocharger\u{3}"), "{:?}", hit.snippet);
    assert!(hit.passage_start.starts_with("The turbocharger forces"));
    assert_eq!(response.meaning, "off");

    let json = serde_json::to_value(&response).unwrap();
    assert_eq!(json["passages"][0]["matched"], "keyword");
    assert!(json["took_ms"].is_number());
    assert_eq!(json["meaning"], "off");
    assert!(json["passages"][0]["seconds"].is_null());
}

#[test]
fn phrases_exclusions_and_prefixes_work_end_to_end() {
    let t = Temp::new("syntax");
    let store = t.store();
    let files = t.files();
    let catalog = catalog_of(vec![
        entry(&files, "p", "s1", "One", "Boost pressure builds slowly after the lag."),
        entry(&files, "p", "s2", "Two", "Pressure and boost are different ideas, and lag is gone."),
        entry(&files, "p", "s3", "Three", "The turbocharger is a forced induction device."),
    ]);
    sync_catalog(&store, &catalog);
    let ids = |q: &str| -> Vec<String> {
        let mut ids: Vec<String> = query::run(&store, &request(q, "project", Some("p")))
            .unwrap()
            .passages
            .into_iter()
            .map(|p| p.item_id)
            .collect();
        ids.sort();
        ids
    };
    assert_eq!(ids("\"boost pressure\""), vec!["s1"]);
    assert_eq!(ids("boost pressure"), vec!["s1", "s2"]);
    assert_eq!(ids("boost -\"boost pressure\""), vec!["s2"]);
    assert_eq!(ids("pressure -slowly"), vec!["s2"]);
    assert!(ids("-lag").is_empty(), "only exclusions find nothing by keyword");
    // The last word is a prefix while typing, and stemming still works.
    assert_eq!(ids("turbo"), vec!["s3"]);
    assert_eq!(ids("turbochargers"), vec!["s3"]);
    // FTS5 syntax typed by the user is just words.
    assert_eq!(ids("boost AND ("), vec!["s2"], "AND is an ordinary word here");
    assert!(ids("\"unbalanced").is_empty());
    assert!(ids("NEAR(boost lag) col:text ^x * -").is_empty());
    assert!(ids("   ").is_empty());
}

#[test]
fn a_word_deep_inside_a_large_article_is_found() {
    let t = Temp::new("large");
    let store = t.store();
    let files = t.files();
    let mut body = String::new();
    for section in 0..75 {
        body.push_str(&format!("## Section {section}\n\n"));
        for paragraph in 0..12 {
            body.push_str(&format!(
                "Filler sentence number {paragraph} of section {section} says nothing special at all about anything, \
                 repeating the same ordinary words so the article gets long and dull for the chunker. \
                 It goes on for a while to build up bulk in this particular paragraph of the test text.\n\n"
            ));
            if section == 47 && paragraph == 9 {
                body.push_str("Here the unmistakable zymurgy appears exactly once.\n\n");
            }
        }
    }
    assert!(body.len() > 200_000, "{} bytes", body.len());
    let catalog = catalog_of(vec![entry(&files, "big", "g1", "A Long Article", &body)]);
    let stats = sync_catalog(&store, &catalog);
    assert_eq!(stats.failed, 0, "{:?}", stats.first_error);

    let response = query::run(&store, &request("zymurgy", "project", Some("big"))).unwrap();
    assert_eq!(response.passages.len(), 1);
    let hit = &response.passages[0];
    assert!(hit.snippet.contains("\u{2}zymurgy\u{3}"));
    assert_eq!(hit.heading, "Section 47");
    assert!(store.counts(Some("big"), None).unwrap().passages_total > 100);
}

#[test]
fn a_source_gives_at_most_three_passages() {
    let t = Temp::new("cap");
    let store = t.store();
    let files = t.files();
    let mut body = String::new();
    for n in 0..8 {
        body.push_str(&format!("## Part {n}\n\nThe gearbox is mentioned in part {n}.\n\n"));
    }
    let catalog = catalog_of(vec![
        entry(&files, "p", "long", "Long", &body),
        entry(&files, "p", "short", "Short", "One gearbox here."),
    ]);
    sync_catalog(&store, &catalog);
    let response = query::run(&store, &request("gearbox", "project", Some("p"))).unwrap();
    let from_long = response.passages.iter().filter(|p| p.item_id == "long").count();
    assert_eq!(from_long, 3);
    assert_eq!(response.passages.iter().filter(|p| p.item_id == "short").count(), 1);

    let mut limited = request("gearbox", "project", Some("p"));
    limited.limit = Some(2);
    assert_eq!(query::run(&store, &limited).unwrap().passages.len(), 2);
}

#[test]
fn highlights_and_notes_are_listed_apart_from_the_body() {
    let t = Temp::new("notes");
    let store = t.store();
    let files = t.files();
    let path = files.join("n1.md");
    fs::write(
        &path,
        "---\nsource: web\ntitle: Turbos\nurl: https://example.com/t\n---\n\n# Turbos\n\nA wastegate limits boost.\n\n## My highlights\n\n> The wastegate opens at high pressure.\n\nNote: remember this\n\n## My note\n\nAsk about the wastegate again.\n",
    )
    .unwrap();
    let item = CatalogEntry {
        item_id: "n1".into(),
        project_id: "p".into(),
        folder_id: "g".into(),
        title: "Turbos".into(),
        kind: "web".into(),
        url: None,
        path,
    };
    sync_catalog(&store, &catalog_of(vec![item]));
    let response = query::run(&store, &request("wastegate", "project", Some("p"))).unwrap();
    assert_eq!(response.passages.len(), 1);
    assert!(response.passages[0].passage_start.starts_with("A wastegate"));
    let mut sources: Vec<&str> = response.notes.iter().map(|n| n.source.as_str()).collect();
    sources.sort_unstable();
    assert_eq!(sources, vec!["highlight", "note"]);
    let highlight = response.notes.iter().find(|n| n.source == "highlight").unwrap();
    assert!(highlight.passage_start.starts_with("The wastegate opens"));
    assert_eq!(highlight.title, "Turbos");
    let json = serde_json::to_value(&response).unwrap();
    assert_eq!(json["notes"][0]["item_id"], "n1");
}

#[test]
fn the_indexer_follows_edits_moves_and_deletions() {
    let t = Temp::new("follow");
    let store = t.store();
    let files = t.files();
    let mut a = entry(&files, "alpha", "x1", "Doc", "Original sentence about gaskets.");
    let b = entry(&files, "beta", "y1", "Other", "Something about pistons.");
    let stats = sync_catalog(&store, &catalog_of(vec![a.clone(), b.clone()]));
    assert_eq!(stats.reindexed, 2);

    // Nothing changed: nothing is read again.
    let again = sync_catalog(&store, &catalog_of(vec![a.clone(), b.clone()]));
    assert_eq!((again.reindexed, again.unchanged), (0, 2));

    // The file changes.
    fs::write(&a.path, md("Doc", "Rewritten sentence about camshafts, with more bytes.")).unwrap();
    let edited = sync_catalog(&store, &catalog_of(vec![a.clone(), b.clone()]));
    assert_eq!(edited.reindexed, 1);
    assert!(query::run(&store, &request("gaskets", "all", None)).unwrap().passages.is_empty());
    assert_eq!(query::run(&store, &request("camshafts", "all", None)).unwrap().passages.len(), 1);

    // The source moves to the other project: gone from alpha, whose file then goes too.
    a.project_id = "beta".into();
    sync_catalog(&store, &catalog_of(vec![a.clone(), b.clone()]));
    assert!(!store.index_path("alpha").exists());
    let moved = query::run(&store, &request("camshafts", "project", Some("beta"))).unwrap();
    assert_eq!(moved.passages[0].project_id, "beta");

    // An item vanishes from the catalog.
    sync_catalog(&store, &catalog_of(vec![b.clone()]));
    assert!(query::run(&store, &request("camshafts", "all", None)).unwrap().passages.is_empty());
    assert_eq!(query::run(&store, &request("pistons", "all", None)).unwrap().passages.len(), 1);

    // A file missing from disk keeps its old rows.
    fs::remove_file(&b.path).unwrap();
    sync_catalog(&store, &catalog_of(vec![b.clone()]));
    assert_eq!(query::run(&store, &request("pistons", "all", None)).unwrap().passages.len(), 1);

    // No sources at all: every index file goes.
    sync_catalog(&store, &catalog_of(vec![]));
    assert!(store.list_projects().is_empty());
}

#[test]
fn a_renamed_title_reindexes_even_when_the_bytes_are_the_same() {
    let t = Temp::new("title");
    let store = t.store();
    let files = t.files();
    let mut e = entry(&files, "p", "t1", "Old Name", "Body about sprockets.");
    sync_project(&store, "p", &[&e]);
    e.title = "New Name".into();
    sync_project(&store, "p", &[&e]);
    let hit = &query::run(&store, &request("sprockets", "project", Some("p"))).unwrap().passages[0];
    assert_eq!(hit.title, "New Name");
}

#[test]
fn rechunking_keeps_the_vectors_of_unchanged_passages() {
    let t = Temp::new("keep");
    let store = t.store();
    let files = t.files();
    let e = entry(
        &files,
        "p",
        "k1",
        "Keep",
        "## First\n\nThe first section never changes at all.\n\n## Second\n\nThe second section is going to change.",
    );
    sync_project(&store, "p", &[&e]);
    let model = "test/model/256";
    let jobs = store.embed_jobs(model, 100, None).unwrap();
    assert_eq!(jobs.len(), 2);
    assert!(jobs.iter().all(|j| j.input.starts_with("title: Keep | text: ")));
    let vectors: Vec<(String, String, Vec<f32>)> = jobs
        .iter()
        .enumerate()
        .map(|(i, j)| (j.project_id.clone(), j.text_hash.clone(), unit_vector(i)))
        .collect();
    assert_eq!(store.put_vectors(model, &vectors).unwrap(), 2);
    assert_eq!(store.counts(Some("p"), Some(model)).unwrap().passages_embedded, 2);

    // Edit only the second section.
    fs::write(
        &e.path,
        md(
            "Keep",
            "## First\n\nThe first section never changes at all.\n\n## Second\n\nThe second section now says something else entirely.",
        ),
    )
    .unwrap();
    sync_project(&store, "p", &[&e]);
    let counts = store.counts(Some("p"), Some(model)).unwrap();
    assert_eq!(counts.passages_total, 2);
    assert_eq!(counts.passages_embedded, 1, "the unchanged passage keeps its vector");
    let todo = store.embed_jobs(model, 100, None).unwrap();
    assert_eq!(todo.len(), 1);
    assert!(todo[0].input.contains("something else"));
    // The old second-section vector was pruned.
    let handle = store.handle("p", false).unwrap().unwrap();
    let rows: i64 =
        handle.with_read(|c| c.query_row("SELECT COUNT(*) FROM vectors", [], |r| r.get(0))).unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn put_vectors_checks_every_vector_before_storing_any() {
    let t = Temp::new("put");
    let store = t.store();
    let files = t.files();
    let e = entry(&files, "p", "v1", "Vec", "Some text to embed.");
    sync_project(&store, "p", &[&e]);
    let model = "m/256";
    let job = store.embed_jobs(model, 10, None).unwrap().remove(0);
    let good = (job.project_id.clone(), job.text_hash.clone(), unit_vector(3));

    let short = (job.project_id.clone(), job.text_hash.clone(), vec![0.5; VECTOR_DIMS - 1]);
    let long = (job.project_id.clone(), job.text_hash.clone(), vec![0.5; VECTOR_DIMS + 1]);
    let mut nan = unit_vector(0);
    nan[7] = f32::NAN;
    let mut inf = unit_vector(0);
    inf[9] = f32::INFINITY;
    for bad in [
        short,
        long,
        (job.project_id.clone(), job.text_hash.clone(), nan),
        (job.project_id.clone(), job.text_hash.clone(), inf),
        ("../escape".to_string(), job.text_hash.clone(), unit_vector(0)),
    ] {
        assert!(store.put_vectors(model, &[good.clone(), bad]).is_err());
        assert_eq!(store.counts(Some("p"), Some(model)).unwrap().passages_embedded, 0, "nothing stored");
    }
    assert!(store.put_vectors("  ", std::slice::from_ref(&good)).is_err());

    // A hash no passage has is quietly dropped; a good one is kept.
    let stray = (job.project_id.clone(), "0000000000000000".to_string(), unit_vector(1));
    assert_eq!(store.put_vectors(model, &[stray, good]).unwrap(), 1);
    assert_eq!(store.counts(Some("p"), Some(model)).unwrap().passages_embedded, 1);
    // Other models' vectors don't count for this one.
    assert_eq!(store.counts(Some("p"), Some("other")).unwrap().passages_embedded, 0);

    store.delete_vectors().unwrap();
    assert_eq!(store.counts(Some("p"), Some(model)).unwrap().passages_embedded, 0);
    assert_eq!(store.counts(Some("p"), None).unwrap().passages_total, 1);
}

#[test]
fn meaning_search_finds_passages_without_the_words_and_merges_with_keywords() {
    let t = Temp::new("meaning");
    let store = t.store();
    let files = t.files();
    let catalog = catalog_of(vec![
        entry(&files, "p", "lag", "Turbo", "The wait before the motor responds is annoying."),
        entry(&files, "p", "other", "Cooking", "Bake the bread for forty minutes."),
        entry(&files, "p", "both", "Both", "The wait is short and the engine responds quickly."),
    ]);
    sync_catalog(&store, &catalog);
    let model = "m/256";
    let jobs = store.embed_jobs(model, 10, None).unwrap();
    assert_eq!(jobs.len(), 3);
    // "lag" and "both" get vectors near the query direction, "other" an orthogonal one.
    let mut vectors = Vec::new();
    for job in &jobs {
        let v = if job.input.contains("annoying") {
            unit_vector(0)
        } else if job.input.contains("responds quickly") {
            let mut v = unit_vector(0);
            v[1] = 0.5;
            v
        } else {
            unit_vector(5)
        };
        vectors.push((job.project_id.clone(), job.text_hash.clone(), v));
    }
    store.put_vectors(model, &vectors).unwrap();

    let mut req = request("engine", "project", Some("p"));
    req.query_vector = Some(unit_vector(0));
    req.model = Some(model.into());
    let response = query::run(&store, &req).unwrap();
    assert_eq!(response.meaning, "used");
    let by_id = |id: &str| response.passages.iter().find(|p| p.item_id == id);
    let lag = by_id("lag").expect("found by meaning");
    assert_eq!(lag.matched, Matched::Meaning);
    assert!(!lag.snippet.contains('\u{2}'), "meaning snippets have no marks");
    assert!(lag.snippet.starts_with("The wait before"));
    assert_eq!(by_id("both").expect("found both ways").matched, Matched::Both);
    assert!(by_id("other").is_none(), "below the cosine floor");
    assert_eq!(response.passages[0].item_id, "both", "both lists agree, so it ranks first");

    // The wrong model key finds nothing by meaning.
    req.model = Some("other/256".into());
    let off = query::run(&store, &req).unwrap();
    assert_eq!(off.meaning, "off");
    assert!(off.passages.iter().all(|p| p.matched == Matched::Keyword));

    // A query that is all exclusions can still be answered by meaning.
    let mut only_vector = request("-engine", "project", Some("p"));
    only_vector.query_vector = Some(unit_vector(0));
    only_vector.model = Some(model.into());
    let r = query::run(&store, &only_vector).unwrap();
    assert!(r.passages.iter().all(|p| p.matched == Matched::Meaning));
    assert!(!r.passages.is_empty());

    // A wrong-sized vector is ignored, not an error.
    let mut bad = request("engine", "project", Some("p"));
    bad.query_vector = Some(vec![1.0; 10]);
    bad.model = Some(model.into());
    assert_eq!(query::run(&store, &bad).unwrap().meaning, "off");
}

#[test]
fn delete_all_removes_the_index_and_it_can_be_rebuilt() {
    let t = Temp::new("delete");
    let store = t.store();
    let files = t.files();
    sync_catalog(&store, &catalog_of(vec![entry(&files, "p", "d1", "D", "Text about axles.")]));
    assert!(store.disk_bytes() > 0);
    let counts = store.counts(None, None).unwrap();
    assert_eq!((counts.sources_indexed, counts.passages_total), (1, 1));
    store.delete_all().unwrap();
    assert!(store.list_projects().is_empty());
    assert_eq!(store.disk_bytes(), 0);
    assert!(query::run(&store, &request("axles", "all", None)).unwrap().passages.is_empty());
    sync_catalog(&store, &catalog_of(vec![entry(&files, "p", "d1", "D", "Text about axles.")]));
    assert_eq!(query::run(&store, &request("axles", "all", None)).unwrap().passages.len(), 1);
}

#[test]
fn project_ids_that_could_change_a_path_are_refused() {
    let t = Temp::new("ids");
    let store = t.store();
    for bad in ["", "../x", "a/b", "a\\b", "x.sqlite", "a b"] {
        assert!(store.handle(bad, true).is_err(), "{bad:?}");
    }
    assert!(store.handle("0f8c-UUID_ok", true).is_ok());
}

#[test]
fn notify_is_harmless_when_nothing_is_listening() {
    super::notify();
    super::notify();
}

#[test]
fn status_reports_counts_pause_and_its_json_shape() {
    use crate::db::Database;
    let t = Temp::new("status");
    let store = t.store();
    let files = t.files();
    sync_catalog(&store, &catalog_of(vec![entry(&files, "p", "s1", "S", "Words about valves.")]));
    let db = Database::open_in_memory().unwrap();

    let status = super::status(&db, &store, Some("p"), Some("m/256")).unwrap();
    assert_eq!((status.sources_indexed, status.passages_total, status.passages_embedded), (1, 1, 0));
    assert!(status.disk_bytes > 0);
    let json = serde_json::to_value(&status).unwrap();
    for key in ["state", "message", "sources_total", "sources_indexed", "passages_total", "passages_embedded", "disk_bytes"] {
        assert!(json.get(key).is_some(), "{key}");
    }

    assert!(!super::is_paused(&db));
    super::set_paused(&db, true).unwrap();
    assert!(super::is_paused(&db));
    assert_eq!(super::status(&db, &store, None, None).unwrap().state, "paused");
    super::set_paused(&db, false).unwrap();
    assert!(!super::is_paused(&db));
}

mod catalog_db {
    use super::*;
    use crate::db::Database;

    #[test]
    fn offline_catalog_groups_items_by_their_top_level_project() {
        let db = Database::open_in_memory().unwrap();
        let t = Temp::new("offline-catalog");
        let root = t.files();
        db.set_setting("storage_dir", &root.to_string_lossy()).unwrap();
        crate::service::create_note(&db, "general", "My Note", "hello catalog").unwrap();

        let catalog = catalog::build_offline(&db, &root).unwrap();
        assert_eq!(catalog.state, CatalogState::Ready);
        assert_eq!(catalog.entries.len(), 1);
        let entry = &catalog.entries[0];
        assert_eq!(entry.project_id, "inbox");
        assert_eq!(entry.folder_id, "general");
        assert_eq!(entry.kind, "note");
        assert!(entry.path.is_file(), "{:?}", entry.path);

        // The same catalog drives the indexer: the note is searchable, and it is a note.
        let store = t.store();
        sync_catalog(&store, &catalog);
        let found = query::run(&store, &request("catalog", "project", Some("inbox"))).unwrap();
        assert_eq!(found.passages.len() + found.notes.len(), 1);
        assert_eq!(found.notes[0].source, "note");
    }

    #[test]
    fn signed_in_catalog_states() {
        let db = Database::open_in_memory().unwrap();
        let root = std::env::temp_dir().join("sourcefold-catalog-root");

        crate::local_copy::set_enabled(&db, false).unwrap();
        assert_eq!(catalog::build_signed_in(&db, &root).unwrap().state, CatalogState::NeedsLocalCopy);

        crate::local_copy::set_enabled(&db, true).unwrap();
        assert_eq!(catalog::build_signed_in(&db, &root).unwrap().state, CatalogState::Ready);

        // Files the local copy wrote before the web app described them.
        db.set_local_copy_file("i1", "Proj/a.md", "v1").unwrap();
        assert_eq!(catalog::build_signed_in(&db, &root).unwrap().state, CatalogState::Waiting);
        // Described, but without a project: the web app is too old.
        db.set_local_copy_meta(&[("i1".into(), None, None, None, "web".into())]).unwrap();
        assert_eq!(catalog::build_signed_in(&db, &root).unwrap().state, CatalogState::NeedsWebUpdate);

        // With a project it is searchable, and a Word copy never is.
        db.set_local_copy_meta(&[(
            "i1".into(),
            Some("proj-1".into()),
            Some("group-1".into()),
            Some("Title".into()),
            "web".into(),
        )])
        .unwrap();
        db.set_local_copy_file("i1:docx", "Proj/a.docx", "v1").unwrap();
        let catalog = catalog::build_signed_in(&db, &root).unwrap();
        assert_eq!(catalog.state, CatalogState::Ready);
        assert_eq!(catalog.entries.len(), 1);
        assert_eq!(catalog.entries[0].project_id, "proj-1");
        assert_eq!(catalog.entries[0].folder_id, "group-1");
        assert_eq!(catalog.entries[0].title, "Title");
        assert_eq!(catalog.entries[0].path, root.join("Proj").join("a.md"));
        assert_eq!(catalog.counts().get("proj-1"), Some(&1));
    }
}
