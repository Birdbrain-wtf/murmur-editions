// Private messages: the SimpleX chat core, run as a child process.
//
// Off by default. Switched on from private chats in Chat, the app fetches the
// upstream simplex-chat program for this computer from its own collective's host,
// checks it against that collective's release key, and runs it on the loopback with
// that collective's own SimpleX relay as its only server. Each edition has its own
// (`Home` below): Birdbrain's on birdbrain.wtf, Decent's on Decent's box (ADR 0076
// keeps the two apart). Editions without one have no private messages. The page talks to the core over
// its WebSocket (src/lib/simplex/). Messages are end-to-end encrypted between the
// two members' cores; the relay passes sealed envelopes and holds no identities.
// Nothing here is ever read into any world model.
//
// Same shape as the exchange engine (exchange.rs): a signed program fetched once,
// a supervisor that restarts it up to MAX_CRASHES times, stopped cleanly on quit.
//
// Files, all under the app's data folder:
//   simplex/settings.json        whether it is switched on, and the name it starts with
//   simplex/simplex-chat-<v>     the checked program
//   simplex/lib/                 libraries the program needs on this platform (macOS: libcrypto)
//   simplex/db/murmur_*.db       the core's own contacts, keys and messages
//
// The core's WebSocket binds 127.0.0.1 only (checked against v6.5.4.1), on a port
// chosen afresh at every start. It has no login of its own and accepts any local
// caller, including a web page in a browser that finds the port. That is a known gap
// until the core runs in-process (simplex's own library); keep it in mind before
// calling this anything stronger than "lab".

use std::{
    io::Read,
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_CRASHES: u32 = 5;

/// Whose private messages these are: the collective's relay, where its program is
/// published and the key it is signed with. The program is upstream simplex-chat,
/// re-signed by us after we fetch it from simplex-chat's own GitHub release
/// (scripts/publish-simplex.ts).
///
/// Creating a queue on a relay needs a password; sending to a queue that already
/// exists does not. The password is not a secret in any strong sense: it ships
/// inside every build that carries it, so anyone who unpacks the app can read it.
/// It is a speed bump that keeps casual strangers from using our relay as free
/// infrastructure, nothing more. It is injected at build time (the full address,
/// `smp://<fingerprint>:<password>@<host>`) by the release scripts, so it never sits
/// in this file or the public repo. Without it the build falls back to the address
/// with no password, and the core can make no new queue: no invitations, no
/// joining. The page says so.
pub struct Home {
    /// the collective's name, for messages
    name: &'static str,
    /// where its program is published, for messages
    host: &'static str,
    manifest: &'static str,
    url_prefix: &'static str,
    pubkey: &'static str,
    relay_public: &'static str,
    relay_fingerprint: &'static str,
    relay_host: &'static str,
    relay_built: Option<&'static str>,
    /// Where the page may post invite events (the browser's CORS rules stop a
    /// direct fetch from the app to /api/murmur/invite, which sends no CORS headers).
    invite_bases: &'static [&'static str],
}

// Birdbrain's release key, the same one the node and the exchange engine are checked against.
const BIRDBRAIN: Home = Home {
    name: "Birdbrain",
    host: "birdbrain.wtf",
    manifest: "https://birdbrain.wtf/app/simplex/latest.json",
    url_prefix: "https://birdbrain.wtf/app/simplex/",
    pubkey: "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDdCMjIyNURFMDY2QTk3MzcKUldRM2wyb0czaVVpZXpORXY1TG4rUFA5RVhFN2Raa3IrU09FUnJJSmx2enZaWWRtVlROQk9RU28K",
    relay_public: "smp://xTitGU04tmLxjIS55L7Ad_WMlbhCbd1gRUFQk4B-C0g=@smp.birdbrain.wtf",
    relay_fingerprint: "xTitGU04tmLxjIS55L7Ad_WMlbhCbd1gRUFQk4B-C0g=",
    relay_host: "smp.birdbrain.wtf",
    relay_built: option_env!("MURMUR_SMP_RELAY"),
    invite_bases: &["https://birdbrain.wtf"],
};

