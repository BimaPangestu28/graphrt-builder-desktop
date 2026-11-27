//! One test per threat of the module docs, plus the opt-in rule.

use std::path::PathBuf;
use std::sync::Arc;

use futures::StreamExt;
use graphrt_core::tool::{ToolCallContext, ToolRegistry};
use graphrt_core::{Engine, RunInput, Services};
use graphrt_files::WorkspacePath;
use serde_json::json;

use super::abilities::{FlowFileUse, DOCUMENTS_PROVIDER, FILES_PROVIDER, IMAGE_PROVIDER};
use super::cards::{cards_for_references, FileCardKind, PreviewKind};
use super::run_files::references_in_run_events;
use super::*;

const PHOTO_WITH_GPS: &[u8] = include_bytes!("../../fixtures/agent-files/photo-with-gps.jpg");
const ROTATED_PHOTO_WITH_GPS: &[u8] = include_bytes!("../../fixtures/agent-files/photo-rotated-with-gps.jpg");
const LOGO_PNG: &[u8] = include_bytes!("../../fixtures/agent-files/logo.png");
/// Text the fixture photos carry in their EXIF (the camera model).
const EXIF_SECRET: &[u8] = b"SecretPhone";

const EVERYTHING: FileAbilities = FileAbilities { reads_files: true, sees_pictures: true, makes_files: true };

