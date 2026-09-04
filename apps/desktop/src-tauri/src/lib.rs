use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_MENU_ID: &str = "show";
const QUIT_MENU_ID: &str = "quit";
const READY_PREFIX: &str = "dsh web: ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const CLOSE_REQUESTED_EVENT: &str = "desktop://close-requested";

#[derive(Debug, PartialEq, Eq)]
enum CloseAction {
    Minimize,
    Exit,
    Cancel,
}

impl CloseAction {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "minimize" => Ok(Self::Minimize),
            "exit" => Ok(Self::Exit),
            "cancel" => Ok(Self::Cancel),
            _ => Err(format!("unsupported desktop close action: {value}")),
        }
    }
}

const SESSION_ZIP_PREFIX: &str = "dsh-session-";
const SESSION_ZIP_SUFFIX: &str = ".zip";
const SESSION_ARCHIVE_COLLISION_LIMIT: u32 = 1000;

/// Validate a download directory plus convention-checked archive name against
/// the renderer-supplied pair, so the native commands can never address an
/// arbitrary filesystem path.
fn resolve_session_zip(dir: &str, filename: &str) -> Result<PathBuf, String> {
    let Some(stem) = filename
        .strip_prefix(SESSION_ZIP_PREFIX)
        .and_then(|rest| rest.strip_suffix(SESSION_ZIP_SUFFIX))
    else {
        return Err(format!(
            "session log archive name must match {SESSION_ZIP_PREFIX}<id>{SESSION_ZIP_SUFFIX}: {filename}"
        ));
    };
    if stem.is_empty()
        || !stem
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(format!(
            "session log archive id supports ASCII letters, digits, '_' and '-': {filename}"
        ));
    }
    let dir_path = Path::new(dir);
    if !dir_path.is_absolute() {
        return Err(format!("session log directory must be absolute: {dir}"));
    }
    if !dir_path.is_dir() {
        return Err(format!("session log directory does not exist: {dir}"));
    }
    Ok(dir_path.join(filename))
}

/// Write one archive without overwriting, uniquifying the name on collision
/// (`name (1).zip`, `name (2).zip`, …).
fn save_session_archive(target: PathBuf, bytes: &[u8]) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("session log archive has no parent directory: {}", target.display()))?
        .to_path_buf();
    let stem = target
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .ok_or_else(|| format!("session log archive has no file name: {}", target.display()))?;
    let extension = target.extension().map(|ext| ext.to_string_lossy().into_owned());

    for attempt in 0..=SESSION_ARCHIVE_COLLISION_LIMIT {
        let candidate = if attempt == 0 {
            target.clone()
        } else {
            match &extension {
                Some(extension) => parent.join(format!("{stem} ({attempt}).{extension}")),
                None => parent.join(format!("{stem} ({attempt})")),
            }
        };
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|error| format!("failed to write {}: {error}", candidate.display()))?;
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "failed to create {}: {error}",
                    candidate.display()
                ))
            }
        }
    }
    Err(format!(
        "no free session log archive name within {SESSION_ARCHIVE_COLLISION_LIMIT} attempts at {}",
        target.display()
    ))
}

#[cfg(windows)]
fn reveal_session_archive(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    Command::new("explorer")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to reveal {} in File Explorer: {error}", path.display()))
}

#[cfg(windows)]
fn open_session_archive(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open {}: {error}", path.display()))
}

#[cfg(not(windows))]
fn reveal_session_archive(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(target_os = "macos"))]
    let program = "xdg-open";

    let mut command = Command::new(program);
    if cfg!(target_os = "macos") {
        command.arg("-R");
    } else if let Some(parent) = path.parent() {
        command.arg(parent);
    }
    command.arg(path);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to reveal {}: {error}", path.display()))
}

#[cfg(not(windows))]
fn open_session_archive(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(target_os = "macos"))]
    let program = "xdg-open";

    Command::new(program)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open {}: {error}", path.display()))
}

#[tauri::command]
fn desktop_pick_folder(window: tauri::Window) -> Option<String> {
    // Native dialogs must open on the main thread; the command pool thread has
    // no COM apartment for them.
    let (sender, receiver) = mpsc::channel();
    if let Err(error) = window.app_handle().run_on_main_thread(move || {
        let picked = rfd::FileDialog::new()
            .set_title("Select Session log download location")
            .pick_folder()
            .map(|folder| folder.to_string_lossy().into_owned());
        let _ = sender.send(picked);
    }) {
        eprintln!("desktop_pick_folder could not reach the main thread: {error}");
        return None;
    }
    match receiver.recv() {
        Ok(picked) => picked,
        Err(error) => {
            eprintln!("desktop_pick_folder lost its dialog result: {error}");
            None
        }
    }
}