// Decent's update key (the one its app updates are checked against), Decent's relay on
// Decent's own box. It answers on matrix.decent.partners because that is the name the
// box has; members pin the relay by its fingerprint, not its name (lab/simplex-comms).
const DECENT: Home = Home {
    name: "Decent",
    host: "www.decent.partners",
    manifest: "https://www.decent.partners/app/simplex/latest.json",
    url_prefix: "https://www.decent.partners/app/simplex/",
    pubkey: "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDJDMEEyODUzQTEwQjdDMjYKUldRbWZBdWhVeWdLTEZ3QVAyODVPdHN0NG1UaXI1aGM4dDdmNDhETjN1Njl5VnJUYXNBaEVqcG8K",
    relay_public: "smp://PrEElKJdbf1GKRUt5KD-Sj5Jv7cAs3NyKUjFs5snkPo=@matrix.decent.partners",
    relay_fingerprint: "PrEElKJdbf1GKRUt5KD-Sj5Jv7cAs3NyKUjFs5snkPo=",
    relay_host: "matrix.decent.partners",
    relay_built: option_env!("MURMUR_SMP_RELAY_DECENT"),
    invite_bases: &["https://rw.zo.space", "https://www.decent.partners"],
};

/// The collective this build's private messages belong to, by its bundle id.
pub fn home_for(identifier: &str) -> Option<&'static Home> {
    match identifier {
        "wtf.birdbrain.murmur" => Some(&BIRDBRAIN),
        "partners.decent.murmur" => Some(&DECENT),
        _ => None,
    }
}