/// An agent that reads and writes files, makes documents and looks at pictures.
const FILES_AGENT_FLOW: &str = r#"
version: "1"
name: files-agent
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: agent
      type: agent
      model: { provider: openai, name: gpt-4o-mini }
      query: "{{#start.message#}}"
      tools: [files/*, documents/*, image/*]
      vision: { enabled: true }
    - id: end
      type: end
      outputs:
        - { variable: answer, value_selector: [agent, text] }
  edges:
    - { source: start, target: agent }
    - { source: agent, target: end }
"#;

/// Writes a note with a `tool` step (no model) and returns it in the run's outputs.
const WRITE_NOTE_FLOW: &str = r##"
version: "1"
name: write-note
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: body, type: paragraph, required: true }
    - id: write
      type: tool
      provider_id: files
      tool_name: write
      tool_parameters:
        path: { type: constant, value: "notes/stock.md" }
        content: { type: mixed, value: "# Stock\n\n{{#start.body#}}\n" }
    - id: end
      type: end
      outputs:
        - { variable: files, value_selector: [write, files] }
  edges:
    - { source: start, target: write }
    - { source: write, target: end }
"##;

const PLAIN_FLOW: &str = include_str!("../../fixtures/flows/simple_answer.yaml");

struct Fixture {
    /// Holds the app data folder and the files a person "has on their computer".
    home: tempfile::TempDir,
    files: Arc<AgentFiles>,
}

impl Fixture {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let files = Arc::new(AgentFiles::new(&home.path().join("app-data")));
        Self { home, files }
    }

    /// A file on the person's computer.
    fn host_file(&self, name: &str, contents: &[u8]) -> PathBuf {
        let path = self.home.path().join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    async fn attach(&self, scope: &FileScope, abilities: FileAbilities, path: PathBuf) -> AttachOutcome {
        let outcomes =
            self.files.attach_host_files(scope, abilities, vec![path], PathOrigin::PickedInDialog, 0).await.unwrap();
        outcomes.into_iter().next().unwrap()
    }

    /// What the workspace holds for the stored file `card` names.
    async fn stored_bytes(&self, scope: &FileScope, card: &FileCard) -> Vec<u8> {
        let view = self.files.view(scope).unwrap();
        let path = view.path_of_reference(&card.reference).unwrap();
        view.read_all(&path, u64::MAX).await.unwrap()
    }

    fn workspace_root(&self) -> PathBuf {
        self.home.path().join("app-data").join(AGENT_FILES_DIR_NAME)
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

fn problem_of(outcome: &AttachOutcome) -> Option<AttachProblem> {
    assert_eq!(outcome.card.is_none(), outcome.problem.is_some(), "an outcome is a card or a problem");
    outcome.problem
}

/// A PNG that is only a header declaring `width` x `height` pixels.
fn png_header_declaring(width: u32, height: u32) -> Vec<u8> {
    let mut header = Vec::from(*b"IHDR");
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    let mut checksum = flate2::Crc::new();
    checksum.update(&header);
    let mut png = Vec::from(*b"\x89PNG\r\n\x1a\n");
    png.extend_from_slice(&13_u32.to_be_bytes());
    png.extend_from_slice(&header);
    png.extend_from_slice(&checksum.sum().to_be_bytes());
    png
}

// --- Opt-in: nothing is set up for an agent that does not use files ---

#[test]
fn a_workflow_without_file_steps_uses_nothing() {
    let file_use = FlowFileUse::of(PLAIN_FLOW);
    assert_eq!(file_use, FlowFileUse::default());
    assert!(!file_use.any());
    assert_eq!(file_use.abilities(), FileAbilities::default());
    assert!(!file_use.abilities().takes_attachments());
}

#[test]
fn file_features_are_read_from_the_steps() {
    assert_eq!(
        FlowFileUse::of(FILES_AGENT_FLOW),
        FlowFileUse { file_tools: true, document_tools: true, image_tools: true, vision: true }
    );
    assert_eq!(FlowFileUse::of(FILES_AGENT_FLOW).abilities(), EVERYTHING);
    // A `tool` step counts too, and a picture-only agent reads no documents.
    let write_only = FlowFileUse::of(WRITE_NOTE_FLOW);
    assert_eq!(write_only, FlowFileUse { file_tools: true, ..FlowFileUse::default() });
    let vision_only = FILES_AGENT_FLOW.replace("      tools: [files/*, documents/*, image/*]\n", "");
    assert_eq!(
        FlowFileUse::of(&vision_only).abilities(),
        FileAbilities { reads_files: false, sees_pictures: true, makes_files: false }
    );
    // A step that only mentions the words is not a step that uses the tools.
    let mentions = PLAIN_FLOW.replace("name: ", "description: about files and vision\nname: ");
    assert_eq!(FlowFileUse::of(&mentions), FlowFileUse::default());
    assert_eq!(FlowFileUse::of("not a workflow: [files"), FlowFileUse::default());
}

#[test]
fn provider_names_match_the_runtime() {
    assert_eq!(FILES_PROVIDER, graphrt_files::PROVIDER);
    assert_eq!(DOCUMENTS_PROVIDER, graphrt_docgen::PROVIDER);
    assert_eq!(IMAGE_PROVIDER, graphrt_image::PROVIDER);
}

#[tokio::test]
async fn an_agent_without_file_steps_gets_no_tools_and_no_folder() {
    let fixture = Fixture::new();
    let access = FileAccess { files: fixture.files.clone(), scope: FileScope::agent("agent-1") };
    let mut tools = ToolRegistry::new();
    let wiring = access.wire(PLAIN_FLOW, &mut tools).unwrap();
    assert!(wiring.resolver.is_none());
    assert!(!wiring.vision);
    assert_eq!(tools.providers().count(), 0);
    assert!(!fixture.workspace_root().exists(), "no folder is created for an agent that uses no files");
    // Its runs make no files either, and asking does not create a folder.
    assert!(fixture
        .files
        .run_file_cards("agent-1", &[json!({"type": "run_succeeded", "outputs": {}})])
        .await
        .unwrap()
        .is_empty());
    assert!(!fixture.workspace_root().exists());
}

#[tokio::test]
async fn an_agent_gets_exactly_the_tools_its_steps_use_and_never_delete() {
    let fixture = Fixture::new();
    let access = FileAccess { files: fixture.files.clone(), scope: FileScope::agent("agent-1") };
    let mut tools = ToolRegistry::new();
    let wiring = access.wire(WRITE_NOTE_FLOW, &mut tools).unwrap();
    assert!(wiring.resolver.is_some());
    assert!(!wiring.vision);
    let providers: Vec<&str> = tools.providers().map(|(name, _)| name).collect();
    assert_eq!(providers, [FILES_PROVIDER]);
    let file_tools = tools.get(FILES_PROVIDER).unwrap();
    let names: Vec<String> = file_tools.list().await.unwrap().into_iter().map(|spec| spec.name).collect();
    assert!(names.contains(&"read".to_owned()) && names.contains(&"write".to_owned()), "{names:?}");
    assert!(!names.contains(&"delete".to_owned()), "an agent is never offered delete: {names:?}");

    let mut all_tools = ToolRegistry::new();
    let wiring = access.wire(FILES_AGENT_FLOW, &mut all_tools).unwrap();
    assert!(wiring.vision);
    let mut providers: Vec<&str> = all_tools.providers().map(|(name, _)| name).collect();
    providers.sort_unstable();
    assert_eq!(providers, [DOCUMENTS_PROVIDER, FILES_PROVIDER, IMAGE_PROVIDER]);
    let image_tools: Vec<String> =
        all_tools.get(IMAGE_PROVIDER).unwrap().list().await.unwrap().into_iter().map(|spec| spec.name).collect();
    assert!(!image_tools.contains(&"generate".to_owned()), "no image generator is wired: {image_tools:?}");
}

// --- Paths from the webview are not trusted ---

#[tokio::test]
async fn a_path_the_window_did_not_report_as_dropped_is_refused() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let secret = fixture.host_file("id_rsa.txt", b"PRIVATE KEY");
    let attach_dropped = |path: PathBuf| {
        let files = fixture.files.clone();
        let scope = scope.clone();
        async move {
            let outcomes = files.attach_host_files(&scope, EVERYTHING, vec![path], PathOrigin::Dropped, 0).await;
            outcomes.unwrap().into_iter().next().unwrap()
        }
    };

    // The webview names a path nobody dropped.
    let refused = attach_dropped(secret.clone()).await;
    assert_eq!(problem_of(&refused), Some(AttachProblem::NotChosen));
    assert_eq!(refused.name, "id_rsa.txt", "only the file's own name is echoed, never its folder");

    // The window reported the drop: taken once, then forgotten.
    fixture.files.remember_dropped(std::slice::from_ref(&secret));
    assert_eq!(problem_of(&attach_dropped(secret.clone()).await), None);
    assert_eq!(problem_of(&attach_dropped(secret).await), Some(AttachProblem::NotChosen));
}

#[tokio::test]
async fn only_regular_files_are_read() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let folder = fixture.home.path().join("a-folder");
    std::fs::create_dir(&folder).unwrap();
    assert_eq!(problem_of(&fixture.attach(&scope, EVERYTHING, folder).await), Some(AttachProblem::NotAFile));
    let missing = fixture.home.path().join("missing.txt");
    assert_eq!(problem_of(&fixture.attach(&scope, EVERYTHING, missing).await), Some(AttachProblem::NotAFile));
    let relative = PathBuf::from("notes.txt");
    assert_eq!(problem_of(&fixture.attach(&scope, EVERYTHING, relative).await), Some(AttachProblem::NotChosen));
    let empty = fixture.host_file("empty.txt", b"");
    assert_eq!(problem_of(&fixture.attach(&scope, EVERYTHING, empty).await), Some(AttachProblem::Empty));
}

/// A named pipe would block the reader for ever: it is refused before it is opened.
#[cfg(unix)]
#[tokio::test]
async fn a_named_pipe_is_refused_without_being_opened() {
    let fixture = Fixture::new();
    let pipe = fixture.home.path().join("pipe.txt");
    let made = std::process::Command::new("mkfifo").arg(&pipe).status().unwrap();
    assert!(made.success());
    let scope = FileScope::conversation("agent-1", "chat-1");
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(5), fixture.attach(&scope, EVERYTHING, pipe));
    assert_eq!(problem_of(&outcome.await.expect("attaching a pipe must not hang")), Some(AttachProblem::NotAFile));
}

// --- Size and type come from the content ---

#[tokio::test]
async fn a_file_above_the_limit_is_refused_before_it_is_read() {
    let fixture = Fixture::new();
    let large = fixture.home.path().join("large.txt");
    // A sparse file: the size is checked from the open handle, nothing is read.
    std::fs::File::create(&large).unwrap().set_len(MAX_ATTACHMENT_BYTES + 1).unwrap();
    let scope = FileScope::conversation("agent-1", "chat-1");
    assert_eq!(problem_of(&fixture.attach(&scope, EVERYTHING, large).await), Some(AttachProblem::TooLarge));
}

#[tokio::test]
async fn the_kind_of_a_file_comes_from_its_content_not_its_name() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let refused: [(&str, &[u8]); 5] = [
        ("report.pdf", b"\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0"),
        ("install.txt", b"#!/bin/sh\nrm -rf ~\n"),
        ("notes.txt", b"<!DOCTYPE html><html><script>alert(1)</script></html>"),
        ("picture.png", b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"),
        ("photos.zip", b"PK\x03\x04\x14\0\0\0\x08\0garbage"),
    ];
    for (name, contents) in refused {
        let outcome = fixture.attach(&scope, EVERYTHING, fixture.host_file(name, contents)).await;
        assert_eq!(problem_of(&outcome), Some(AttachProblem::UnsupportedKind), "{name}");
    }
    assert!(fixture.files.view(&scope).unwrap().list(None, 10).await.unwrap().entries.is_empty());

    // A picture named like a text file is a picture, and a PDF is a PDF whatever it is called.
    let disguised_picture = fixture.attach(&scope, EVERYTHING, fixture.host_file("notes.txt", LOGO_PNG)).await;
    let card = disguised_picture.card.unwrap();
    assert_eq!((card.kind, card.mime_type.as_str()), (FileCardKind::Picture, "image/png"));
    let pdf = fixture.attach(&scope, EVERYTHING, fixture.host_file("data.csv", b"%PDF-1.4\n%%EOF\n")).await;
    assert_eq!(pdf.card.unwrap().kind, FileCardKind::Pdf);
}

#[tokio::test]
async fn an_agent_only_takes_what_its_steps_can_use() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let pictures_only = FileAbilities { reads_files: false, sees_pictures: true, makes_files: false };
    let documents_only = FileAbilities { reads_files: true, sees_pictures: false, makes_files: true };
    let note = fixture.host_file("note.txt", b"hello");
    let photo = fixture.host_file("photo.jpg", PHOTO_WITH_GPS);
    assert_eq!(problem_of(&fixture.attach(&scope, pictures_only, note).await), Some(AttachProblem::FilesNotRead));
    assert_eq!(problem_of(&fixture.attach(&scope, documents_only, photo).await), Some(AttachProblem::PicturesNotSeen));
}

#[tokio::test]
async fn a_message_takes_a_bounded_number_of_files() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let paths: Vec<PathBuf> = (0..3).map(|index| fixture.host_file(&format!("note-{index}.txt"), b"hello")).collect();
    let already_attached = MAX_ATTACHMENTS_PER_MESSAGE - 2;
    let outcomes = fixture
        .files
        .attach_host_files(&scope, EVERYTHING, paths, PathOrigin::PickedInDialog, already_attached)
        .await
        .unwrap();
    let problems: Vec<Option<AttachProblem>> = outcomes.iter().map(problem_of).collect();
    assert_eq!(problems, [None, None, Some(AttachProblem::TooMany)]);
}

#[tokio::test]
async fn names_are_stored_safely_and_never_overwrite() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let first = fixture.attach(&scope, EVERYTHING, fixture.host_file("Laporan Q3.txt", b"one")).await.card.unwrap();
    let second = fixture.attach(&scope, EVERYTHING, fixture.host_file("Laporan Q3.txt", b"two")).await.card.unwrap();
    assert_eq!((first.name.as_str(), second.name.as_str()), ("Laporan Q3.txt", "Laporan Q3-2.txt"));
    assert_eq!(fixture.stored_bytes(&scope, &first).await, b"one");
    let hidden = fixture.attach(&scope, EVERYTHING, fixture.host_file(".env", b"KEY=1")).await.card.unwrap();
    assert_eq!(hidden.name, "env", "a hidden name is stored as a visible one");
}

// --- Pictures: metadata removed, bombs refused ---

#[tokio::test]
async fn a_picture_is_stored_without_its_metadata() {
    assert!(contains(PHOTO_WITH_GPS, EXIF_SECRET) && contains(PHOTO_WITH_GPS, b"Exif"), "the fixture carries EXIF");
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let card = fixture.attach(&scope, EVERYTHING, fixture.host_file("photo.jpg", PHOTO_WITH_GPS)).await.card.unwrap();
    assert_eq!((card.kind, card.preview), (FileCardKind::Picture, PreviewKind::Picture));
    let stored = fixture.stored_bytes(&scope, &card).await;
    assert!(!contains(&stored, EXIF_SECRET) && !contains(&stored, b"Exif"), "EXIF must be gone before storing");
    let info = graphrt_image::probe(&stored).unwrap();
    assert_eq!((info.width, info.height), (64, 40));
}

#[tokio::test]
async fn a_rotated_picture_is_turned_upright_before_its_metadata_goes() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let path = fixture.host_file("rotated.jpg", ROTATED_PHOTO_WITH_GPS);
    let card = fixture.attach(&scope, EVERYTHING, path).await.card.unwrap();
    let stored = fixture.stored_bytes(&scope, &card).await;
    assert!(!contains(&stored, EXIF_SECRET) && !contains(&stored, b"Exif"));
    let info = graphrt_image::probe(&stored).unwrap();
    assert_eq!((info.width, info.height), (40, 64), "the 64x40 picture with orientation 6 is stored as 40x64");
    assert!(!info.needs_rotation());
}

#[tokio::test]
async fn a_picture_that_declares_a_huge_canvas_is_refused_from_its_header() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let bomb = fixture.host_file("bomb.png", &png_header_declaring(60_000, 60_000));
    let started = std::time::Instant::now();
    assert_eq!(problem_of(&fixture.attach(&scope, EVERYTHING, bomb).await), Some(AttachProblem::PictureTooLarge));
    assert!(started.elapsed() < std::time::Duration::from_secs(2), "refused from the header, nothing is decoded");
    let unsupported: [(&str, &[u8]); 3] = [
        ("scan.bmp", b"BM\x46\0\0\0\0\0\0\0\x36\0\0\0\x28\0\0\0\x01\0\0\0\x01\0\0\0\x01\0\x18\0"),
        ("scan.tiff", b"II*\0\x08\0\0\0"),
        ("phone.heic", b"\0\0\0\x18ftypheic\0\0\0\0mif1heic"),
    ];
    for (name, contents) in unsupported {
        let outcome = fixture.attach(&scope, EVERYTHING, fixture.host_file(name, contents)).await;
        assert_eq!(problem_of(&outcome), Some(AttachProblem::UnsupportedPicture), "{name}");
    }
}

// --- Large attachments do not block ---

/// A 12 megapixel JPEG (4000 x 3000) with EXIF orientation 6, like a photo from a phone
/// held upright: attaching it decodes, turns and encodes every pixel.
fn large_rotated_photo() -> Vec<u8> {
    let channel = |value: u32| u8::try_from(value % 256).unwrap_or(0);
    let pixels = image::RgbImage::from_fn(4000, 3000, |x, y| image::Rgb([channel(x), channel(y), channel(x + y)]));
    let mut encoded = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 85).encode_image(&pixels).unwrap();
    // An EXIF segment with one entry, Orientation = 6, right after the start-of-image marker.
    let tiff: &[u8] = b"II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut exif = Vec::from(*b"Exif\0\0");
    exif.extend_from_slice(tiff);
    let mut photo = Vec::from(&encoded[..2]);
    photo.extend_from_slice(&[0xFF, 0xE1]);
    photo.extend_from_slice(&u16::try_from(exif.len() + 2).unwrap().to_be_bytes());
    photo.extend_from_slice(&exif);
    photo.extend_from_slice(&encoded[2..]);
    photo
}

/// The longest pause between two turns of a task that only sleeps 5 ms at a time, while
/// `work` runs on the same single-threaded runtime: how long `work` kept the thread to itself.
async fn longest_stall_during<T>(work: impl std::future::Future<Output = T>) -> (T, std::time::Duration, u32) {
    let stalls = Arc::new(std::sync::Mutex::new((std::time::Duration::ZERO, 0_u32)));
    let recorded = stalls.clone();
    let ticker = tokio::spawn(async move {
        let mut last_turn = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            let mut stalls = recorded.lock().unwrap();
            stalls.0 = stalls.0.max(last_turn.elapsed());
            stalls.1 += 1;
            last_turn = std::time::Instant::now();
        }
    });
    let output = work.await;
    ticker.abort();
    let (longest_stall, turns) = *stalls.lock().unwrap();
    (output, longest_stall, turns)
}

/// The UI talks to the backend on the async runtime: while a large file is read, checked,
/// re-encoded and stored, that runtime must keep serving everything else.
#[tokio::test]
async fn attaching_large_files_does_not_block_the_runtime() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let large_document = fixture.host_file("export.csv", &b"tanggal,pelanggan,jumlah\n".repeat(1_000_000));
    let large_photo = fixture.host_file("IMG_0042.jpg", &large_rotated_photo());
    assert!(std::fs::metadata(&large_document).unwrap().len() > 23 * 1024 * 1024);

    let started = std::time::Instant::now();
    let (document, document_stall, _) = longest_stall_during(fixture.attach(&scope, EVERYTHING, large_document)).await;
    let document_time = started.elapsed();
    let started = std::time::Instant::now();
    let (photo, photo_stall, photo_turns) = longest_stall_during(fixture.attach(&scope, EVERYTHING, large_photo)).await;
    let photo_time = started.elapsed();
    let photo_card = photo.card.expect("the photo is attached");
    let started = std::time::Instant::now();
    let (preview, preview_stall, _) =
        longest_stall_during(fixture.files.preview("agent-1", &photo_card.reference)).await;
    let preview_time = started.elapsed();

    // `cargo test -- --nocapture` prints these (the numbers in the pull request).
    println!("24 MB document: attached in {document_time:?}, runtime stalled at most {document_stall:?}");
    println!("12 MP photo:    attached in {photo_time:?}, runtime stalled at most {photo_stall:?}");
    println!("12 MP preview:  made in {preview_time:?}, runtime stalled at most {preview_stall:?}");

    assert!(document.card.is_some());
    assert!(matches!(preview.unwrap(), FilePreview::Picture { width: 360, height: 480, .. }));
    let stored = fixture.stored_bytes(&scope, &photo_card).await;
    let info = graphrt_image::probe(&stored).unwrap();
    assert_eq!((info.width, info.height), (3000, 4000), "turned upright");
    // Decoding 12 megapixels takes far longer than a turn of the runtime. Had it run on the
    // runtime's thread, the ticker would not have had a turn for the whole time.
    assert!(photo_turns >= 3, "the runtime kept turning while the photo was processed ({photo_turns} turns)");
    assert!(photo_stall * 2 < photo_time, "stalled {photo_stall:?} of {photo_time:?}");
}

// --- Workspaces are kept apart ---

#[tokio::test]
async fn an_agent_folder_is_a_hash_and_agents_cannot_reach_each_other() {
    let fixture = Fixture::new();
    let hostile_agent_id = "../../../outside";
    let scope = FileScope::agent(hostile_agent_id);
    let card = fixture.attach(&scope, EVERYTHING, fixture.host_file("note.txt", b"mine")).await.card.unwrap();
    let folders: Vec<String> = std::fs::read_dir(fixture.workspace_root())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(folders.len(), 1);
    assert!(folders[0].len() == 32 && folders[0].chars().all(|character| character.is_ascii_hexdigit()), "{folders:?}");
    assert!(!fixture.home.path().join("outside").exists());

    // The same reference names nothing in another agent's workspace.
    assert!(fixture.files.locate(hostile_agent_id, &card.reference).await.is_ok());
    assert!(matches!(fixture.files.locate("agent-2", &card.reference).await, Err(AppError::NotFound(_))));
    assert!(matches!(fixture.files.preview("agent-2", &card.reference).await, Err(AppError::NotFound(_))));
    let destination = fixture.home.path().join("copy.txt");
    assert!(fixture.files.save_copy("agent-2", &card.reference, &destination).await.is_err());
    assert!(!destination.exists());
}

#[tokio::test]
async fn a_reference_cannot_leave_the_workspace() {
    let fixture = Fixture::new();
    let secret = fixture.host_file("secret.txt", b"host secret");
    let scope = FileScope::agent("agent-1");
    fixture.attach(&scope, EVERYTHING, fixture.host_file("note.txt", b"mine")).await.card.unwrap();
    let escapes = [
        format!("workspace:{}", secret.display()),
        "workspace:../secret.txt".to_owned(),
        "workspace:uploads/../../../secret.txt".to_owned(),
        "workspace:/etc/passwd".to_owned(),
        "workspace:uploads\\..\\..\\secret.txt".to_owned(),
        "workspace:C:/Windows/win.ini".to_owned(),
        "workspace:.env".to_owned(),
        secret.display().to_string(),
        "file:///etc/passwd".to_owned(),
        String::new(),
    ];
    let destination = fixture.home.path().join("copy.txt");
    for reference in &escapes {
        assert!(matches!(fixture.files.locate("agent-1", reference).await, Err(AppError::NotFound(_))), "{reference}");
        assert!(fixture.files.preview("agent-1", reference).await.is_err(), "{reference}");
        assert!(fixture.files.save_copy("agent-1", reference, &destination).await.is_err(), "{reference}");
        assert!(fixture.files.attached_files(&scope, std::slice::from_ref(reference)).await.is_err(), "{reference}");
        assert!(fixture.files.discard_attachment(&scope, reference).await.is_err(), "{reference}");
    }
    assert!(!destination.exists());
    let view = fixture.files.view(&scope).unwrap();
    assert!(cards_for_references(&view, &escapes).await.is_empty());
}

/// A link inside the workspace that points outside is never followed.
#[cfg(unix)]
#[tokio::test]
async fn a_link_planted_in_the_workspace_is_not_followed() {
    let fixture = Fixture::new();
    let secret = fixture.host_file("secret.txt", b"host secret");
    let scope = FileScope::agent("agent-1");
    let card = fixture.attach(&scope, EVERYTHING, fixture.host_file("note.txt", b"mine")).await.card.unwrap();
    let agent_folder = std::fs::read_dir(fixture.workspace_root()).unwrap().next().unwrap().unwrap().path();
    std::os::unix::fs::symlink(&secret, agent_folder.join("uploads").join("link.txt")).unwrap();
    let link_reference = card.reference.replace("note.txt", "link.txt");
    assert!(fixture.files.locate("agent-1", &link_reference).await.is_err());
    assert!(fixture.files.save_copy("agent-1", &link_reference, &fixture.home.path().join("copy.txt")).await.is_err());
}

#[tokio::test]
async fn conversations_of_one_chatbot_cannot_reach_each_other() {
    let fixture = Fixture::new();
    let chat_a = FileScope::conversation("agent-1", "chat-a");
    let chat_b = FileScope::conversation("agent-1", "chat-b");
    let card = fixture.attach(&chat_a, EVERYTHING, fixture.host_file("ktp.txt", b"NIK 3174")).await.card.unwrap();

    // Sending it as an attachment of the other chat is refused.
    let own = fixture.files.attached_files(&chat_a, std::slice::from_ref(&card.reference)).await.unwrap();
    assert_eq!(own[0].path, "uploads/ktp.txt");
    assert!(fixture.files.attached_files(&chat_b, std::slice::from_ref(&card.reference)).await.is_err());
    assert!(fixture.files.discard_attachment(&chat_b, &card.reference).await.is_err());
    // A reply of the other chat cannot show it.
    let view_b = fixture.files.view(&chat_b).unwrap();
    assert!(cards_for_references(&view_b, std::slice::from_ref(&card.reference)).await.is_empty());

    // The other chat's tools cannot read it, by any path.
    let access = FileAccess { files: fixture.files.clone(), scope: chat_b };
    let mut tools = ToolRegistry::new();
    access.wire(FILES_AGENT_FLOW, &mut tools).unwrap();
    let file_tools = tools.get(FILES_PROVIDER).unwrap();
    let store_path = card.reference.trim_start_matches("workspace:");
    for path in ["uploads/ktp.txt", store_path, &format!("../{store_path}"), "scopes"] {
        let read = file_tools.call("read", json!({ "path": path }), ToolCallContext::empty()).await.unwrap();
        assert!(read.is_error, "chat-b read {path}: {}", read.text);
        assert!(!read.text.contains("3174"));
    }
    let listed = file_tools.call("list", json!({}), ToolCallContext::empty()).await.unwrap();
    assert!(!listed.text.contains("ktp"), "{}", listed.text);

    // Runs of the agent itself do not see conversation files either.
    let agent_access = FileAccess { files: fixture.files.clone(), scope: FileScope::agent("agent-1") };
    let mut agent_tools = ToolRegistry::new();
    agent_access.wire(FILES_AGENT_FLOW, &mut agent_tools).unwrap();
    let read = agent_tools
        .get(FILES_PROVIDER)
        .unwrap()
        .call("read", json!({ "path": store_path }), ToolCallContext::empty())
        .await
        .unwrap();
    assert!(read.is_error && !read.text.contains("3174"), "{}", read.text);
}

#[tokio::test]
async fn only_attachments_can_be_discarded() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let attached = fixture.attach(&scope, EVERYTHING, fixture.host_file("note.txt", b"mine")).await.card.unwrap();
    let view = fixture.files.view(&scope).unwrap();
    let made = view.write(&WorkspacePath::parse("reports/q3.md").unwrap(), b"# Q3".to_vec(), false).await.unwrap();
    let made_reference = view.file_value(&made).reference.unwrap();

    assert!(fixture.files.discard_attachment(&scope, &made_reference).await.is_err(), "not below uploads/");
    assert!(fixture.files.attached_files(&scope, std::slice::from_ref(&made_reference)).await.is_err());
    assert!(fixture.files.locate("agent-1", &made_reference).await.is_ok());

    fixture.files.discard_attachment(&scope, &attached.reference).await.unwrap();
    assert!(fixture.files.locate("agent-1", &attached.reference).await.is_err());
    // Discarding twice is not an error (the person clicked twice).
    fixture.files.discard_attachment(&scope, &attached.reference).await.unwrap();
}

// --- What is shown: pictures as small copies, nothing active ---

#[tokio::test]
async fn html_and_svg_an_agent_wrote_are_download_only() {
    let fixture = Fixture::new();
    let scope = FileScope::agent("agent-1");
    let view = fixture.files.view(&scope).unwrap();
    let active: [(&str, &[u8]); 3] = [
        ("page.html", b"<!DOCTYPE html><html><body><script>fetch('https://evil.test')</script></body></html>"),
        ("chart.svg", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
        // Named like a picture: the content decides.
        ("logo.png", b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"),
    ];
    for (name, contents) in active {
        let stored = view.write(&WorkspacePath::parse(name).unwrap(), contents.to_vec(), false).await.unwrap();
        let card = cards::card_of(&view, &stored);
        assert_eq!((card.kind, card.preview), (FileCardKind::WebPage, PreviewKind::None), "{name}");
        assert_eq!(fixture.files.preview("agent-1", &card.reference).await.unwrap(), FilePreview::None, "{name}");
    }
    // A PDF and a text file are not rendered either.
    let pdf = view.write(&WorkspacePath::parse("report.pdf").unwrap(), b"%PDF-1.4\n%%EOF\n".to_vec(), false).await;
    let pdf_card = cards::card_of(&view, &pdf.unwrap());
    assert_eq!((pdf_card.kind, pdf_card.preview), (FileCardKind::Pdf, PreviewKind::None));
    assert_eq!(fixture.files.preview("agent-1", &pdf_card.reference).await.unwrap(), FilePreview::None);
}

#[tokio::test]
async fn a_picture_preview_is_a_small_copy_encoded_again() {
    let fixture = Fixture::new();
    let scope = FileScope::agent("agent-1");
    let view = fixture.files.view(&scope).unwrap();
    // Written by an agent's tool, so with its metadata still in place.
    let path = WorkspacePath::parse("photo.jpg").unwrap();
    let stored = view.write(&path, PHOTO_WITH_GPS.to_vec(), false).await.unwrap();
    let card = cards::card_of(&view, &stored);
    let FilePreview::Picture { data_url, width, height } =
        fixture.files.preview("agent-1", &card.reference).await.unwrap()
    else {
        panic!("a JPEG has a preview");
    };
    assert_eq!((width, height), (64, 40));
    let encoded = data_url.strip_prefix("data:image/jpeg;base64,").expect("a JPEG data URL");
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded).unwrap();
    assert!(!contains(&bytes, EXIF_SECRET) && !contains(&bytes, b"Exif"), "the preview carries no metadata");
    assert!(graphrt_image::probe(&bytes).is_ok());
}

#[tokio::test]
async fn saving_writes_the_whole_file_and_leaves_nothing_half_done() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let view = fixture.files.view(&scope).unwrap();
    let stored = view.write(&WorkspacePath::parse("reports/q3.md").unwrap(), b"# Q3\n".to_vec(), false).await.unwrap();
    let reference = view.file_value(&stored).reference.unwrap();

    let destination = fixture.home.path().join("Q3 report.md");
    assert_eq!(fixture.files.save_copy("agent-1", &reference, &destination).await.unwrap(), 5);
    assert_eq!(std::fs::read(&destination).unwrap(), b"# Q3\n");
    assert!(!fixture.home.path().join("Q3 report.md.part").exists());

    // A destination that cannot be written reports an error and leaves no partial file.
    let missing_folder = fixture.home.path().join("no-such-folder").join("q3.md");
    assert!(fixture.files.save_copy("agent-1", &reference, &missing_folder).await.is_err());
}

#[tokio::test]
async fn forgetting_an_agent_removes_its_files_only() {
    let fixture = Fixture::new();
    let kept = fixture.attach(&FileScope::agent("agent-1"), EVERYTHING, fixture.host_file("a.txt", b"a")).await;
    let removed = fixture.attach(&FileScope::agent("agent-2"), EVERYTHING, fixture.host_file("b.txt", b"b")).await;
    fixture.files.forget_agent("agent-2").unwrap();
    fixture.files.forget_agent("never-had-files").unwrap();
    assert!(fixture.files.locate("agent-1", &kept.card.unwrap().reference).await.is_ok());
    assert!(fixture.files.locate("agent-2", &removed.card.unwrap().reference).await.is_err());
    assert_eq!(std::fs::read_dir(fixture.workspace_root()).unwrap().count(), 1);
}

// --- The files a run made ---

/// Runs `flow_yaml` with the file tools of `scope` and returns its events as stored JSON.
async fn run_events(fixture: &Fixture, scope: FileScope, flow_yaml: &str, body: &str) -> Vec<serde_json::Value> {
    let access = FileAccess { files: fixture.files.clone(), scope };
    let mut tools = ToolRegistry::new();
    access.wire(flow_yaml, &mut tools).unwrap();
    let graph = crate::flow::compile_flow(flow_yaml).unwrap();
    let engine = Engine::new(Arc::new(graph)).with_services(Services::new().with(tools));
    let mut stream = engine.run(RunInput::new().input("body", body));
    let mut events = Vec::new();
    while let Some(event) = stream.next().await {
        events.push(serde_json::to_value(&event).unwrap());
    }
    events
}

#[tokio::test]
async fn a_run_shows_the_files_its_steps_made() {
    let fixture = Fixture::new();
    let events = run_events(&fixture, FileScope::agent("agent-1"), WRITE_NOTE_FLOW, "pear,7").await;
    assert_eq!(references_in_run_events(&events), ["workspace:notes/stock.md"]);
    let cards = fixture.files.run_file_cards("agent-1", &events).await.unwrap();
    assert_eq!(cards.len(), 1, "{events:?}");
    assert_eq!(
        (cards[0].name.as_str(), cards[0].kind, cards[0].preview),
        ("stock.md", FileCardKind::Text, PreviewKind::None)
    );
    assert_eq!(cards[0].size_bytes, 16);

    // Without the file in the run's outputs, the step's own `files` output is used.
    let without_outputs: Vec<serde_json::Value> =
        events.iter().filter(|event| event["type"] != "run_succeeded").cloned().collect();
    assert_eq!(references_in_run_events(&without_outputs), ["workspace:notes/stock.md"]);
    // Another agent's run cannot show it.
    assert!(fixture.files.run_file_cards("agent-2", &events).await.unwrap().is_empty());
}

#[tokio::test]
async fn file_values_a_run_forged_become_no_card() {
    let fixture = Fixture::new();
    let secret = fixture.host_file("secret.txt", b"host secret");
    fixture.attach(&FileScope::agent("agent-1"), EVERYTHING, fixture.host_file("note.txt", b"mine")).await;
    let forged =
        |reference: &str| json!({ "$file": true, "name": "x", "transfer": "tool_file", "reference": reference });
    let events = [json!({
        "type": "run_succeeded",
        "outputs": {
            "a": forged(&secret.display().to_string()),
            "b": forged(&format!("workspace:{}", secret.display())),
            "c": [forged("workspace:../../secret.txt"), forged("workspace:uploads/missing.txt")],
            "d": { "$file": "yes", "reference": "workspace:uploads/note.txt" },
            "e": { "reference": "workspace:uploads/note.txt" },
        }
    })];
    assert!(fixture.files.run_file_cards("agent-1", &events).await.unwrap().is_empty());
    // Many file values: at most MAX_FILE_CARDS cards, each file once.
    let view = fixture.files.view(&FileScope::agent("agent-1")).unwrap();
    let mut values = Vec::new();
    for index in 0..MAX_FILE_CARDS + 5 {
        let path = WorkspacePath::parse(&format!("out/{index}.txt")).unwrap();
        view.write(&path, b"x".to_vec(), false).await.unwrap();
        values.push(forged(&format!("workspace:out/{index}.txt")));
        values.push(forged(&format!("workspace:out/{index}.txt")));
    }
    let many = [json!({ "type": "run_succeeded", "outputs": { "files": values } })];
    assert_eq!(fixture.files.run_file_cards("agent-1", &many).await.unwrap().len(), MAX_FILE_CARDS);
}

#[test]
fn the_webview_sees_cards_in_camel_case() {
    let card = FileCard {
        reference: "workspace:reports/q3.pdf".into(),
        name: "q3.pdf".into(),
        size_bytes: 1200,
        mime_type: "application/pdf".into(),
        kind: FileCardKind::Pdf,
        preview: PreviewKind::None,
    };
    assert_eq!(
        serde_json::to_value(&card).unwrap(),
        json!({
            "reference": "workspace:reports/q3.pdf", "name": "q3.pdf", "sizeBytes": 1200,
            "mimeType": "application/pdf", "kind": "pdf", "preview": "none"
        })
    );
    assert_eq!(serde_json::to_value(FilePreview::None).unwrap(), json!({ "kind": "none" }));
    let outcome = AttachOutcome { name: "a.exe".into(), card: None, problem: Some(AttachProblem::UnsupportedKind) };
    assert_eq!(
        serde_json::to_value(&outcome).unwrap(),
        json!({ "name": "a.exe", "card": null, "problem": "unsupported_kind" })
    );
}

// --- Cleanup: only what no message shows ---

use super::cleanup::{CleanupReport, ConversationFileUse, UNSENT_GRACE};

fn now_ms() -> u64 {
    u64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()).unwrap()
}

/// A moment after the wait for unsent attachments is over.
fn after_the_grace() -> u64 {
    now_ms() + u64::try_from(UNSENT_GRACE.as_millis()).unwrap() + 60_000
}

async fn write_file(fixture: &Fixture, scope: &FileScope, path: &str) -> String {
    let view = fixture.files.view(scope).unwrap();
    let stored = view.write(&WorkspacePath::parse(path).unwrap(), b"x".to_vec(), false).await.unwrap();
    view.file_value(&stored).reference.unwrap()
}

async fn paths_in(fixture: &Fixture, scope: &FileScope) -> Vec<String> {
    let view = fixture.files.view(scope).unwrap();
    view.list(None, 100).await.unwrap().entries.into_iter().map(|entry| entry.path.to_string()).collect()
}

fn file_use(conversation_id: &str, is_closed: bool, referenced: &[&String]) -> ConversationFileUse {
    ConversationFileUse {
        conversation_id: conversation_id.to_owned(),
        is_closed,
        referenced: referenced.iter().map(|reference| (*reference).clone()).collect(),
    }
}

#[tokio::test]
async fn folder_names_follow_the_runtime() {
    let fixture = Fixture::new();
    write_file(&fixture, &FileScope::conversation("agent-1", "chat-1"), "note.txt").await;
    let expected = fixture
        .workspace_root()
        .join(cleanup::folder_name("agent-1"))
        .join("scopes")
        .join(cleanup::folder_name("chat-1"))
        .join("note.txt");
    assert!(expected.is_file(), "graphrt keeps a conversation's files where the cleanup looks for them");
}

#[tokio::test]
async fn an_attachment_that_was_never_sent_goes_after_a_day_and_a_sent_one_stays() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let sent = write_file(&fixture, &scope, "uploads/sent.pdf").await;
    write_file(&fixture, &scope, "uploads/never-sent.pdf").await;
    let open_chat = file_use("chat-1", false, &[&sent]);

    // Attached a moment ago: it may still be sent.
    let report = fixture.files.clean_conversation("agent-1", &open_chat, now_ms()).await.unwrap();
    assert_eq!(report, CleanupReport::default());
    assert_eq!(paths_in(&fixture, &scope).await, ["uploads/never-sent.pdf", "uploads/sent.pdf"]);

    // A day later only the one no message shows is gone.
    let report = fixture.files.clean_conversation("agent-1", &open_chat, after_the_grace()).await.unwrap();
    assert_eq!(report.files, 1);
    assert_eq!(paths_in(&fixture, &scope).await, ["uploads/sent.pdf"]);
    assert!(fixture.files.locate("agent-1", &sent).await.is_ok());
}

#[tokio::test]
async fn a_closed_conversation_keeps_exactly_what_its_messages_show() {
    let fixture = Fixture::new();
    let scope = FileScope::conversation("agent-1", "chat-1");
    let attachment = write_file(&fixture, &scope, "uploads/order.csv").await;
    let handed_back = write_file(&fixture, &scope, "reports/summary.pdf").await;
    write_file(&fixture, &scope, "notes/scratch.md").await;
    write_file(&fixture, &scope, "uploads/just-attached.pdf").await;

    // While the chat is open the bot keeps its own notes.
    let open_chat = file_use("chat-1", false, &[&attachment, &handed_back]);
    assert_eq!(fixture.files.clean_conversation("agent-1", &open_chat, now_ms()).await.unwrap().files, 0);
    assert_eq!(paths_in(&fixture, &scope).await.len(), 4);

    // Closed: the notes go at once, an attachment that may still be sent waits its day.
    let closed_chat = file_use("chat-1", true, &[&attachment, &handed_back]);
    assert_eq!(fixture.files.clean_conversation("agent-1", &closed_chat, now_ms()).await.unwrap().files, 1);
    assert_eq!(
        paths_in(&fixture, &scope).await,
        ["reports/summary.pdf", "uploads/just-attached.pdf", "uploads/order.csv"]
    );
    assert_eq!(fixture.files.clean_conversation("agent-1", &closed_chat, after_the_grace()).await.unwrap().files, 1);
    assert_eq!(paths_in(&fixture, &scope).await, ["reports/summary.pdf", "uploads/order.csv"]);

    // However often it runs, and however late, what a message shows stays downloadable.
    let much_later = after_the_grace() * 2;
    assert_eq!(fixture.files.clean_conversation("agent-1", &closed_chat, much_later).await.unwrap().files, 0);
    let destination = fixture.home.path().join("summary.pdf");
    fixture.files.save_copy("agent-1", &handed_back, &destination).await.unwrap();
    assert!(fixture.files.locate("agent-1", &attachment).await.is_ok());
}

#[tokio::test]
async fn a_reference_cannot_make_the_cleanup_spare_or_remove_another_chats_file() {
    let fixture = Fixture::new();
    let chat_a = FileScope::conversation("agent-1", "chat-a");
    let chat_b = FileScope::conversation("agent-1", "chat-b");
    let in_a = write_file(&fixture, &chat_a, "uploads/a.pdf").await;
    write_file(&fixture, &chat_b, "uploads/b.pdf").await;
    // Chat B's messages name chat A's file and a path outside: neither protects B's own file,
    // and cleaning B touches nothing of A.
    let escape = "workspace:../../uploads/a.pdf".to_owned();
    let closed_b = file_use("chat-b", true, &[&in_a, &escape]);
    assert_eq!(fixture.files.clean_conversation("agent-1", &closed_b, after_the_grace()).await.unwrap().files, 1);
    assert!(paths_in(&fixture, &chat_b).await.is_empty());
    assert_eq!(paths_in(&fixture, &chat_a).await, ["uploads/a.pdf"]);
}

#[tokio::test]
async fn folders_of_conversations_and_agents_that_are_gone_are_removed_and_nothing_else() {
    let fixture = Fixture::new();
    let kept = write_file(&fixture, &FileScope::conversation("agent-1", "chat-kept"), "uploads/kept.pdf").await;
    write_file(&fixture, &FileScope::conversation("agent-1", "chat-gone"), "uploads/gone.pdf").await;
    let run_file = write_file(&fixture, &FileScope::agent("agent-1"), "reports/run.pdf").await;
    write_file(&fixture, &FileScope::agent("agent-gone"), "reports/old.pdf").await;

    // Things in the same folders that are not ours: a folder with another name, a file, and a
    // link named like one of our folders that points outside.
    let outside = fixture.home.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("precious.txt"), b"keep me").unwrap();
    let scopes_dir = fixture.workspace_root().join(cleanup::folder_name("agent-1")).join("scopes");
    std::fs::create_dir(scopes_dir.join("not-ours")).unwrap();
    std::fs::create_dir(fixture.workspace_root().join("not-ours")).unwrap();
    std::fs::write(fixture.workspace_root().join("0123456789abcdef0123456789abcdef"), b"a file").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, scopes_dir.join("fedcba9876543210fedcba9876543210")).unwrap();

    let conversations = [file_use("chat-kept", false, &[&kept])];
    let report = fixture.files.clean_agent("agent-1", &conversations, now_ms()).await.unwrap();
    assert_eq!(report, CleanupReport { files: 0, conversation_folders: 1, agent_folders: 0 });
    let report = fixture.files.remove_folders_of_missing_agents(&["agent-1".to_owned()]).await;
    assert_eq!(report, CleanupReport { files: 0, conversation_folders: 0, agent_folders: 1 });

    assert!(fixture.files.locate("agent-1", &kept).await.is_ok());
    assert!(fixture.files.locate("agent-1", &run_file).await.is_ok(), "files of the agent's runs are not touched");
    assert!(!scopes_dir.join(cleanup::folder_name("chat-gone")).exists());
    assert!(!fixture.workspace_root().join(cleanup::folder_name("agent-gone")).exists());
    assert!(scopes_dir.join("not-ours").is_dir() && fixture.workspace_root().join("not-ours").is_dir());
    assert!(fixture.workspace_root().join("0123456789abcdef0123456789abcdef").is_file());
    assert_eq!(std::fs::read(outside.join("precious.txt")).unwrap(), b"keep me", "a link is never followed");
}

#[tokio::test]
async fn cleaning_an_agent_without_files_creates_nothing() {
    let fixture = Fixture::new();
    let conversations = [file_use("chat-1", true, &[])];
    let report = fixture.files.clean_agent("agent-1", &conversations, after_the_grace()).await.unwrap();
    assert!(report.is_empty());
    assert!(fixture.files.remove_folders_of_missing_agents(&[]).await.is_empty());
    assert!(!fixture.workspace_root().exists());
}