#[tauri::command]
fn desktop_save_session_log(dir: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let target = resolve_session_zip(&dir, &filename)?;
    let saved = save_session_archive(target, &bytes)?;
    Ok(saved.to_string_lossy().into_owned())
}

#[tauri::command]
fn desktop_reveal_session_log(dir: String, filename: String) -> Result<(), String> {
    let path = resolve_session_zip(&dir, &filename)?;
    if !path.is_file() {
        return Err(format!("session log archive does not exist: {}", path.display()));
    }
    reveal_session_archive(&path)
}

#[tauri::command]
fn desktop_open_session_log(dir: String, filename: String) -> Result<(), String> {
    let path = resolve_session_zip(&dir, &filename)?;
    if !path.is_file() {
        return Err(format!("session log archive does not exist: {}", path.display()));
    }
    open_session_archive(&path)
}

fn begin_once(flag: &AtomicBool) -> bool {
    flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

#[derive(Debug, Default)]
struct CloseHandshake {
    ui_ready: bool,
    next_request_id: u64,
    pending_request_id: Option<u64>,
}

impl CloseHandshake {
    fn mark_ready(&mut self) -> Option<u64> {
        self.ui_ready = true;
        self.pending_request_id
    }

    fn begin_request(&mut self) -> Option<(u64, bool)> {
        if self.pending_request_id.is_some() {
            return None;
        }
        self.next_request_id = self
            .next_request_id
            .checked_add(1)
            .expect("desktop close request id exhausted");
        self.pending_request_id = Some(self.next_request_id);
        Some((self.next_request_id, self.ui_ready))
    }

    fn resolve(&mut self, request_id: u64) -> Result<(), String> {
        if self.pending_request_id != Some(request_id) {
            return Err(format!("desktop close request {request_id} is not pending"));
        }
        self.pending_request_id = None;
        Ok(())
    }
}

fn emit_close_requested(window: &Window, request_id: u64) -> tauri::Result<()> {
    let payload = std::collections::HashMap::from([("requestId", request_id)]);
    window.emit_to(MAIN_WINDOW_LABEL, CLOSE_REQUESTED_EVENT, payload)
}

struct RuntimeProcess {
    child: Mutex<Option<Child>>,
    close_handshake: Mutex<CloseHandshake>,
    exit_started: AtomicBool,
}

impl RuntimeProcess {
    fn new(child: Child) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            close_handshake: Mutex::new(CloseHandshake::default()),
            exit_started: AtomicBool::new(false),
        }
    }

    fn shutdown(&self) {
        let Some(mut child) = self
            .child
            .lock()
            .expect("runtime process lock poisoned")
            .take()
        else {
            return;
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"shutdown\n");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => break,
            }
        }
        terminate_process_tree(&mut child);
        let _ = child.wait();
    }
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child) {
    let status = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if !status.is_ok_and(|status| status.success()) {
        let _ = child.kill();
    }
}

#[cfg(not(windows))]
fn terminate_process_tree(child: &mut Child) {
    let _ = child.kill();
}

fn readiness_url(line: &str) -> Option<String> {
    let value = line.strip_prefix(READY_PREFIX)?.split_whitespace().next()?;
    let port = value
        .strip_prefix("http://127.0.0.1:")?
        .parse::<u16>()
        .ok()?;
    (port != 0).then(|| format!("http://127.0.0.1:{port}"))
}

fn same_origin(allowed: &tauri::Url, candidate: &tauri::Url) -> bool {
    candidate.origin() == allowed.origin()
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()
        .expect("desktop source tree must have a repository root")
}

fn production_runtime(app: &AppHandle) -> Result<(PathBuf, Vec<String>, PathBuf), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let runtime = resource_dir.join("runtime");
    let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
    let entry = runtime
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    Ok((node, vec![entry.to_string_lossy().into_owned()], runtime))
}

fn runtime_command(app: &AppHandle) -> Result<(PathBuf, Vec<String>, PathBuf), String> {
    if cfg!(debug_assertions) {
        let root = repository_root();
        let command = if cfg!(windows) { "pnpm.cmd" } else { "pnpm" };
        Ok((PathBuf::from(command), vec!["dsh".into()], root))
    } else {
        production_runtime(app)
    }
}

fn runtime_web_args() -> Vec<String> {
    vec![
        "web".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        "0".into(),
        "--no-open".into(),
    ]
}