impl Home {
    /// The relay this build uses, and whether it can create queues on it.
    fn relay(&self) -> (String, bool) {
        match self.relay_built.map(str::trim) {
            // Only ever this collective's relay, whatever the build environment says.
            Some(r) if r.starts_with(&format!("smp://{}:", self.relay_fingerprint)) && r.ends_with(&format!("@{}", self.relay_host)) => (r.to_string(), true),
            _ => (self.relay_public.to_string(), false),
        }
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimplexStatus {
    pub enabled: bool,
    /// off · fetching · starting · ready · error
    pub phase: String,
    pub version: Option<String>,
    /// whether this build carries the relay's queue password (can invite and join)
    pub can_connect: bool,
    pub relay_host: String,
    pub fetched_bytes: Option<u64>,
    pub fetch_total: Option<u64>,
    pub error: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    enabled: bool,
    /// The profile name the core is created with on its first start. SimpleX shows
    /// it to the people you connect with; it never reaches the relay.
    #[serde(default)]
    name: Option<String>,
}

struct Running {
    child: Child,
    port: u16,
    /// the WebSocket answers
    up: bool,
}

pub struct Core {
    home: &'static Home,
    dir: PathBuf,
    pubkey: String,
    manifest: String,
    status: Mutex<SimplexStatus>,
    running: Mutex<Option<Running>>,
    fetching: Mutex<bool>,
    crashes: Mutex<u32>,
}

pub struct SimplexState(pub Mutex<Option<Arc<Core>>>);

fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        o => o,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

fn exe_name(version: &str) -> String {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    format!("simplex-chat-{version}{ext}")
}

fn free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok().map(|a| a.port())
}

fn verify(home: &Home, pubkey: &str, data: &[u8], signature_b64: &str) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let text = |s: &str| -> Result<String, String> {
        String::from_utf8(b64.decode(s.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let pk = minisign_verify::PublicKey::decode(&text(pubkey)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&text(signature_b64)?).map_err(|e| e.to_string())?;
    pk.verify(data, &sig, true).map_err(|_| format!("the private messages program's signature does not match {}'s key", home.name))
}

/// A SimpleX profile name: letters, digits, dot, dash and underscore, so the core's
/// own command line never splits it. Falls back to "member".
fn clean_name(name: &str) -> String {
    let n: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .collect::<String>()
        .trim_matches(|c| c == '_' || c == '.')
        .chars()
        .take(40)
        .collect();
    if n.is_empty() { "member".into() } else { n }
}

fn safe_file_name(n: &str) -> bool {
    !n.is_empty() && n.len() < 100 && !n.contains(['/', '\\']) && !n.contains("..") && !n.starts_with('.')
}

impl Core {
    /// Nothing for an edition without private messages of its own.
    pub fn start(data_dir: PathBuf, identifier: &str) -> Option<Arc<Core>> {
        let home = home_for(identifier)?;
        Some(Self::start_with(data_dir, home, home.pubkey.into(), home.manifest.into()))
    }

    fn start_with(data_dir: PathBuf, home: &'static Home, pubkey: String, manifest: String) -> Arc<Core> {
        let dir = data_dir.join("simplex");
        let _ = std::fs::create_dir_all(dir.join("db"));
        let (_, can_connect) = home.relay();
        let core = Arc::new(Core {
            home,
            dir,
            pubkey,
            manifest,
            status: Mutex::new(SimplexStatus {
                phase: "off".into(),
                can_connect,
                relay_host: home.relay_host.into(),
                ..Default::default()
            }),
            running: Mutex::new(None),
            fetching: Mutex::new(false),
            crashes: Mutex::new(0),
        });
        let enabled = core.settings().enabled;
        {
            let mut s = core.status.lock().unwrap();
            s.enabled = enabled;
            s.version = core.installed();
        }
        if enabled {
            core.clone().fetch_in_background();
        }
        let sup = core.clone();
        std::thread::Builder::new()
            .name("simplex".into())
            .spawn(move || loop {
                sup.tick();
                std::thread::sleep(Duration::from_secs(2));
            })
            .ok();
        core
    }

    fn settings(&self) -> Settings {
        std::fs::read_to_string(self.dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn installed(&self) -> Option<String> {
        std::fs::read_dir(&self.dir)
            .ok()?
            .flatten()
            .filter_map(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                let v = n.strip_prefix("simplex-chat-")?.trim_end_matches(".exe").to_string();
                let t = e.metadata().ok()?.modified().ok()?;
                (!v.ends_with(".part")).then_some((t, v))
            })
            .max()
            .map(|(_, v)| v)
    }

    pub fn status(&self) -> SimplexStatus {
        self.status.lock().unwrap().clone()
    }

    /// The loopback address the page connects to, once the core answers.
    pub fn ws_url(&self) -> Option<String> {
        self.running.lock().unwrap().as_ref().filter(|r| r.up).map(|r| format!("ws://127.0.0.1:{}", r.port))
    }

    pub fn set_enabled(self: &Arc<Self>, enabled: bool, name: Option<String>) -> Result<(), String> {
        let mut settings = self.settings();
        settings.enabled = enabled;
        // The name only matters the first time the core starts; keep the first one.
        if settings.name.is_none() {
            settings.name = name.map(|n| clean_name(&n));
        }
        let body = serde_json::to_string(&settings).unwrap();
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

    /// Switch off and delete the program and everything the core kept: contacts,
    /// keys and messages on this computer. The people you talked to keep their side.
    pub fn remove(self: &Arc<Self>) -> Result<(), String> {
        self.set_enabled(false, None)?;
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let p = e.path();
                let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
            }
        }
        let _ = std::fs::create_dir_all(self.dir.join("db"));
        let mut s = self.status.lock().unwrap();
        s.version = None;
        s.enabled = false;
        s.phase = "off".into();
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
            .name("simplex-fetch".into())
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
                    Err(e) if s.version.is_none() => s.error = Some(e),
                    Err(_) => {}
                }
            })
            .ok();
    }

