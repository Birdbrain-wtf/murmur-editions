// The exchange engine: Decred's DEX client, run as a child process.
//
// Off by default. Switched on from the Exchange plugin, the app fetches the engine
// for this computer from birdbrain.wtf, checks it against Birdbrain's release key,
// and runs it on the loopback. The engine is bisonw from decred/dcrdex at a pinned
// commit plus the Kusama Asset Hub driver (lab/exchange/driver), so it trades KSM
// and dUSD on Asset Hub by atomic swap. It holds the member's exchange wallet; no
// server we run ever holds a key or a coin.
//
// The page never sees the engine's password. It is made once, kept in the system's
// secure store under this edition's bundle id, and used here to log in. Calls from
// the page go through `exchange_api`, which forwards only the routes on ALLOWED.
//
// Files, all under the app's data folder:
//   exchange/settings.json    whether it is switched on
//   exchange/bisonw-<v>       the checked program
//   exchange/data/            the engine's own wallets and records

use std::{
    io::Read,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MANIFEST: &str = "https://birdbrain.wtf/app/exchange/latest.json";
const URL_PREFIX: &str = "https://birdbrain.wtf/app/exchange/";
// Birdbrain's release key, the one the node program is checked against. The engine
// is common code, so every edition checks it against the same key.
const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDdCMjIyNURFMDY2QTk3MzcKUldRM2wyb0czaVVpZXpORXY1TG4rUFA5RVhFN2Raa3IrU09FUnJJSmx2enZaWWRtVlROQk9RU28K";
// Testnet until a swap contract is on Kusama Asset Hub and the regulatory read is in.
const NETWORK_FLAG: &str = "--testnet";
const MAX_CRASHES: u32 = 5;
const PASSWORD_ENTRY: &str = "exchange.app-password";

/// What the page may ask the engine. Everything that exports keys, changes the
/// password, runs bots or moves funds between chains stays out.
const ALLOWED: &[(&str, &str)] = &[
    ("GET", "/user"),
    ("GET", "/notes"),
    ("POST", "/newwallet"),
    ("POST", "/openwallet"),
    ("POST", "/depositaddress"),
    ("POST", "/redeemprepaidbond"),
    ("POST", "/approvetoken"),
    ("POST", "/approvetokenfee"),
    ("POST", "/preorder"),
    ("POST", "/maxbuy"),
    ("POST", "/maxsell"),
    ("POST", "/trade"),
    ("POST", "/cancel"),
    ("POST", "/orders"),
    ("POST", "/order"),
    ("POST", "/txhistory"),
];

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeStatus {
    pub enabled: bool,
    /// off · fetching · starting · ready · error
    pub phase: String,
    pub version: Option<String>,
    pub network: String,
    pub fetched_bytes: Option<u64>,
    pub fetch_total: Option<u64>,
    pub error: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    enabled: bool,
}

struct Running {
    child: Child,
    port: u16,
    started: Instant,
    /// The engine's session cookies once logged in.
    cookies: Option<String>,
}

pub struct Engine {
    dir: PathBuf,
    pubkey: String,
    manifest: String,
    /// Where the password lives in the system's secure store: the edition's bundle id.
    keyring_service: String,
    status: Mutex<ExchangeStatus>,
    running: Mutex<Option<Running>>,
    fetching: Mutex<bool>,
    crashes: Mutex<u32>,
}

pub struct ExchangeState(pub Mutex<Option<Arc<Engine>>>);

fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        o => o,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

fn exe_name(version: &str) -> String {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    format!("bisonw-{version}{ext}")
}

fn free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok().map(|a| a.port())
}

