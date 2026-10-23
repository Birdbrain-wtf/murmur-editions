// Keep a copy: the optional full node (ADR 0068, step 2).
//
// Off by default. Switched on in Settings, the app fetches the node program for this
// computer from birdbrain.wtf (Birdbrain's own server, not Zo), checks it against
// Birdbrain's release key, and runs it as a child process. It keeps every block and the
// recent state, holds a copy of the record, and is never trusted to make blocks.
//
// It runs only while the computer is on mains power, and stops when the app quits. The
// light client (chain.rs) stays the app's view of the chain whether this is on or not.
//
// Files, all under the app's data folder:
//   node/settings.json   whether it is switched on
//   node/seeds-node-<v>  the checked program
//   node/spec.json       the bundled chain spec, rewritten at every start
//   node/db/             the copy itself

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MANIFEST: &str = "https://birdbrain.wtf/app/node/latest.json";
// Birdbrain's release key (id 7B2225DE066A9737).
// The node is the chain's program, so every edition checks it against the chain's key.
const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDdCMjIyNURFMDY2QTk3MzcKUldRM2wyb0czaVVpZXpORXY1TG4rUFA5RVhFN2Raa3IrU09FUnJJSmx2enZaWWRtVlROQk9RU28K";
// After this many crashes in a row it stops trying and says so.
const MAX_CRASHES: u32 = 5;
// The node's database keeps its write-ahead journal until it is reopened. A first sync
// of the live chain left 2.0 GB of journal over 64 MB of data (2026-10-06), so past this
// size the node is restarted, which takes about ten seconds and clears it.
const JOURNAL_LIMIT: u64 = 512 * 1024 * 1024;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    pub enabled: bool,
    /// off · fetching · waiting-for-power · starting · syncing · synced · error
    pub phase: String,
    pub version: Option<String>,
    pub fetched_bytes: Option<u64>,
    pub fetch_total: Option<u64>,
    pub best: Option<u64>,
    pub highest: Option<u64>,
    pub peers: Option<u64>,
    pub disk_bytes: Option<u64>,
    pub on_mains: bool,
    pub error: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    enabled: bool,
}

struct Running {
    child: Child,
    rpc_port: u16,
    started: Instant,
}

pub struct Node {
    dir: PathBuf,
    status: Mutex<NodeStatus>,
    running: Mutex<Option<Running>>,
    fetching: Mutex<bool>,
    crashes: Mutex<u32>,
}

pub struct NodeState(pub Mutex<Option<Arc<Node>>>);

fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        o => o,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

fn exe_name(version: &str) -> String {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    format!("seeds-node-{version}{ext}")
}

/// Mains power, or no battery at all. Windows is assumed plugged in until it is checked.
pub fn on_mains() -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("/usr/bin/pmset").args(["-g", "ps"]).output() {
            let s = String::from_utf8_lossy(&out.stdout);
            return !s.contains("'Battery Power'");
        }
        true
    }
    #[cfg(target_os = "linux")]
    {
        let Ok(entries) = std::fs::read_dir("/sys/class/power_supply") else { return true };
        let mut saw_mains = false;
        for e in entries.flatten() {
            let p = e.path();
            let kind = std::fs::read_to_string(p.join("type")).unwrap_or_default();
            if kind.trim() == "Mains" {
                saw_mains = true;
                if std::fs::read_to_string(p.join("online")).unwrap_or_default().trim() == "1" {
                    return true;
                }
            }
        }
        !saw_mains
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        true
    }
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// The database's write-ahead journal: the *.log files under db/chains/<id>/db/full.
fn journal_size(db: &Path) -> u64 {
    let Ok(chains) = std::fs::read_dir(db.join("chains")) else { return 0 };
    chains
        .flatten()
        .filter_map(|c| std::fs::read_dir(c.path().join("db/full")).ok())
        .flat_map(|rd| rd.flatten())
        .filter(|e| e.path().extension().map(|x| x == "log").unwrap_or(false))
        .filter_map(|e| e.metadata().ok().map(|m| m.len()))
        .sum()
}

fn free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok().map(|a| a.port())
}