    fn get_signed(&self, client: &reqwest::blocking::Client, url: &str, signature: &str, prefix: &str, progress: bool) -> Result<Vec<u8>, String> {
        if !url.starts_with(prefix) {
            return Err(format!("the private messages manifest points somewhere other than {}", self.home.host));
        }
        let mut resp = client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("couldn't fetch the private messages program: {e}"))?;
        let total = resp.content_length();
        if progress {
            self.status.lock().unwrap().fetch_total = total;
        }
        let mut gz = Vec::with_capacity(total.unwrap_or(0) as usize);
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            gz.extend_from_slice(&buf[..n]);
            if progress {
                self.status.lock().unwrap().fetched_bytes = Some(gz.len() as u64);
            }
        }
        verify(self.home, &self.pubkey, &gz, signature)?;
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&gz[..]).read_to_end(&mut out).map_err(|e| e.to_string())?;
        Ok(out)
    }

    fn write_exec(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
        let part = path.with_extension("part");
        std::fs::write(&part, bytes).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&part, path).map_err(|e| e.to_string())
    }

    /// Manifest, then each file checked against Birdbrain's key over its gzip before
    /// it is unpacked. Libraries land first and the program last, so a program on
    /// disk always has its libraries beside it. A half-fetched or forged file never runs.
    ///
    /// latest.json: { platforms: { "<os>-<arch>": { version, url, signature,
    ///                libs?: [{ name, url, signature }] } } }
    fn fetch(&self) -> Result<String, String> {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| e.to_string())?;
        let manifest: Value = client
            .get(&self.manifest)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json())
            .map_err(|e| format!("couldn't reach {} for private messages: {e}", self.home.host))?;
        let entry = &manifest["platforms"][platform()];
        let version = entry["version"].as_str().ok_or_else(|| format!("no private messages program for {} yet", platform()))?.to_string();
        if version.contains(['/', '\\']) || version.contains("..") {
            return Err("the private messages manifest names an odd version".into());
        }
        if self.installed().as_deref() == Some(version.as_str()) {
            return Ok(version);
        }
        let prefix = if self.manifest == self.home.manifest { self.home.url_prefix.to_string() } else { self.manifest.rsplit_once('/').map(|(p, _)| format!("{p}/")).unwrap_or_default() };

        let lib_dir = self.dir.join("lib");
        if let Some(libs) = entry["libs"].as_array() {
            let _ = std::fs::create_dir_all(&lib_dir);
            for l in libs {
                let name = l["name"].as_str().ok_or("the private messages manifest names a library without a name")?;
                if !safe_file_name(name) {
                    return Err("the private messages manifest names an odd library".into());
                }
                let url = l["url"].as_str().ok_or("the private messages manifest names a library without an address")?;
                let sig = l["signature"].as_str().ok_or("the private messages manifest carries a library with no signature")?;
                let bytes = self.get_signed(&client, url, sig, &prefix, false)?;
                Self::write_exec(&lib_dir.join(name), &bytes)?;
            }
        }

        let url = entry["url"].as_str().ok_or_else(|| format!("no private messages program for {} yet", platform()))?;
        let signature = entry["signature"].as_str().ok_or("the private messages manifest carries no signature")?;
        let bin = self.get_signed(&client, url, signature, &prefix, true)?;
        Self::write_exec(&self.dir.join(exe_name(&version)), &bin)?;
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("simplex-chat-") && n != exe_name(&version) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        Ok(version)
    }

    /// A core left running by an earlier session of this app still holds the
    /// database. Stop it first.
    #[cfg(unix)]
    fn stop_leftover(&self) {
        let pid_file = self.dir.join("core.pid");
        let Some(pid) = std::fs::read_to_string(&pid_file).ok().and_then(|s| s.trim().parse::<u32>().ok()) else { return };
        let _ = std::fs::remove_file(&pid_file);
        let alive = |pid: u32| {
            Command::new("ps").args(["-p", &pid.to_string(), "-o", "comm="]).output().ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).contains("simplex"))
                .unwrap_or(false)
        };
        if !alive(pid) {
            return;
        }
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline && alive(pid) {
            std::thread::sleep(Duration::from_millis(200));
        }
        if alive(pid) {
            let _ = Command::new("kill").args(["-KILL", &pid.to_string()]).status();
        }
    }

    fn spawn(&self, version: &str) -> Result<Running, String> {
        #[cfg(unix)]
        self.stop_leftover();
        let port = free_port().ok_or("no free port on this computer")?;
        let log = std::fs::File::create(self.dir.join("core.log")).map_err(|e| e.to_string())?;
        let (relay, _) = self.home.relay();
        let name = self.settings().name.unwrap_or_else(|| "member".into());
        let mut cmd = Command::new(self.dir.join(exe_name(version)));
        cmd.arg("-d").arg(self.dir.join("db").join("murmur"))
            // The WebSocket API, which simplex-chat binds to 127.0.0.1 only.
            .arg("-p").arg(port.to_string())
            // The collective's relay and no other: the core never falls back to SimpleX's presets.
            .arg("-s").arg(&relay)
            .arg("-y")
            // On first start the core asks for a profile name on stdin; this answers it.
            .arg("--create-bot-display-name").arg(clean_name(&name))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log);
        // Libraries the program was built against, beside it (macOS: Homebrew's
        // libcrypto, which a member's Mac doesn't have).
        let lib = self.dir.join("lib");
        if lib.is_dir() {
            #[cfg(target_os = "macos")]
            cmd.env("DYLD_LIBRARY_PATH", &lib);
            #[cfg(target_os = "linux")]
            cmd.env("LD_LIBRARY_PATH", &lib);
        }
        let child = cmd.spawn().map_err(|e| format!("private messages wouldn't start: {e}"))?;
        let _ = std::fs::write(self.dir.join("core.pid"), child.id().to_string());
        Ok(Running { child, port, up: false })
    }

    pub fn stop(&self) {
        let Some(mut r) = self.running.lock().unwrap().take() else { return };
        let _ = std::fs::remove_file(self.dir.join("core.pid"));
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
        let enabled = self.settings().enabled;
        let version = self.installed();
        let fetching = *self.fetching.lock().unwrap();

        let mut exited = None;
        if let Some(r) = self.running.lock().unwrap().as_mut() {
            if let Ok(Some(code)) = r.child.try_wait() {
                exited = Some(code);
            }
        }
        if let Some(code) = exited {
            self.running.lock().unwrap().take();
            *self.crashes.lock().unwrap() += 1;
            let log = std::fs::read_to_string(self.dir.join("core.log")).unwrap_or_default();
            let tail = log.lines().rev().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string());
            self.status.lock().unwrap().error =
                Some(format!("private messages stopped ({code}){}", tail.map(|t| format!(": {t}")).unwrap_or_default()));
        }

        let running_old = {
            let g = self.running.lock().unwrap();
            g.is_some() && self.status.lock().unwrap().version != version
        };
        if running_old {
            self.stop();
        }

        let want = enabled && version.is_some() && *self.crashes.lock().unwrap() < MAX_CRASHES;
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
        }

        // Ready once the WebSocket port takes a connection.
        let pending = self.running.lock().unwrap().as_ref().filter(|r| !r.up).map(|r| r.port);
        if let Some(port) = pending {
            if TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500)).is_ok() {
                if let Some(r) = self.running.lock().unwrap().as_mut() {
                    r.up = true;
                }
                *self.crashes.lock().unwrap() = 0;
                self.status.lock().unwrap().error = None;
            }
        }

        let ready = self.running.lock().unwrap().as_ref().map(|r| r.up);
        let crashed_out = *self.crashes.lock().unwrap() >= MAX_CRASHES;
        let mut s = self.status.lock().unwrap();
        s.enabled = enabled;
        s.phase = match ready {
            Some(true) => "ready",
            Some(false) => "starting",
            None if !enabled => "off",
            None if fetching => "fetching",
            None if crashed_out || (version.is_none() && s.error.is_some()) => "error",
            None => "starting",
        }
        .into();
    }
}