fn start_runtime(app: &AppHandle) -> Result<(Child, String), String> {
    let (command, mut args, cwd) = runtime_command(app)?;
    args.extend(runtime_web_args());
    let mut child = Command::new(&command)
        .args(args)
        .current_dir(cwd)
        .env("DSH_PARENT_LIFETIME", "stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            format!(
                "failed to start Harness runtime with {}: {error}",
                command.display()
            )
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Harness runtime stdout was not piped")?;
    let (lines_tx, lines_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    print!("{line}");
                    let _ = lines_tx.send(line.trim_end().to_owned());
                }
            }
        }
    });
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let ready = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match lines_rx.recv_timeout(remaining) {
            Ok(line) => {
                if let Some(url) = readiness_url(&line) {
                    break url;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let status = child.wait().map_err(|error| error.to_string())?;
                return Err(format!(
                    "Harness runtime exited before readiness ({status})"
                ));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                terminate_process_tree(&mut child);
                let _ = child.wait();
                return Err(format!(
                    "Harness runtime did not become ready within {} seconds",
                    STARTUP_TIMEOUT.as_secs()
                ));
            }
        }
    };
    Ok((child, ready))
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn begin_exit(app: AppHandle, runtime: Arc<RuntimeProcess>) {
    if !begin_once(&runtime.exit_started) {
        return;
    }
    thread::spawn(move || {
        runtime.shutdown();
        app.exit(0);
    });
}