/// One JSON-RPC call to the node on this computer. Plain HTTP on the loopback, so no
/// client library: the node never listens anywhere else.
fn local_rpc(port: u16, method: &str) -> Option<Value> {
    let body = json!({"id":1,"jsonrpc":"2.0","method":method,"params":[]}).to_string();
    let mut s = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    write!(
        s,
        "POST / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        port,
        body.len(),
        body
    )
    .ok()?;
    let mut buf = String::new();
    s.read_to_string(&mut buf).ok()?;
    let json = buf.split("\r\n\r\n").nth(1)?;
    serde_json::from_str::<Value>(json).ok()?.get("result").cloned()
}

fn verify(data: &[u8], signature_b64: &str) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let text = |s: &str| -> Result<String, String> {
        String::from_utf8(b64.decode(s.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let pk = minisign_verify::PublicKey::decode(&text(PUBKEY)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&text(signature_b64)?).map_err(|e| e.to_string())?;
    pk.verify(data, &sig, true).map_err(|_| "the node program's signature does not match Birdbrain's key".into())
}

impl Node {
    pub fn start(data_dir: PathBuf) -> Arc<Node> {
        let dir = data_dir.join("node");
        let _ = std::fs::create_dir_all(&dir);
        let node = Arc::new(Node {
            dir,
            status: Mutex::new(NodeStatus { phase: "off".into(), ..Default::default() }),
            running: Mutex::new(None),
            fetching: Mutex::new(false),
            crashes: Mutex::new(0),
        });
        let enabled = node.settings().enabled;
        {
            let mut s = node.status.lock().unwrap();
            s.enabled = enabled;
            s.version = node.installed();
        }
        // An enabled copy checks for a newer node program once per launch.
        if enabled {
            node.clone().fetch_in_background();
        }
        let sup = node.clone();
        std::thread::Builder::new()
            .name("full-node".into())
            .spawn(move || loop {
                sup.tick();
                std::thread::sleep(Duration::from_secs(5));
            })
            .ok();
        node
    }

    fn settings(&self) -> Settings {
        std::fs::read_to_string(self.dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// The checked program on disk. Versions are build hashes, so the newest file wins.
    fn installed(&self) -> Option<String> {
        std::fs::read_dir(&self.dir)
            .ok()?
            .flatten()
            .filter_map(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                let v = n.strip_prefix("seeds-node-")?.trim_end_matches(".exe").to_string();
                let t = e.metadata().ok()?.modified().ok()?;
                (!v.ends_with(".part")).then_some((t, v))
            })
            .max()
            .map(|(_, v)| v)
    }

    pub fn status(&self) -> NodeStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn set_enabled(self: &Arc<Self>, enabled: bool) -> Result<(), String> {
        let body = serde_json::to_string(&Settings { enabled }).unwrap();
        std::fs::write(self.dir.join("settings.json"), body).map_err(|e| e.to_string())?;
        {
            let mut s = self.status.lock().unwrap();
            s.enabled = enabled;
            s.error = None;
        }
        *self.crashes.lock().unwrap() = 0;
        if enabled {
            if self.installed().is_none() {
                self.clone().fetch_in_background();
            }
        } else {
            self.stop();
        }
        self.tick();
        Ok(())
    }

    /// Switch off and delete the copy and the program. Nothing else is touched.
    pub fn remove(self: &Arc<Self>) -> Result<(), String> {
        self.set_enabled(false)?;
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.file_name().map(|n| n == "settings.json").unwrap_or(false) {
                    continue;
                }
                let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
            }
        }
        let mut s = self.status.lock().unwrap();
        s.version = None;
        s.disk_bytes = Some(0);
        Ok(())
    }

    fn fetch_in_background(self: Arc<Self>) {
        {
            let mut f = self.fetching.lock().unwrap();
            if *f {
                return;
            }
            *f = true;
        }
        std::thread::Builder::new()
            .name("full-node-fetch".into())
            .spawn(move || {
                let r = self.fetch();
                *self.fetching.lock().unwrap() = false;
                let mut s = self.status.lock().unwrap();
                s.fetched_bytes = None;
                s.fetch_total = None;
                match r {
                    Ok(v) => {
                        s.version = Some(v);
                        s.error = None;
                    }
                    // A failed check for a newer version leaves a working copy alone.
                    Err(e) if s.version.is_none() => s.error = Some(e),
                    Err(_) => {}
                }
            })
            .ok();
    }

    /// Fetch the manifest, and the program if it is newer than the one on disk. The program
    /// is checked against Birdbrain's key before it is unpacked, and only then renamed into
    /// place, so a half-fetched or forged file never runs.
    fn fetch(&self) -> Result<String, String> {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| e.to_string())?;
        let manifest: Value = client
            .get(MANIFEST)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json())
            .map_err(|e| format!("couldn't reach birdbrain.wtf for the node program: {e}"))?;
        // Each platform is built on its own machine, so each carries its own version.
        let entry = &manifest["platforms"][platform()];
        let version = entry["version"].as_str().ok_or_else(|| format!("no node program for {} yet", platform()))?.to_string();
        if version.contains(['/', '\\']) || version.contains("..") {
            return Err("the node manifest names an odd version".into());
        }
        if self.installed().as_deref() == Some(version.as_str()) {
            return Ok(version);
        }
        let url = entry["url"].as_str().ok_or_else(|| format!("no node program for {} yet", platform()))?;
        let signature = entry["signature"].as_str().ok_or("the node manifest carries no signature")?;
        if !url.starts_with("https://birdbrain.wtf/app/node/") {
            return Err("the node manifest points somewhere other than birdbrain.wtf".into());
        }

        let mut resp = client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("couldn't fetch the node program: {e}"))?;
        let total = resp.content_length();
        self.status.lock().unwrap().fetch_total = total;
        let mut gz = Vec::with_capacity(total.unwrap_or(0) as usize);
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            gz.extend_from_slice(&buf[..n]);
            self.status.lock().unwrap().fetched_bytes = Some(gz.len() as u64);
        }
        verify(&gz, signature)?;

        let mut bin = Vec::new();
        flate2::read::GzDecoder::new(&gz[..]).read_to_end(&mut bin).map_err(|e| e.to_string())?;
        let target = self.dir.join(exe_name(&version));
        let part = self.dir.join(format!("{}.part", exe_name(&version)));
        std::fs::write(&part, &bin).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
        // Older programs go once the new one is in place. A running one is restarted on
        // the new version by tick().
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                // Unix keeps a running program alive after its file goes; elsewhere the
                // delete fails quietly and the next launch tidies it.
                if n.starts_with("seeds-node-") && n != exe_name(&version) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        Ok(version)
    }

    fn spawn(&self, version: &str) -> Result<Running, String> {
        let spec = self.dir.join("spec.json");
        std::fs::write(&spec, crate::chain::SPEC).map_err(|e| e.to_string())?;
        let port = free_port().ok_or("no free port on this computer")?;
        let log = std::fs::File::create(self.dir.join("node.log")).map_err(|e| e.to_string())?;
        let child = Command::new(self.dir.join(exe_name(version)))
            .arg("--chain").arg(&spec)
            .arg("--base-path").arg(self.dir.join("db"))
            .args(["--name", "keep-a-copy"])
            // Every block, and the state of the last 256: the record without the archive's weight.
            .args(["--sync", "full", "--blocks-pruning", "archive-canonical", "--state-pruning", "256"])
            // Peers on any free port, RPC on the loopback only and read-only.
            .args(["--port", "0", "--rpc-port", &port.to_string(), "--rpc-methods", "safe", "--rpc-cors", "none"])
            .args(["--no-telemetry", "--no-mdns", "--no-prometheus"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()
            .map_err(|e| format!("the node program wouldn't start: {e}"))?;
        Ok(Running { child, rpc_port: port, started: Instant::now() })
    }

    /// Ask the node to close its database cleanly, then insist.
    pub fn stop(&self) {
        let Some(mut r) = self.running.lock().unwrap().take() else { return };
        #[cfg(unix)]
        {
            let _ = Command::new("kill").args(["-TERM", &r.child.id().to_string()]).status();
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if let Ok(Some(_)) = r.child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
        let _ = r.child.kill();
        let _ = r.child.wait();
    }

    fn tick(&self) {
        let mains = on_mains();
        let enabled = self.settings().enabled;
        let version = self.installed();
        let fetching = *self.fetching.lock().unwrap();

        // A crash shows up here as an exited child.
        let mut exited = None;
        if let Some(r) = self.running.lock().unwrap().as_mut() {
            if let Ok(Some(code)) = r.child.try_wait() {
                exited = Some(code);
            }
        }
        if let Some(code) = exited {
            self.running.lock().unwrap().take();
            let n = {
                let mut c = self.crashes.lock().unwrap();
                *c += 1;
                *c
            };
            let tail = std::fs::read_to_string(self.dir.join("node.log"))
                .unwrap_or_default()
                .lines()
                .rev()
                .find(|l| l.contains("Error") || l.contains("error"))
                .map(|l| l.to_string());
            self.status.lock().unwrap().error =
                Some(format!("the node stopped ({code}){}", tail.map(|t| format!(": {t}")).unwrap_or_default()));
            if n >= MAX_CRASHES {
                return self.set_phase("error", mains);
            }
        }

        // A newer program on disk replaces a running older one.
        let running_old = {
            let g = self.running.lock().unwrap();
            g.is_some() && self.status.lock().unwrap().version != version
        };
        if running_old {
            self.stop();
        }

        let want = enabled && mains && version.is_some() && *self.crashes.lock().unwrap() < MAX_CRASHES;
        let is_running = self.running.lock().unwrap().is_some();
        if want && !is_running {
            match self.spawn(version.as_deref().unwrap()) {
                Ok(r) => {
                    *self.running.lock().unwrap() = Some(r);
                    self.status.lock().unwrap().version = version.clone();
                }
                Err(e) => {
                    self.status.lock().unwrap().error = Some(e);
                    *self.crashes.lock().unwrap() += 1;
                }
            }
        } else if !want && is_running {
            self.stop();
        } else if is_running && journal_size(&self.dir.join("db")) > JOURNAL_LIMIT {
            // Not a crash: the next tick starts it again on a clean journal.
            self.stop();
        }

        let probe = self.running.lock().unwrap().as_ref().map(|r| (r.rpc_port, r.started));
        let mut s = self.status.lock().unwrap();
        s.on_mains = mains;
        s.enabled = enabled;
        if let Some((port, started)) = probe {
            let sync = local_rpc(port, "system_syncState");
            let health = local_rpc(port, "system_health");
            if let Some(v) = &sync {
                s.best = v["currentBlock"].as_u64();
                s.highest = v["highestBlock"].as_u64();
            }
            if let Some(v) = &health {
                s.peers = v["peers"].as_u64();
            }
            let caught_up = health.as_ref().map(|h| h["isSyncing"] == false).unwrap_or(false)
                && s.best.is_some()
                && s.best >= s.highest.map(|h| h.saturating_sub(2));
            if sync.is_some() {
                *self.crashes.lock().unwrap() = 0;
                s.error = None;
            }
            s.phase = if sync.is_none() && started.elapsed() < Duration::from_secs(60) {
                "starting"
            } else if caught_up {
                "synced"
            } else {
                "syncing"
            }
            .into();
        } else {
            s.phase = if !enabled {
                "off"
            } else if fetching {
                "fetching"
            } else if s.phase == "error" || (version.is_none() && s.error.is_some()) {
                "error"
            } else if !mains {
                "waiting-for-power"
            } else {
                "starting"
            }
            .into();
        }
        s.disk_bytes = Some(dir_size(&self.dir.join("db")));
    }

    fn set_phase(&self, phase: &str, mains: bool) {
        let mut s = self.status.lock().unwrap();
        s.phase = phase.into();
        s.on_mains = mains;
    }
}

#[tauri::command]
pub fn node_status(state: tauri::State<'_, NodeState>) -> NodeStatus {
    match state.0.lock().unwrap().as_ref() {
        Some(n) => n.status(),
        None => NodeStatus { phase: "off".into(), on_mains: on_mains(), ..Default::default() },
    }
}

#[tauri::command]
pub fn node_set_enabled(state: tauri::State<'_, NodeState>, enabled: bool) -> Result<NodeStatus, String> {
    let n = state.0.lock().unwrap().clone().ok_or("the node isn't ready yet")?;
    n.set_enabled(enabled)?;
    Ok(n.status())
}

#[tauri::command]
pub fn node_remove(state: tauri::State<'_, NodeState>) -> Result<NodeStatus, String> {
    let n = state.0.lock().unwrap().clone().ok_or("the node isn't ready yet")?;
    n.remove()?;
    Ok(n.status())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Against the real thing: fetches from birdbrain.wtf, checks, runs, follows the chain.
    // cargo test --lib node -- --ignored --nocapture
    #[test]
    #[ignore]
    fn keeps_a_copy_of_the_live_chain() {
        let dir = std::env::temp_dir().join(format!("murmur-node-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let node = Node::start(dir.clone());
        // Stops the child even when an assertion below fails.
        struct Guard(Arc<Node>);
        impl Drop for Guard {
            fn drop(&mut self) {
                self.0.stop();
            }
        }
        let _guard = Guard(node.clone());
        assert_eq!(node.status().phase, "off");
        node.set_enabled(true).unwrap();

        let t0 = Instant::now();
        let mut seen_fetch = false;
        let mut last = String::new();
        let mut peak_disk = 0u64;
        let mut pids = std::collections::BTreeSet::new();
        loop {
            let s = node.status();
            peak_disk = peak_disk.max(s.disk_bytes.unwrap_or(0));
            if let Some(r) = node.running.lock().unwrap().as_ref() {
                pids.insert(r.child.id());
            }
            seen_fetch |= s.phase == "fetching";
            let line = format!("{} best={:?} peers={:?} err={:?}", s.phase, s.best.map(|b| b / 10_000 * 10_000), s.peers, s.error);
            if line != last {
                println!("{:>5.1}s {line}", t0.elapsed().as_secs_f32());
                last = line;
            }
            if s.phase == "error" {
                panic!("node error: {:?}", s.error);
            }
            if s.phase == "synced" {
                println!(
                    "{:>5.1}s synced at #{:?}, {} MB on disk (peak {} MB), {} node starts",
                    t0.elapsed().as_secs_f32(),
                    s.best,
                    s.disk_bytes.unwrap_or(0) / 1_000_000,
                    peak_disk / 1_000_000,
                    pids.len()
                );
                break;
            }
            assert!(t0.elapsed() < Duration::from_secs(1800), "not synced in 30 minutes");
            std::thread::sleep(Duration::from_millis(500));
        }
        assert!(seen_fetch, "never fetched the program");
        let pid = node.running.lock().unwrap().as_ref().unwrap().child.id();

        node.set_enabled(false).unwrap();
        assert!(node.running.lock().unwrap().is_none());
        assert!(!Path::new(&format!("/proc/{pid}")).exists(), "the node outlived switching off");
        assert_eq!(node.status().phase, "off");

        node.remove().unwrap();
        assert!(node.installed().is_none());
        assert!(!dir.join("node/db").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_a_program_birdbrain_did_not_sign() {
        // A real signature from the published manifest, over different bytes.
        let sig = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRM2wyb0czaVVpZS9hMTdqeTBackpqL0J2dm03MkFBMlRGYTd4SE92RWhyMUdOTDQ5RVgwWFZKSlRHdTBSR1ZZSytpeko5YTJiak9BMmxDZ2tNRE1EZU5XeVhIUW81ZlFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxMzE2NzcyCWZpbGU6c2VlZHMtbm9kZS0wLjAuMC0xOWJlNmQwMzQ3MS1saW51eC14ODZfNjQuZ3oKci9taWI3OXJOY1U0Z3RVT2VaTzlGK3hpVWlESW9QRVY1SFIyRUVlVWhJa202V3pNT25ZR1FyNThWcEpxdVJON1djays5a1dKeWpMT3R5L2JtRlR6QXc9PQo=";
        assert!(verify(b"not the node", sig).is_err());
        assert!(verify(b"anything", "not base64!").is_err());
    }
}
