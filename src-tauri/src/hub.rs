// Asset Hub and Kreivo, checked on this device.
//
// A second smoldot client beside the Birdbrain one (chain.rs): a relay chain and the
// parachains on it, so a quote, a swap or a membership count is read from proofs this
// computer checked, never from a server's word. Three names:
//   `kusama`  Kusama's Asset Hub (real KSM, Swap)
//   `kreivo`  Kreivo, where each collective's membership and votes live
//   `paseo`   Paseo's Asset Hub (test money)
// `kusama` and `kreivo` share one Kusama relay client, so following both costs one
// relay sync, not two. Each starts the first time a page asks for it and runs until
// the app quits.
//
// Unlike chain.rs this is a pipe, not a set of one-shot calls: the page runs a full
// JSON-RPC client (polkadot-api, src/lib/hub.ts), which needs subscriptions to follow
// blocks and watch a transaction. `hub_send` passes a message in; every answer comes
// back as a `hub` event carrying the name and the raw message.
//
// Specs are bundled. The relay and Asset Hub ones come from lab/swap/fetch-specs.ts;
// the relay spec's checkpoint lets a cold start warp sync, and the relay database is
// kept every 5 minutes so a warm start skips even that. chains/kreivo.json is a light
// spec made from Virto's published chain spec: genesis state root read from block 0,
// and public Kreivo nodes as bootnodes (Virto's own spec lists only 127.0.0.1).

use std::{
    collections::HashMap,
    num::NonZero,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::Serialize;
use serde_json::{json, Value};
use smoldot_light::{ChainId, Client};

use crate::netguard::Guarded;
use tauri::Emitter;

/// The relay a name rides on, and its parachain's spec.
fn para_spec(net: &str) -> Option<(&'static str, &'static str)> {
    match net {
        "kusama" => Some(("kusama", include_str!("../chains/ksmcc3_asset_hub.json"))),
        "kreivo" => Some(("kusama", include_str!("../chains/kreivo.json"))),
        "paseo" => Some(("paseo", include_str!("../chains/paseo_asset_hub.json"))),
        _ => None,
    }
}

fn relay_spec(relay: &str) -> Option<&'static str> {
    match relay {
        "kusama" => Some(include_str!("../chains/ksmcc3.json")),
        "paseo" => Some(include_str!("../chains/paseo.json")),
        _ => None,
    }
}

#[derive(Clone, Serialize)]
struct Message {
    net: String,
    msg: String,
}

/// One relay chain in its own smoldot client. Parachains are added to the same client.
pub struct Relay {
    client: Mutex<Client<Guarded, ()>>,
    id: ChainId,
}

impl Relay {
    pub fn start(name: &str, data_dir: Option<PathBuf>) -> Result<Arc<Relay>, String> {
        let spec = relay_spec(name).ok_or_else(|| format!("no relay chain called {name}"))?;
        let db_path = data_dir.map(|d| d.join(format!("hub-{name}-db.json")));
        let db = db_path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();

        let mut client = Client::new(Guarded::new(
            env!("CARGO_PKG_NAME").into(),
            env!("CARGO_PKG_VERSION").into(),
        ));
        // The relay answers only our own database request, so its server is kept small.
        let relay = client
            .add_chain(smoldot_light::AddChainConfig {
                specification: spec,
                json_rpc: smoldot_light::AddChainConfigJsonRpc::Enabled {
                    max_pending_requests: NonZero::<u32>::new(4).unwrap(),
                    max_subscriptions: 0,
                },
                potential_relay_chains: std::iter::empty(),
                database_content: &db,
                user_data: (),
                statement_protocol_config: None,
            })
            .map_err(|e| e.to_string())?;
        let id = relay.chain_id;
        let mut relay_responses = relay.json_rpc_responses.ok_or("no relay JSON-RPC channel")?;
        let r = Arc::new(Relay { client: Mutex::new(client), id });

        // Keep the relay's database so the next start skips the warp sync.
        let keeper = r.clone();
        std::thread::Builder::new()
            .name(format!("relay-{name}-db"))
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(300));
                let req = json!({"id":"db","jsonrpc":"2.0","method":"chainHead_unstable_finalizedDatabase","params":[1048576]});
                if keeper.client.lock().unwrap().json_rpc_request(req.to_string(), id).is_err() {
                    continue;
                }
                let answer = smol::block_on(smol::future::or(
                    async { relay_responses.next().await },
                    async {
                        smol::Timer::after(Duration::from_secs(30)).await;
                        None
                    },
                ));
                let db = answer.and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
                if let (Some(db), Some(p)) = (db.as_ref().and_then(|v| v["result"].as_str()), db_path.as_ref()) {
                    let _ = std::fs::write(p, db);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(r)
    }
}