#[tauri::command]
fn desktop_ready(window: Window, runtime: State<'_, Arc<RuntimeProcess>>) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("desktop_ready is restricted to the main window".into());
    }
    let pending_request_id = runtime
        .close_handshake
        .lock()
        .expect("close handshake lock poisoned")
        .mark_ready();
    if let Some(request_id) = pending_request_id {
        if let Err(error) = emit_close_requested(&window, request_id) {
            runtime
                .close_handshake
                .lock()
                .expect("close handshake lock poisoned")
                .resolve(request_id)?;
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[tauri::command]
fn desktop_resolve_close(
    window: Window,
    runtime: State<'_, Arc<RuntimeProcess>>,
    request_id: u64,
    action: String,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("desktop_resolve_close is restricted to the main window".into());
    }
    let action = CloseAction::parse(&action)?;
    runtime
        .close_handshake
        .lock()
        .expect("close handshake lock poisoned")
        .resolve(request_id)?;
    match action {
        CloseAction::Minimize => window.hide().map_err(|error| error.to_string()),
        CloseAction::Exit => {
            begin_exit(window.app_handle().clone(), runtime.inner().clone());
            Ok(())
        }
        CloseAction::Cancel => Ok(()),
    }
}

fn create_tray(app: &AppHandle, runtime: Arc<RuntimeProcess>) -> tauri::Result<()> {
    let show = MenuItem::with_id(
        app,
        SHOW_MENU_ID,
        "Show DeepSeek Harness",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("DeepSeek Harness")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            SHOW_MENU_ID => show_main(app),
            QUIT_MENU_ID => begin_exit(app.clone(), runtime.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn create_main_window(app: &AppHandle, url: String) -> tauri::Result<WebviewWindow> {
    let url: tauri::Url = url.parse().expect("validated loopback readiness URL");
    let allowed_url = url.clone();
    WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("DeepSeek Harness")
        .inner_size(1280.0, 800.0)
        .min_inner_size(720.0, 560.0)
        .center()
        .on_navigation(move |candidate| same_origin(&allowed_url, candidate))
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_ready,
            desktop_resolve_close,
            desktop_pick_folder,
            desktop_save_session_log,
            desktop_reveal_session_log,
            desktop_open_session_log
        ])
        .setup(|app| {
            let (child, url) = start_runtime(app.handle())
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            let runtime = Arc::new(RuntimeProcess::new(child));
            app.manage(runtime.clone());
            create_tray(app.handle(), runtime)?;
            create_main_window(app.handle(), url)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let runtime = window.state::<Arc<RuntimeProcess>>().inner().clone();
                if runtime.exit_started.load(Ordering::Acquire) {
                    return;
                }
                let request = runtime
                    .close_handshake
                    .lock()
                    .expect("close handshake lock poisoned")
                    .begin_request();
                if let Some((request_id, true)) = request {
                    if emit_close_requested(window, request_id).is_err() {
                        let _ = runtime
                            .close_handshake
                            .lock()
                            .expect("close handshake lock poisoned")
                            .resolve(request_id);
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build DeepSeek Harness desktop shell");

    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(runtime) = app.try_state::<Arc<RuntimeProcess>>() {
                runtime.shutdown();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::{
        begin_once, readiness_url, resolve_session_zip, runtime_web_args, same_origin,
        save_session_archive, CloseAction, CloseHandshake,
    };

    #[test]
    fn desktop_runtime_does_not_open_the_system_browser() {
        assert_eq!(
            runtime_web_args(),
            [
                "web",
                "--host",
                "127.0.0.1",
                "--port",
                "0",
                "--no-open"
            ]
        );
    }

    #[test]
    fn accepts_only_nonzero_loopback_readiness_urls() {
        assert_eq!(
            readiness_url("dsh web: http://127.0.0.1:43127"),
            Some("http://127.0.0.1:43127".into())
        );
        assert_eq!(
            readiness_url("dsh web: http://127.0.0.1:43127 (LAN: http://10.0.0.2:43127)"),
            Some("http://127.0.0.1:43127".into())
        );
        assert_eq!(readiness_url("dsh web: http://127.0.0.1:0"), None);
        assert_eq!(readiness_url("dsh web: http://localhost:43127"), None);
        assert_eq!(readiness_url("dsh web: https://127.0.0.1:43127"), None);
        assert_eq!(readiness_url("log: http://127.0.0.1:43127"), None);
    }

    #[test]
    fn allows_navigation_only_within_the_runtime_origin() {
        let allowed = "http://127.0.0.1:43127".parse().unwrap();

        assert!(same_origin(
            &allowed,
            &"http://127.0.0.1:43127/settings".parse().unwrap()
        ));
        assert!(!same_origin(
            &allowed,
            &"http://127.0.0.1:43128".parse().unwrap()
        ));
        assert!(!same_origin(
            &allowed,
            &"https://127.0.0.1:43127".parse().unwrap()
        ));
        assert!(!same_origin(
            &allowed,
            &"http://localhost:43127".parse().unwrap()
        ));
    }

    #[test]
    fn parses_only_supported_close_actions() {
        assert_eq!(CloseAction::parse("minimize"), Ok(CloseAction::Minimize));
        assert_eq!(CloseAction::parse("exit"), Ok(CloseAction::Exit));
        assert_eq!(CloseAction::parse("cancel"), Ok(CloseAction::Cancel));
        assert!(CloseAction::parse("close").is_err());
    }

    #[test]
    fn issues_one_request_at_a_time_after_ui_readiness() {
        let mut handshake = CloseHandshake::default();

        assert_eq!(handshake.begin_request(), Some((1, false)));
        assert_eq!(handshake.mark_ready(), Some(1));
        assert_eq!(handshake.begin_request(), None);
        assert_eq!(handshake.resolve(1), Ok(()));
        assert_eq!(handshake.begin_request(), Some((2, true)));
    }

    #[test]
    fn rejects_stale_duplicate_and_future_request_ids() {
        let mut handshake = CloseHandshake::default();
        handshake.mark_ready();
        assert_eq!(handshake.begin_request(), Some((1, true)));

        assert!(handshake.resolve(2).is_err());
        assert_eq!(handshake.resolve(1), Ok(()));
        assert!(handshake.resolve(1).is_err());
        assert!(handshake.resolve(2).is_err());
    }

    #[test]
    fn admits_only_one_close_or_exit_operation_until_reset() {
        let flag = AtomicBool::new(false);

        assert!(begin_once(&flag));
        assert!(!begin_once(&flag));
        flag.store(false, std::sync::atomic::Ordering::Release);
        assert!(begin_once(&flag));
    }

    #[test]
    fn resolves_only_convention_session_archive_names() {
        let dir = std::env::temp_dir();
        let dir_text = dir.to_string_lossy().into_owned();

        let resolved = resolve_session_zip(&dir_text, "dsh-session-abc_123.zip").expect("valid name");
        assert_eq!(resolved, dir.join("dsh-session-abc_123.zip"));

        for filename in [
            "session-dsh-a.zip",
            "dsh-session-.zip",
            "dsh-session-a/b.zip",
            "dsh-session-a\\b.zip",
            "dsh-session-a b.zip",
            "dsh-session-a.txt",
            "dsh-session-a",
        ] {
            assert!(
                resolve_session_zip(&dir_text, filename).is_err(),
                "expected rejection of {filename}"
            );
        }
    }

    #[test]
    fn rejects_relative_or_missing_directories() {
        assert!(resolve_session_zip("relative/path", "dsh-session-a.zip").is_err());

        let missing = std::env::temp_dir().join(format!("dsh-missing-{}", std::process::id()));
        assert!(resolve_session_zip(&missing.to_string_lossy(), "dsh-session-a.zip").is_err());
    }

    #[test]
    fn saves_session_archives_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("dsh-archive-{}-{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&dir).expect("scratch directory");

        let target = dir.join("dsh-session-demo.zip");
        let first = save_session_archive(target.clone(), b"one").expect("first write");
        assert_eq!(first, target);
        assert_eq!(std::fs::read(&first).expect("read back"), b"one");

        let second = save_session_archive(target.clone(), b"two").expect("uniquified write");
        assert_eq!(second.file_name().unwrap(), "dsh-session-demo (1).zip");
        assert_eq!(std::fs::read(&second).expect("read back"), b"two");
        assert_eq!(std::fs::read(&first).expect("first untouched"), b"one");

        for path in [first, second] {
            let _ = std::fs::remove_file(path);
        }
        let _ = std::fs::remove_dir(dir);
    }
}