/// Post one event to the invite graph from here rather than from the page, where
/// the browser's CORS rules would stop it. Only the listed origins, only this path.
fn invite_post(home: &Home, base: &str, body: &Value) -> Result<Value, String> {
    let base = base.trim_end_matches('/');
    if !home.invite_bases.contains(&base) {
        return Err(format!("private messages can't post invites to {base}"));
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{base}/api/murmur/invite"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .map_err(|e| format!("couldn't reach {base}: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    Ok(serde_json::json!({ "status": status, "body": json }))
}

#[tauri::command]
pub fn simplex_status(state: tauri::State<'_, SimplexState>) -> SimplexStatus {
    match state.0.lock().unwrap().as_ref() {
        Some(c) => c.status(),
        // Still starting, or an edition with no private messages of its own.
        None => SimplexStatus { phase: "off".into(), ..Default::default() },
    }
}

#[tauri::command]
pub fn simplex_set_enabled(state: tauri::State<'_, SimplexState>, enabled: bool, name: Option<String>) -> Result<SimplexStatus, String> {
    let c = state.0.lock().unwrap().clone().ok_or("private messages aren't ready yet")?;
    c.set_enabled(enabled, name)?;
    Ok(c.status())
}

#[tauri::command]
pub fn simplex_remove(state: tauri::State<'_, SimplexState>) -> Result<SimplexStatus, String> {
    let c = state.0.lock().unwrap().clone().ok_or("private messages aren't ready yet")?;
    c.remove()?;
    Ok(c.status())
}

/// The loopback WebSocket the page talks to the core on, or nothing until it answers.
#[tauri::command]
pub fn simplex_ws(state: tauri::State<'_, SimplexState>) -> Option<String> {
    state.0.lock().unwrap().as_ref().and_then(|c| c.ws_url())
}

#[tauri::command(async)]
pub fn simplex_invite_post(state: tauri::State<'_, SimplexState>, base: String, body: Value) -> Result<Value, String> {
    let home = state.0.lock().unwrap().as_ref().map(|c| c.home).ok_or("private messages aren't ready yet")?;
    std::thread::spawn(move || invite_post(home, &base, &body)).join().map_err(|_| "the invite call failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_never_split_the_command_line() {
        assert_eq!(clean_name("alice"), "alice");
        assert_eq!(clean_name("Alice Smith"), "Alice_Smith");
        assert_eq!(clean_name("  "), "member");
        assert_eq!(clean_name("@bob"), "bob");
    }

    #[test]
    fn only_our_relay() {
        for (home, built) in [(&BIRDBRAIN, option_env!("MURMUR_SMP_RELAY")), (&DECENT, option_env!("MURMUR_SMP_RELAY_DECENT"))] {
            let (r, can) = home.relay();
            assert!(r.starts_with(&format!("smp://{}", home.relay_fingerprint)));
            assert!(r.ends_with(&format!("@{}", home.relay_host)));
            // Built with the password: it is used. Without: the plain address, and no inviting.
            assert_eq!(can, built.is_some());
        }
    }

    #[test]
    fn each_edition_its_own_home() {
        assert_eq!(home_for("wtf.birdbrain.murmur").unwrap().relay_host, "smp.birdbrain.wtf");
        assert_eq!(home_for("partners.decent.murmur").unwrap().relay_host, "matrix.decent.partners");
        assert!(home_for("partners.decent.fttf").is_none());
        // Never one collective's program, relay or invite graph in another's app.
        assert_ne!(BIRDBRAIN.pubkey, DECENT.pubkey);
        assert!(!DECENT.url_prefix.contains("birdbrain") && !DECENT.relay_public.contains("birdbrain"));
        assert!(DECENT.invite_bases.iter().all(|b| !b.contains("birdbrain")));
        assert!(BIRDBRAIN.invite_bases.iter().all(|b| !b.contains("decent")));
    }

    #[test]
    fn invites_only_to_the_collective() {
        assert!(invite_post(&BIRDBRAIN, "https://evil.example", &Value::Null).is_err());
        assert!(invite_post(&DECENT, "https://birdbrain.wtf", &Value::Null).is_err());
        assert!(invite_post(&BIRDBRAIN, "https://rw.zo.space", &Value::Null).is_err());
    }

    #[test]
    fn refuses_a_program_its_collective_did_not_sign() {
        let sig = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRM2wyb0czaVVpZS9hMTdqeTBackpqL0J2dm03MkFBMlRGYTd4SE92RWhyMUdOTDQ5RVgwWFZKSlRHdTBSR1ZZSytpeko5YTJiak9BMmxDZ2tNRE1EZU5XeVhIUW81ZlFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxMzE2NzcyCWZpbGU6c2VlZHMtbm9kZS0wLjAuMC0xOWJlNmQwMzQ3MS1saW51eC14ODZfNjQuZ3oKci9taWI3OXJOY1U0Z3RVT2VaTzlGK3hpVWlESW9QRVY1SFIyRUVlVWhJa202V3pNT25ZR1FyNThWcEpxdVJON1djays5a1dKeWpMT3R5L2JtRlR6QXc9PQo=";
        assert!(verify(&BIRDBRAIN, BIRDBRAIN.pubkey, b"not the program", sig).is_err());
        assert!(verify(&DECENT, DECENT.pubkey, b"not the program", sig).is_err());
    }

    // Against a real program: serves a manifest signed with a throwaway key from a
    // local folder, fetches, checks, runs, and waits for the WebSocket on the loopback.
    //   SIMPLEX_TEST_PUBKEY=<b64 minisign public key> \
    //   SIMPLEX_TEST_MANIFEST=http://127.0.0.1:<port>/latest.json \
    //   cargo test --lib simplex -- --ignored --nocapture
    #[test]
    #[ignore]
    fn runs_the_core() {
        let pubkey = std::env::var("SIMPLEX_TEST_PUBKEY").expect("SIMPLEX_TEST_PUBKEY");
        let manifest = std::env::var("SIMPLEX_TEST_MANIFEST").expect("SIMPLEX_TEST_MANIFEST");
        let dir = std::env::temp_dir().join(format!("murmur-simplex-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let core = Core::start_with(dir.clone(), &DECENT, pubkey, manifest);
        struct Guard(Arc<Core>, PathBuf);
        impl Drop for Guard {
            fn drop(&mut self) {
                self.0.stop();
                let _ = std::fs::remove_dir_all(&self.1);
            }
        }
        let _g = Guard(core.clone(), dir.clone());
        core.set_enabled(true, Some("Alice Test".into())).unwrap();
        let t0 = Instant::now();
        loop {
            let s = core.status();
            if s.phase == "ready" {
                break;
            }
            assert!(s.phase != "error", "core error: {:?}", s.error);
            assert!(t0.elapsed() < Duration::from_secs(120), "not ready in 2 minutes: {:?}", s.phase);
            std::thread::sleep(Duration::from_millis(500));
        }
        let url = core.ws_url().unwrap();
        println!("ready in {:.1}s at {url}, v{:?}", t0.elapsed().as_secs_f32(), core.status().version);
        assert!(url.starts_with("ws://127.0.0.1:"));
        assert!(dir.join("simplex/db").read_dir().unwrap().count() > 0, "the core made its database");
        core.set_enabled(false, None).unwrap();
        assert!(core.running.lock().unwrap().is_none());
        assert!(core.ws_url().is_none());
        core.remove().unwrap();
        assert!(core.installed().is_none());
    }

    #[test]
    fn library_names_stay_in_their_folder() {
        assert!(safe_file_name("libcrypto.3.dylib"));
        assert!(!safe_file_name("../libcrypto.3.dylib"));
        assert!(!safe_file_name("a/b"));
        assert!(!safe_file_name(".hidden"));
    }
}