pub struct Hub {
    relay: Arc<Relay>,
    para: ChainId,
}

impl Hub {
    /// A parachain on its own fresh relay client (the tests and the bridge use this).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn start(
        net: &str,
        data_dir: Option<PathBuf>,
        emit: impl Fn(String) + Send + 'static,
    ) -> Result<Arc<Hub>, String> {
        let (relay, _) = para_spec(net).ok_or_else(|| format!("no network called {net}"))?;
        Hub::start_on(Relay::start(relay, data_dir)?, net, emit)
    }

    /// Add a parachain to a running relay client. `emit` receives every message the
    /// parachain's JSON-RPC server sends back.
    pub fn start_on(relay: Arc<Relay>, net: &str, emit: impl Fn(String) + Send + 'static) -> Result<Arc<Hub>, String> {
        let (_, spec) = para_spec(net).ok_or_else(|| format!("no network called {net}"))?;
        let para = relay
            .client
            .lock()
            .unwrap()
            .add_chain(smoldot_light::AddChainConfig {
                specification: spec,
                json_rpc: smoldot_light::AddChainConfigJsonRpc::Enabled {
                    max_pending_requests: NonZero::<u32>::new(256).unwrap(),
                    max_subscriptions: 64,
                },
                potential_relay_chains: [relay.id].into_iter(),
                database_content: "",
                user_data: (),
                statement_protocol_config: None,
            })
            .map_err(|e| e.to_string())?;
        let mut responses = para.json_rpc_responses.ok_or("no JSON-RPC channel")?;
        let hub = Arc::new(Hub { relay, para: para.chain_id });

        std::thread::Builder::new()
            .name(format!("hub-{net}"))
            .spawn(move || {
                smol::block_on(async move {
                    while let Some(raw) = responses.next().await {
                        emit(raw);
                    }
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(hub)
    }

    pub fn send(&self, msg: &str) -> Result<(), String> {
        self.relay
            .client
            .lock()
            .unwrap()
            .json_rpc_request(msg.to_string(), self.para)
            .map_err(|e| format!("{e:?}"))
    }
}

#[derive(Default)]
pub struct HubState {
    relays: Mutex<HashMap<String, Arc<Relay>>>,
    hubs: Mutex<HashMap<String, Arc<Hub>>>,
}

fn hub_for(app: &tauri::AppHandle, state: &HubState, net: &str) -> Result<Arc<Hub>, String> {
    use tauri::Manager;
    let mut hubs = state.hubs.lock().unwrap();
    if let Some(h) = hubs.get(net) {
        return Ok(h.clone());
    }
    let (relay_name, _) = para_spec(net).ok_or_else(|| format!("no network called {net}"))?;
    let relay = {
        let mut relays = state.relays.lock().unwrap();
        match relays.get(relay_name) {
            Some(r) => r.clone(),
            None => {
                let r = Relay::start(relay_name, app.path().app_data_dir().ok())?;
                relays.insert(relay_name.to_string(), r.clone());
                r
            }
        }
    };
    let handle = app.clone();
    let name = net.to_string();
    let h = Hub::start_on(relay, net, move |msg| {
        let _ = handle.emit("hub", Message { net: name.clone(), msg });
    })?;
    hubs.insert(net.to_string(), h.clone());
    Ok(h)
}

/// Start following a network, if it is not already followed.
#[tauri::command]
pub fn hub_start(app: tauri::AppHandle, state: tauri::State<'_, HubState>, net: String) -> Result<(), String> {
    hub_for(&app, &state, &net).map(|_| ())
}

/// One JSON-RPC message to the network's parachain. Answers arrive as `hub` events.
#[tauri::command]
pub fn hub_send(
    app: tauri::AppHandle,
    state: tauri::State<'_, HubState>,
    net: String,
    msg: String,
) -> Result<(), String> {
    hub_for(&app, &state, &net)?.send(&msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reaches the live networks over the internet, so it is ignored by default:
    // cargo test --lib hub -- --ignored --nocapture
    struct Stderr;
    impl log::Log for Stderr {
        fn enabled(&self, m: &log::Metadata) -> bool {
            m.level() <= log::Level::Info
        }
        fn log(&self, r: &log::Record) {
            if self.enabled(r.metadata()) {
                eprintln!("[{}] {}", r.target(), r.args());
            }
        }
        fn flush(&self) {}
    }

    fn follows(net: &str) {
        if std::env::var("HUB_LOG").is_ok() {
            let _ = log::set_logger(&Stderr).map(|()| log::set_max_level(log::LevelFilter::Info));
        }
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let t0 = std::time::Instant::now();
        let hub = Hub::start(net, None, move |m| {
            let _ = tx.send(m);
        })
        .unwrap();
        hub.send(r#"{"id":1,"jsonrpc":"2.0","method":"chainSpec_v1_genesisHash","params":[]}"#).unwrap();
        hub.send(r#"{"id":2,"jsonrpc":"2.0","method":"chainHead_v1_follow","params":[true]}"#).unwrap();
        let mut runtime = false;
        while !runtime {
            let m = rx.recv_timeout(Duration::from_secs(180)).expect("no answer from the light client");
            let v: Value = serde_json::from_str(&m).unwrap();
            if v["id"] == 1 {
                println!("{net} genesis {}", v["result"]);
            }
            if v["params"]["result"]["event"] == "initialized" {
                let spec = &v["params"]["result"]["finalizedBlockRuntime"]["spec"];
                println!("{net} first finalised block after {:.1}s, runtime {} {}", t0.elapsed().as_secs_f32(), spec["specName"], spec["specVersion"]);
                runtime = true;
            }
            if v["params"]["result"]["event"] == "stop" {
                panic!("follow stopped: {m}");
            }
        }
    }

    #[test]
    #[ignore]
    fn follows_paseo_asset_hub() {
        follows("paseo");
    }

    #[test]
    #[ignore]
    fn follows_kusama_asset_hub() {
        follows("kusama");
    }

    #[test]
    #[ignore]
    fn follows_kreivo() {
        follows("kreivo");
    }

    // Both Kusama parachains on one relay client, as the app runs them.
    #[test]
    #[ignore]
    fn kreivo_and_asset_hub_share_a_relay() {
        let relay = Relay::start("kusama", None).unwrap();
        for net in ["kreivo", "kusama"] {
            let (tx, rx) = std::sync::mpsc::channel::<String>();
            let hub = Hub::start_on(relay.clone(), net, move |m| {
                let _ = tx.send(m);
            })
            .unwrap();
            hub.send(r#"{"id":2,"jsonrpc":"2.0","method":"chainHead_v1_follow","params":[true]}"#).unwrap();
            loop {
                let m = rx.recv_timeout(Duration::from_secs(180)).expect("no answer from the light client");
                let v: Value = serde_json::from_str(&m).unwrap();
                if v["params"]["result"]["event"] == "initialized" {
                    println!("{net} on the shared relay: {}", v["params"]["result"]["finalizedBlockRuntime"]["spec"]["specName"]);
                    break;
                }
            }
        }
    }

    // The same light client on a local socket, one JSON message per line, so the
    // app's swap code can be run against it from a script (lab/swap/e2e-light.ts):
    // HUB_NET=paseo HUB_PORT=9955 cargo test --lib hub::tests::bridge -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bridge() {
        use std::io::{BufRead, BufReader, Write};
        let net = std::env::var("HUB_NET").unwrap_or_else(|_| "paseo".into());
        let port = std::env::var("HUB_PORT").unwrap_or_else(|_| "9955".into());
        let listener = std::net::TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
        println!("bridge for {net} on 127.0.0.1:{port}");
        let (stream, _) = listener.accept().unwrap();
        let out = stream.try_clone().unwrap();
        let hub = Hub::start(&net, None, move |m| {
            let mut out = &out;
            let _ = out.write_all(m.replace('\n', " ").as_bytes());
            let _ = out.write_all(b"\n");
        })
        .unwrap();
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            if !line.trim().is_empty() {
                hub.send(&line).unwrap();
            }
        }
    }
}