fn verify(pubkey: &str, data: &[u8], signature_b64: &str) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let text = |s: &str| -> Result<String, String> {
        String::from_utf8(b64.decode(s.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let pk = minisign_verify::PublicKey::decode(&text(pubkey)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&text(signature_b64)?).map_err(|e| e.to_string())?;
    pk.verify(data, &sig, true).map_err(|_| "the exchange engine's signature does not match Birdbrain's key".into())
}

fn allowed(method: &str, path: &str) -> bool {
    ALLOWED.iter().any(|(m, p)| *m == method && *p == path)
}

/// A random password, hex, from the OS's randomness (through ring, already in the
/// tree for TLS).
fn new_password() -> Result<String, String> {
    let mut buf = [0u8; 32];
    rustls::crypto::ring::default_provider()
        .secure_random
        .fill(&mut buf)
        .map_err(|_| "no randomness available on this computer".to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Write a file only this user can read, replacing it in one step.
fn write_private(path: &std::path::Path, body: &str) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(&tmp).map_err(|e| e.to_string())?;
    f.write_all(body.as_bytes()).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

impl Engine {
    pub fn start(data_dir: PathBuf, keyring_service: String) -> Arc<Engine> {
        Self::start_with(data_dir, keyring_service, PUBKEY.into(), MANIFEST.into())
    }

    fn start_with(data_dir: PathBuf, keyring_service: String, pubkey: String, manifest: String) -> Arc<Engine> {
        let dir = data_dir.join("exchange");
        let _ = std::fs::create_dir_all(&dir);
        let engine = Arc::new(Engine {
            dir,
            pubkey,
            manifest,
            keyring_service,
            status: Mutex::new(ExchangeStatus { phase: "off".into(), network: "testnet".into(), ..Default::default() }),
            running: Mutex::new(None),
            fetching: Mutex::new(false),
            crashes: Mutex::new(0),
        });
        let enabled = engine.settings().enabled;
        {
            let mut s = engine.status.lock().unwrap();
            s.enabled = enabled;
            s.version = engine.installed();
        }
        if enabled {
            engine.clone().fetch_in_background();
        }
        let sup = engine.clone();
        std::thread::Builder::new()
            .name("exchange".into())
            .spawn(move || loop {
                sup.tick();
                std::thread::sleep(Duration::from_secs(3));
            })
            .ok();
        engine
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
                let v = n.strip_prefix("bisonw-")?.trim_end_matches(".exe").to_string();
                let t = e.metadata().ok()?.modified().ok()?;
                (!v.ends_with(".part")).then_some((t, v))
            })
            .max()
            .map(|(_, v)| v)
    }

    pub fn status(&self) -> ExchangeStatus {
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

    fn password(&self) -> Result<String, String> {
        // A server has no desktop keyring to test against.
        #[cfg(test)]
        if let Ok(p) = std::env::var("EXCHANGE_TEST_PASSWORD") {
            return Ok(p);
        }
        // The password lives in a file beside the engine's own data, readable only
        // by this user. The app is ad-hoc signed, so to macOS every update is a new
        // app, and a Keychain item read at every launch raised the login-password
        // box after every update. Testnet only: move it back to the Keychain once
        // the app is signed with an Apple Developer ID.
        let file = self.dir.join("app-password");
        if let Ok(p) = std::fs::read_to_string(&file) {
            let p = p.trim().to_string();
            if !p.is_empty() {
                return Ok(p);
            }
        }
        // Builds up to 0.4.4 kept it in the Keychain: read it once (the box shows one
        // last time) so the existing wallet still opens, then never again.
        let p = match keyring::Entry::new(&self.keyring_service, PASSWORD_ENTRY).and_then(|e| e.get_password()) {
            Ok(p) => p,
            Err(keyring::Error::NoEntry) => new_password()?,
            Err(e) => return Err(format!("couldn't read the exchange password from this computer's secure store: {e}")),
        };
        write_private(&file, &p)?;
        Ok(p)
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
            .name("exchange-fetch".into())
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

    /// The same path as the node program: manifest, signature over the gzip, unpack,
    /// rename into place. A half-fetched or forged file never runs.
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
            .map_err(|e| format!("couldn't reach birdbrain.wtf for the exchange engine: {e}"))?;
        let entry = &manifest["platforms"][platform()];
        let version = entry["version"].as_str().ok_or_else(|| format!("no exchange engine for {} yet", platform()))?.to_string();
        if version.contains(['/', '\\']) || version.contains("..") {
            return Err("the exchange manifest names an odd version".into());
        }
        if self.installed().as_deref() == Some(version.as_str()) {
            return Ok(version);
        }
        let url = entry["url"].as_str().ok_or_else(|| format!("no exchange engine for {} yet", platform()))?;
        let signature = entry["signature"].as_str().ok_or("the exchange manifest carries no signature")?;
        let prefix = if self.manifest == MANIFEST { URL_PREFIX.to_string() } else { self.manifest.rsplit_once('/').map(|(p, _)| format!("{p}/")).unwrap_or_default() };
        if !url.starts_with(&prefix) {
            return Err("the exchange manifest points somewhere other than birdbrain.wtf".into());
        }

        let mut resp = client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("couldn't fetch the exchange engine: {e}"))?;
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
        verify(&self.pubkey, &gz, signature)?;

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
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("bisonw-") && n != exe_name(&version) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        Ok(version)
    }

    /// An engine left running by an earlier session of this app (killed, crashed or
    /// replaced by an update before it could stop it) still holds the data folder, and
    /// a new one then exits at once with "database is already being used". Stop it first.
    #[cfg(unix)]
    fn stop_leftover(&self) {
        let pid_file = self.dir.join("engine.pid");
        let Some(pid) = std::fs::read_to_string(&pid_file).ok().and_then(|s| s.trim().parse::<u32>().ok()) else { return };
        let _ = std::fs::remove_file(&pid_file);
        let alive = |pid: u32| {
            Command::new("ps").args(["-p", &pid.to_string(), "-o", "comm="]).output().ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).contains("bisonw"))
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
        let log = std::fs::File::create(self.dir.join("engine.log")).map_err(|e| e.to_string())?;
        let child = Command::new(self.dir.join(exe_name(version)))
            .arg(NETWORK_FLAG)
            .arg("--appdata").arg(self.dir.join("data"))
            // Its web API on the loopback only; this app is its only caller.
            .arg("--webaddr").arg(format!("127.0.0.1:{port}"))
            .arg("--log=info")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()
            .map_err(|e| format!("the exchange engine wouldn't start: {e}"))?;
        let _ = std::fs::write(self.dir.join("engine.pid"), child.id().to_string());
        Ok(Running { child, port, started: Instant::now(), cookies: None })
    }

    pub fn stop(&self) {
        let Some(mut r) = self.running.lock().unwrap().take() else { return };
        let _ = std::fs::remove_file(self.dir.join("engine.pid"));
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

    /// One call to the engine's web API on the loopback.
    fn local(port: u16, method: &str, path: &str, body: Option<&Value>, cookies: Option<&str>) -> Result<(Value, Vec<String>), String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .no_proxy()
            .build()
            .map_err(|e| e.to_string())?;
        let url = format!("http://127.0.0.1:{port}/api{path}");
        let mut req = match method {
            "GET" => client.get(&url),
            _ => client.post(&url).header("content-type", "application/json").body(body.map(|b| b.to_string()).unwrap_or_else(|| "{}".into())),
        };
        if let Some(c) = cookies {
            req = req.header("cookie", c);
        }
        let resp = req.send().map_err(|e| format!("the exchange engine didn't answer: {e}"))?;
        let set: Vec<String> = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|v| v.split(';').next().map(|s| s.to_string()))
            .collect();
        let text = resp.text().map_err(|e| e.to_string())?;
        let v: Value = serde_json::from_str(&text).unwrap_or(json!({ "ok": false, "msg": text.trim() }));
        Ok((v, set))
    }

    /// First run initialises the engine with the stored password, every run logs in.
    fn log_in(&self, port: u16) -> Result<String, String> {
        let pass = self.password()?;
        let (inited, _) = Self::local(port, "GET", "/isinitialized", None, None)?;
        if inited["initialized"] != true {
            let (r, _) = Self::local(port, "POST", "/init", Some(&json!({ "pass": pass })), None)?;
            if r["ok"] != true {
                return Err(format!("couldn't set up the exchange engine: {}", r["msg"]));
            }
        }
        let (r, set) = Self::local(port, "POST", "/login", Some(&json!({ "pass": pass })), None)?;
        if r["ok"] != true {
            return Err(format!("couldn't open the exchange engine: {}", r["msg"]));
        }
        Ok(set.join("; "))
    }

    /// Forward one allowed call. Any field named like a password is dropped: the
    /// engine uses the password cached against this session instead.
    pub fn api(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        if !allowed(method, path) {
            return Err(format!("the exchange plugin can't call {method} {path}"));
        }
        let body = body.map(|mut b| {
            if let Some(o) = b.as_object_mut() {
                for k in ["pass", "pw", "appPW", "appPass", "password"] {
                    o.remove(k);
                }
            }
            b
        });
        let (port, cookies) = {
            let g = self.running.lock().unwrap();
            let r = g.as_ref().ok_or("the exchange engine isn't running")?;
            (r.port, r.cookies.clone().ok_or("the exchange engine is still starting")?)
        };
        let (v, _) = Self::local(port, method, path, body.as_ref(), Some(&cookies))?;
        Ok(v)
    }

    /// The order book for one market. The engine's web API has no call for it: its
    /// own page subscribes over a websocket, so this does the same on the loopback,
    /// takes the first full book and hangs up.
    pub fn book(&self, host: &str, base: u32, quote: u32, n: usize) -> Result<Value, String> {
        let (port, cookies) = {
            let g = self.running.lock().unwrap();
            let r = g.as_ref().ok_or("the exchange engine isn't running")?;
            (r.port, r.cookies.clone().ok_or("the exchange engine is still starting")?)
        };
        let load = json!({"type": 1, "route": "loadmarket", "id": 1, "payload": {"host": host, "base": base, "quote": quote}});
        let mut book = ws::first(port, &cookies, &load.to_string(), Duration::from_secs(20), |m| {
            if m["route"] == "book" {
                Some(Ok(m["payload"]["payload"]["book"].clone()))
            } else if m["type"] == 2 && !m["payload"]["error"].is_null() {
                Some(Err(m["payload"]["error"]["message"].as_str().unwrap_or("the order book isn't available").to_string()))
            } else {
                None
            }
        })?;
        for side in ["sells", "buys"] {
            if let Some(a) = book[side].as_array_mut() {
                a.truncate(n);
            }
        }
        Ok(book)
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
            // The engine logs to stdout, which is discarded, and prints a fatal start-up
            // error to stderr (engine.log) as a bare line with no level tag.
            let log = std::fs::read_to_string(self.dir.join("engine.log")).unwrap_or_default();
            let tail = log
                .lines()
                .rev()
                .find(|l| l.contains("[ERR]") || l.contains("[CRT]"))
                .or_else(|| log.lines().rev().find(|l| !l.trim().is_empty()))
                .map(|l| l.trim().to_string());
            self.status.lock().unwrap().error =
                Some(format!("the exchange engine stopped ({code}){}", tail.map(|t| format!(": {t}")).unwrap_or_default()));
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

        // Log in once the engine's web API answers.
        let pending = self.running.lock().unwrap().as_ref().filter(|r| r.cookies.is_none()).map(|r| (r.port, r.started));
        if let Some((port, started)) = pending {
            match self.log_in(port) {
                Ok(c) => {
                    if let Some(r) = self.running.lock().unwrap().as_mut() {
                        r.cookies = Some(c);
                    }
                    *self.crashes.lock().unwrap() = 0;
                    self.status.lock().unwrap().error = None;
                }
                Err(e) if started.elapsed() > Duration::from_secs(60) => self.status.lock().unwrap().error = Some(e),
                Err(_) => {}
            }
        }

        let ready = self.running.lock().unwrap().as_ref().map(|r| r.cookies.is_some());
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

/// Just enough of a websocket client for the loopback: one handshake, one masked
/// text frame out, unmasked frames in until `pick` returns something.
mod ws {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::{Duration, Instant};

    use serde_json::Value;

    fn read_exact(s: &mut TcpStream, n: usize) -> Result<Vec<u8>, String> {
        let mut b = vec![0u8; n];
        s.read_exact(&mut b).map_err(|e| e.to_string())?;
        Ok(b)
    }

    pub fn first<T>(port: u16, cookies: &str, send: &str, wait: Duration, pick: impl Fn(&Value) -> Option<Result<T, String>>) -> Result<T, String> {
        use base64::Engine;
        let mut s = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(3)).map_err(|e| e.to_string())?;
        s.set_read_timeout(Some(wait)).map_err(|e| e.to_string())?;
        let mut key = [0u8; 16];
        rustls::crypto::ring::default_provider().secure_random.fill(&mut key).map_err(|_| "no randomness".to_string())?;
        let key = base64::engine::general_purpose::STANDARD.encode(key);
        write!(
            s,
            "GET /ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nCookie: {cookies}\r\n\r\n"
        )
        .map_err(|e| e.to_string())?;
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.extend(read_exact(&mut s, 1)?);
            if head.len() > 8192 {
                return Err("the exchange engine's websocket answered oddly".into());
            }
        }
        if !head.starts_with(b"HTTP/1.1 101") {
            return Err(format!("the exchange engine refused the websocket: {}", String::from_utf8_lossy(&head).lines().next().unwrap_or("")));
        }

        // A client's frames are masked; the mask can be any four bytes.
        let data = send.as_bytes();
        let mask = [0x5au8, 0x13, 0xc7, 0x2e];
        let mut frame = vec![0x81u8];
        match data.len() {
            n if n < 126 => frame.push(0x80 | n as u8),
            n if n < 65536 => {
                frame.push(0x80 | 126);
                frame.extend((n as u16).to_be_bytes());
            }
            n => {
                frame.push(0x80 | 127);
                frame.extend((n as u64).to_be_bytes());
            }
        }
        frame.extend(mask);
        frame.extend(data.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        s.write_all(&frame).map_err(|e| e.to_string())?;

        let deadline = Instant::now() + wait;
        let mut message = Vec::new();
        while Instant::now() < deadline {
            let h = read_exact(&mut s, 2)?;
            let (fin, opcode) = (h[0] & 0x80 != 0, h[0] & 0x0f);
            let len = match h[1] & 0x7f {
                126 => u16::from_be_bytes(read_exact(&mut s, 2)?.try_into().unwrap()) as usize,
                127 => u64::from_be_bytes(read_exact(&mut s, 8)?.try_into().unwrap()) as usize,
                n => n as usize,
            };
            if len > 64 * 1024 * 1024 {
                return Err("the exchange engine sent an oversized message".into());
            }
            let payload = read_exact(&mut s, len)?;
            match opcode {
                0x8 => return Err("the exchange engine closed the websocket".into()),
                0x9 | 0xa => continue,
                _ => message.extend(payload),
            }
            if !fin {
                continue;
            }
            let text = std::mem::take(&mut message);
            if let Ok(v) = serde_json::from_slice::<Value>(&text) {
                if let Some(r) = pick(&v) {
                    return r;
                }
            }
        }
        Err("the exchange engine didn't send the order book in time".into())
    }
}

#[tauri::command]
pub fn exchange_status(state: tauri::State<'_, ExchangeState>) -> ExchangeStatus {
    match state.0.lock().unwrap().as_ref() {
        Some(e) => e.status(),
        None => ExchangeStatus { phase: "off".into(), network: "testnet".into(), ..Default::default() },
    }
}

#[tauri::command]
pub fn exchange_set_enabled(state: tauri::State<'_, ExchangeState>, enabled: bool) -> Result<ExchangeStatus, String> {
    let e = state.0.lock().unwrap().clone().ok_or("the exchange isn't ready yet")?;
    e.set_enabled(enabled)?;
    Ok(e.status())
}

/// One call from the plugin to the engine, on a worker thread: the loopback HTTP
/// client blocks, and a slow trade must not hold the window.
#[tauri::command(async)]
pub fn exchange_api(state: tauri::State<'_, ExchangeState>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let e = state.0.lock().unwrap().clone().ok_or("the exchange isn't ready yet")?;
    std::thread::spawn(move || e.api(&method, &path, body)).join().map_err(|_| "the exchange call failed".to_string())?
}

#[tauri::command(async)]
pub fn exchange_book(state: tauri::State<'_, ExchangeState>, host: String, base: u32, quote: u32) -> Result<Value, String> {
    let e = state.0.lock().unwrap().clone().ok_or("the exchange isn't ready yet")?;
    std::thread::spawn(move || e.book(&host, base, quote, 12)).join().map_err(|_| "the order book call failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_routes_pass() {
        assert!(allowed("POST", "/trade"));
        assert!(allowed("GET", "/user"));
        assert!(!allowed("POST", "/exportseed"));
        assert!(!allowed("POST", "/changeapppass"));
        assert!(!allowed("POST", "/bridge"));
        assert!(!allowed("GET", "/trade"));
    }

    #[test]
    fn refuses_an_engine_birdbrain_did_not_sign() {
        let sig = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRM2wyb0czaVVpZS9hMTdqeTBackpqL0J2dm03MkFBMlRGYTd4SE92RWhyMUdOTDQ5RVgwWFZKSlRHdTBSR1ZZSytpeko5YTJiak9BMmxDZ2tNRE1EZU5XeVhIUW81ZlFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxMzE2NzcyCWZpbGU6c2VlZHMtbm9kZS0wLjAuMC0xOWJlNmQwMzQ3MS1saW51eC14ODZfNjQuZ3oKci9taWI3OXJOY1U0Z3RVT2VaTzlGK3hpVWlESW9QRVY1SFIyRUVlVWhJa202V3pNT25ZR1FyNThWcEpxdVJON1djays5a1dKeWpMT3R5L2JtRlR6QXc9PQo=";
        assert!(verify(PUBKEY, b"not the engine", sig).is_err());
    }

    // Against a real engine: serves a manifest signed with a throwaway key from a
    // local folder, fetches, checks, runs, initialises, logs in, opens a KSM wallet
    // on Polkadot Hub TestNet and reads it back through the allowlist.
    //   EXCHANGE_TEST_PUBKEY=<b64 minisign public key> EXCHANGE_TEST_PASSWORD=<any> \
    //   EXCHANGE_TEST_MANIFEST=http://127.0.0.1:<port>/latest.json \
    //   cargo test --lib exchange -- --ignored --nocapture
    #[test]
    #[ignore]
    fn runs_the_engine_and_opens_a_wallet() {
        let pubkey = std::env::var("EXCHANGE_TEST_PUBKEY").expect("EXCHANGE_TEST_PUBKEY");
        let manifest = std::env::var("EXCHANGE_TEST_MANIFEST").expect("EXCHANGE_TEST_MANIFEST");
        let dir = std::env::temp_dir().join(format!("murmur-exchange-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let engine = Engine::start_with(dir.clone(), format!("murmur-exchange-test-{}", std::process::id()), pubkey, manifest);
        struct Guard(Arc<Engine>, PathBuf);
        impl Drop for Guard {
            fn drop(&mut self) {
                self.0.stop();
                if let Ok(e) = keyring::Entry::new(&self.0.keyring_service, PASSWORD_ENTRY) {
                    let _ = e.delete_credential();
                }
                let _ = std::fs::remove_dir_all(&self.1);
            }
        }
        let _g = Guard(engine.clone(), dir.clone());
        engine.set_enabled(true).unwrap();
        let t0 = Instant::now();
        let mut last = String::new();
        loop {
            let s = engine.status();
            let line = format!("{} v={:?} err={:?}", s.phase, s.version, s.error);
            if line != last {
                println!("{:>5.1}s {line}", t0.elapsed().as_secs_f32());
                last = line;
            }
            if s.phase == "ready" {
                break;
            }
            assert!(s.phase != "error", "engine error: {:?}", s.error);
            assert!(t0.elapsed() < Duration::from_secs(180), "not ready in 3 minutes");
            std::thread::sleep(Duration::from_millis(500));
        }
        // The page can't reach routes off the list, even with the session.
        assert!(engine.api("POST", "/exportseed", None).is_err());
        let r = engine.api("POST", "/newwallet", Some(json!({"assetID": 434, "config": {}, "walletType": "rpc", "pass": "ignored"}))).unwrap();
        println!("newwallet {r}");
        assert_eq!(r["ok"], true, "{r}");
        let u = engine.api("GET", "/user", None).unwrap();
        let w = &u["user"]["assets"]["434"]["wallet"];
        println!("ksm wallet {} synced={} height={}", w["address"], w["synced"], w["syncStatus"]["blocks"]);
        assert!(w["address"].as_str().unwrap_or("").starts_with("0x"));
        // The websocket answers. No market joined, so the engine refuses by name.
        let b = engine.book("127.0.0.1:1", 434, 434001, 5);
        println!("book {b:?}");
        assert!(matches!(&b, Err(e) if e.contains("order feed") || e.contains("not connected") || e.contains("unknown")), "{b:?}");
        // With a market to join (lab/exchange/AGENTS.md): join it with an invite code,
        // as a member would, and read its book.
        // EXCHANGE_TEST_DEX_CERT is a path, or unset for a publicly trusted
        // certificate (dex.birdbrain.wtf:7232).
        if let (Ok(host), Ok(code)) = (std::env::var("EXCHANGE_TEST_DEX_HOST"), std::env::var("EXCHANGE_TEST_DEX_CODE")) {
            let cert = match std::env::var("EXCHANGE_TEST_DEX_CERT") {
                Ok(p) if !p.is_empty() => std::fs::read_to_string(p).unwrap(),
                _ => String::new(),
            };
            let r = engine.api("POST", "/redeemprepaidbond", Some(json!({"host": host, "code": code, "cert": cert}))).unwrap();
            println!("joined {host}: {r}");
            assert_eq!(r["ok"], true, "{r}");
            let b = engine.book(&host, 434, 434001, 5).unwrap();
            println!("book sells={} buys={}", b["sells"], b["buys"]);
            assert!(b["sells"].as_array().map(|a| !a.is_empty()).unwrap_or(false), "expected a resting sell");
        }
        engine.set_enabled(false).unwrap();
        assert!(engine.running.lock().unwrap().is_none());
    }
}
