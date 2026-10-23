// Asset Hub, checked on this device, for Swap.
//
// A second smoldot client beside the Birdbrain one (chain.rs): the relay chain and its
// Asset Hub, so a quote and a swap are read from proofs this computer checked, never
// from a server's word. Two networks: `kusama` (real KSM) and `paseo` (test money).
// Each starts the first time the page asks for it and runs until the app quits.
//
// Unlike chain.rs this is a pipe, not a set of one-shot calls: the page runs a full
// JSON-RPC client (polkadot-api, src/lib/hub.ts), which needs subscriptions to follow
// blocks and watch a transaction. `hub_send` passes a message in; every answer comes
// back as a `hub` event carrying the network and the raw message.
//
// Specs are bundled (chains/ksmcc3*.json, chains/paseo*.json, refreshed by
// lab/swap/fetch-specs.ts). The relay spec's checkpoint lets a cold start warp sync,
// and the relay database is kept every 5 minutes so a warm start skips even that.

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

struct Spec {
    relay: &'static str,
    para: &'static str,
}

fn spec(net: &str) -> Option<Spec> {
    match net {
        "kusama" => Some(Spec {
            relay: include_str!("../chains/ksmcc3.json"),
            para: include_str!("../chains/ksmcc3_asset_hub.json"),
        }),
        "paseo" => Some(Spec {
            relay: include_str!("../chains/paseo.json"),
            para: include_str!("../chains/paseo_asset_hub.json"),
        }),
        _ => None,
    }
}

#[derive(Clone, Serialize)]
struct Message {
    net: String,
    msg: String,
}

pub struct Hub {
    client: Mutex<Client<Guarded, ()>>,
    para: ChainId,
}

impl Hub {
    /// Start the relay chain and its Asset Hub. `emit` receives every message the Asset
    /// Hub's JSON-RPC server sends back.
    pub fn start(
        net: &str,
        data_dir: Option<PathBuf>,
        emit: impl Fn(String) + Send + 'static,
    ) -> Result<Arc<Hub>, String> {
        let s = spec(net).ok_or_else(|| format!("no network called {net}"))?;
        let db_path = data_dir.map(|d| d.join(format!("hub-{net}-db.json")));
        let db = db_path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();

        let mut client = Client::new(Guarded::new(
            env!("CARGO_PKG_NAME").into(),
            env!("CARGO_PKG_VERSION").into(),
        ));
        // The relay answers only our own database request, so its server is kept small.
        let relay = client
            .add_chain(smoldot_light::AddChainConfig {
                specification: s.relay,
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
        let relay_id = relay.chain_id;
        let mut relay_responses = relay.json_rpc_responses.ok_or("no relay JSON-RPC channel")?;

        let para = client
            .add_chain(smoldot_light::AddChainConfig {
                specification: s.para,
                json_rpc: smoldot_light::AddChainConfigJsonRpc::Enabled {
                    max_pending_requests: NonZero::<u32>::new(256).unwrap(),
                    max_subscriptions: 64,
                },
                potential_relay_chains: [relay_id].into_iter(),
                database_content: "",
                user_data: (),
                statement_protocol_config: None,
            })
            .map_err(|e| e.to_string())?;
        let mut responses = para.json_rpc_responses.ok_or("no JSON-RPC channel")?;

        let hub = Arc::new(Hub { client: Mutex::new(client), para: para.chain_id });

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

        // Keep the relay's database so the next start skips the warp sync.
        let keeper = hub.clone();
        std::thread::Builder::new()
            .name(format!("hub-{net}-db"))
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(300));
                let req = json!({"id":"db","jsonrpc":"2.0","method":"chainHead_unstable_finalizedDatabase","params":[1048576]});
                if keeper.client.lock().unwrap().json_rpc_request(req.to_string(), relay_id).is_err() {
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

        Ok(hub)
    }

    pub fn send(&self, msg: &str) -> Result<(), String> {
        self.client
            .lock()
            .unwrap()
            .json_rpc_request(msg.to_string(), self.para)
            .map_err(|e| format!("{e:?}"))
    }
}

#[derive(Default)]
pub struct HubState(pub Mutex<HashMap<String, Arc<Hub>>>);

fn hub_for(app: &tauri::AppHandle, state: &HubState, net: &str) -> Result<Arc<Hub>, String> {
    use tauri::Manager;
    let mut hubs = state.0.lock().unwrap();
    if let Some(h) = hubs.get(net) {
        return Ok(h.clone());
    }
    let dir = app.path().app_data_dir().ok();
    let handle = app.clone();
    let name = net.to_string();
    let h = Hub::start(net, dir, move |msg| {
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

/// One JSON-RPC message to the network's Asset Hub. Answers arrive as `hub` events.
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
