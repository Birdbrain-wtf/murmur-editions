// Answer with your own Claude: Claude Code on this computer, signed in to the member's own
// Claude subscription, running the prompt the collective's door composed.
//
// The door does what only it can do (the agent's instructions, the app guide and the passages
// from the collective's documents, src/plugins/agent → `<pair>/context`). This runs that prompt
// with the member's own `claude` and streams it back to the window. Nothing goes back to the door.
//
// What Claude Code may do here is as little as possible: no tools (so it cannot read or change a
// file), no MCP servers, no settings files, no saved session, and an empty folder of its own as
// its working directory. It is a model answering one prompt, nothing more.
//
// It runs the member's own `claude` program, never a bundled one, so whose subscription pays is
// never in doubt: theirs, for their own use, through Anthropic's own tool. An ANTHROPIC_API_KEY
// in the environment is removed for the same reason.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct ClaudeState(pub Mutex<HashMap<String, Child>>);

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// A Mac app opened from the Dock gets a bare PATH, not the one a terminal has, so the
/// places Claude Code's installers use go in front of whatever the app was given.
fn search_path() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(h) = home() {
        for d in [".local/bin", ".claude/local", ".npm-global/bin", ".bun/bin", ".volta/bin", "bin"] {
            dirs.push(h.join(d));
        }
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(d));
    }
    if let Some(p) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    std::env::join_paths(dirs)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn find() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    std::env::split_paths(&search_path())
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

fn command(path: &PathBuf) -> Command {
    let mut c = Command::new(path);
    c.env("PATH", search_path()).env_remove("ANTHROPIC_API_KEY");
    c
}

#[derive(Serialize)]
pub struct Status {
    found: bool,
    version: Option<String>,
}

/// Whether this computer has Claude Code, and which version. Asked when the agent opens.
#[tauri::command]
pub async fn claude_status() -> Status {
    let Some(path) = find() else {
        return Status { found: false, version: None };
    };
    let version = command(&path)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    Status { found: version.is_some(), version }
}

#[derive(Clone, Serialize)]
struct Line {
    id: String,
    /// One line of Claude Code's stream-json output, passed through as it came.
    line: Option<String>,
    /// Set once, when the program has finished.
    end: Option<End>,
}

#[derive(Clone, Serialize)]
struct End {
    ok: bool,
    /// The tail of what it wrote to stderr, for the one-line error the window shows.
    error: String,
}

/// Run one prompt. Every line of output comes back as a `claude` event carrying `id`.
#[tauri::command]
pub fn claude_ask(
    app: tauri::AppHandle,
    state: tauri::State<'_, ClaudeState>,
    id: String,
    system: String,
    prompt: String,
) -> Result<(), String> {
    let path = find().ok_or("Claude Code is not installed on this computer.")?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("claude");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut child = command(&path)
        .current_dir(&dir)
        .args([
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--tools",
            "",
            "--strict-mcp-config",
            "--setting-sources",
            "",
            "--no-session-persistence",
            "--system-prompt",
            &system,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Claude Code would not start: {e}"))?;

    // The question goes in on stdin, so its length and its characters never meet a shell.
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    }
    let stdout = child.stdout.take().ok_or("no output from Claude Code")?;
    let mut stderr = child.stderr.take().ok_or("no output from Claude Code")?;
    state.0.lock().unwrap().insert(id.clone(), child);

    let err_tail = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        let s = s.trim().to_string();
        let start = s.char_indices().rev().nth(399).map(|(i, _)| i).unwrap_or(0);
        s[start..].to_string()
    });

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app.emit("claude", Line { id: id.clone(), line: Some(line), end: None });
        }
        let child = app.state::<ClaudeState>().0.lock().unwrap().remove(&id);
        let ok = child
            .and_then(|mut c| c.wait().ok())
            .map(|s| s.success())
            .unwrap_or(false);
        let error = err_tail.join().unwrap_or_default();
        let _ = app.emit("claude", Line { id, line: None, end: Some(End { ok, error }) });
    });
    Ok(())
}

/// Stop an answer part-way, when the member presses Stop or leaves.
#[tauri::command]
pub fn claude_stop(state: tauri::State<'_, ClaudeState>, id: String) {
    if let Some(c) = state.0.lock().unwrap().get_mut(&id) {
        let _ = c.kill();
    }
}
