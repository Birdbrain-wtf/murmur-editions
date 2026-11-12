// The chain, checked on this device (ADR 0068).
//
// Every install runs smoldot, a light client, in this back end. It follows the chain's
// GRANDPA finality proofs itself, so the app stops trusting any one server about what
// the chain says. The public RPC server stays a fallback, never the authority.
//
// The chain spec is bundled (chains/birdbrain.json, the live chain with its bootnode).
// When the BBT chain is folded into Seeds, that file is swapped; nothing here changes.
//
// The client runs on its own thread. The webview asks for `chain_status` (a snapshot kept
// current by two internal subscriptions and a health poll) or sends one-shot JSON-RPC
// calls through `chain_rpc`. Subscriptions from the webview are not offered yet.

use std::{
    collections::HashMap,
    num::NonZero,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};
use smoldot_light::{ChainId, Client};

use crate::netguard::Guarded;

pub(crate) const SPEC: &str = include_str!("../chains/birdbrain.json");
const DB_FILE: &str = "chain-db.json";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub chain: String,
    pub genesis: Option<String>,
    pub best: Option<u64>,
    pub finalized: Option<u64>,
    pub finalized_hash: Option<String>,
    /// unix ms when the last finalised block arrived
    pub finalized_at: Option<u64>,
    pub peers: Option<u64>,
    pub syncing: Option<bool>,
    pub spec_name: Option<String>,
    pub spec_version: Option<u64>,
    pub started_at: u64,
    pub error: Option<String>,
}

type Reply = smol::channel::Sender<Value>;

pub struct Chain {
    client: Mutex<Client<Guarded, ()>>,
    id: ChainId,
    status: Mutex<Status>,
    pending: Mutex<HashMap<u64, Reply>>,
    next: Mutex<u64>,
    db_path: Option<PathBuf>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn hex_u64(v: &Value) -> Option<u64> {
    u64::from_str_radix(v.as_str()?.trim_start_matches("0x"), 16).ok()
}

impl Chain {
    pub fn start(data_dir: Option<PathBuf>) -> Result<Arc<Chain>, String> {
        let db_path = data_dir.map(|d| d.join(DB_FILE));
        let db = db_path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();

        let mut client = Client::new(Guarded::new(
            env!("CARGO_PKG_NAME").into(),
            env!("CARGO_PKG_VERSION").into(),
        ));
        let added = client
            .add_chain(smoldot_light::AddChainConfig {
                specification: SPEC,
                json_rpc: smoldot_light::AddChainConfigJsonRpc::Enabled {
                    max_pending_requests: NonZero::<u32>::new(256).unwrap(),
                    max_subscriptions: 16,
                },
                potential_relay_chains: std::iter::empty(),
                // A database from an earlier run lets a cold start skip the warp sync.
                // An invalid one is ignored, so a stale file costs nothing.
                database_content: &db,
                user_data: (),
                statement_protocol_config: None,
            })
            .map_err(|e| e.to_string())?;
        let mut responses = added.json_rpc_responses.ok_or("no JSON-RPC channel")?;

        let chain_name = serde_json::from_str::<Value>(SPEC)
            .ok()
            .and_then(|v| v["name"].as_str().map(String::from))
            .unwrap_or_default();
        let chain = Arc::new(Chain {
            client: Mutex::new(client),
            id: added.chain_id,
            status: Mutex::new(Status {
                running: true,
                chain: chain_name,
                started_at: now_ms(),
                ..Default::default()
            }),
            pending: Mutex::new(HashMap::new()),
            next: Mutex::new(1),
            db_path: db_path.clone(),
        });

        // Internal requests use string ids so they never collide with the webview's numbers.
        chain.send_raw(json!({"id":"genesis","jsonrpc":"2.0","method":"chain_getBlockHash","params":[0]}));
        chain.send_raw(json!({"id":"sub-final","jsonrpc":"2.0","method":"chain_subscribeFinalizedHeads","params":[]}));
        chain.send_raw(json!({"id":"sub-new","jsonrpc":"2.0","method":"chain_subscribeNewHeads","params":[]}));

        let reader = chain.clone();
        std::thread::Builder::new()
            .name("light-client".into())
            .spawn(move || {
                smol::block_on(async move {
                    let mut subs: HashMap<String, &'static str> = HashMap::new();
                    while let Some(raw) = responses.next().await {
                        let Ok(v) = serde_json::from_str::<Value>(&raw) else { continue };
                        reader.handle(&v, &mut subs);
                    }
                    reader.status.lock().unwrap().running = false;
                })
            })
            .map_err(|e| e.to_string())?;

        // Health every 10 s, the runtime version every minute (it can change under us
        // through a forkless upgrade), and the database every 5 minutes.
        let ticker = chain.clone();
        std::thread::Builder::new()
            .name("light-client-tick".into())
            .spawn(move || {
                let mut n: u64 = 0;
                loop {
                    ticker.send_raw(json!({"id":"health","jsonrpc":"2.0","method":"system_health","params":[]}));
                    if n % 6 == 0 && ticker.status.lock().unwrap().finalized.is_some() {
                        ticker.send_raw(json!({"id":"version","jsonrpc":"2.0","method":"state_getRuntimeVersion","params":[]}));
                    }
                    if n % 30 == 29 && db_path.is_some() {
                        ticker.send_raw(json!({"id":"db","jsonrpc":"2.0","method":"chainHead_unstable_finalizedDatabase","params":[1048576]}));
                    }
                    n += 1;
                    std::thread::sleep(Duration::from_secs(10));
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(chain)
    }

    fn send_raw(&self, req: Value) {
        if let Err(e) = self.client.lock().unwrap().json_rpc_request(req.to_string(), self.id) {
            self.status.lock().unwrap().error = Some(format!("{e:?}"));
        }
    }

    fn handle(&self, v: &Value, subs: &mut HashMap<String, &'static str>) {
        // Notifications carry a subscription id, not a request id.
        if let Some(sub) = v["params"]["subscription"].as_str() {
            let head = &v["params"]["result"];
            let mut s = self.status.lock().unwrap();
            match subs.get(sub).copied() {
                Some("final") => {
                    s.finalized = hex_u64(&head["number"]);
                    s.finalized_at = Some(now_ms());
                    s.error = None;
                    // The hash is not in the header; ask for it so the UI can show what it checked.
                    drop(s);
                    self.send_raw(json!({"id":"final-hash","jsonrpc":"2.0","method":"chain_getFinalizedHead","params":[]}));
                }
                Some("new") => s.best = hex_u64(&head["number"]),
                _ => {}
            }
            return;
        }
        match &v["id"] {
            Value::String(id) => {
                let mut s = self.status.lock().unwrap();
                let r = &v["result"];
                match id.as_str() {
                    "genesis" => s.genesis = r.as_str().map(String::from),
                    "final-hash" => s.finalized_hash = r.as_str().map(String::from),
                    "health" => {
                        s.peers = r["peers"].as_u64();
                        s.syncing = r["isSyncing"].as_bool();
                    }
                    "version" => {
                        s.spec_name = r["specName"].as_str().map(String::from);
                        s.spec_version = r["specVersion"].as_u64();
                    }
                    "sub-final" | "sub-new" => {
                        if let Some(sid) = r.as_str() {
                            subs.insert(sid.to_string(), if id == "sub-final" { "final" } else { "new" });
                        }
                    }
                    "db" => {
                        if let (Some(db), Some(p)) = (r.as_str(), self.db_path.as_ref()) {
                            let _ = std::fs::write(p, db);
                        }
                    }
                    _ => {}
                }
                if !v["error"].is_null() && id != "db" {
                    s.error = v["error"]["message"].as_str().map(String::from);
                }
            }
            Value::Number(n) => {
                if let Some(tx) = n.as_u64().and_then(|n| self.pending.lock().unwrap().remove(&n)) {
                    let _ = tx.try_send(v.clone());
                }
            }
            _ => {}
        }
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    /// One JSON-RPC call through the light client. Answers come from proofs the client
    /// checked, or an error if the peers cannot supply them in time.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        if method.contains("subscribe") || (method.starts_with("author_") && method != "author_submitExtrinsic") {
            return Err(format!("{method} is not offered to the app yet"));
        }
        let (tx, rx) = smol::channel::bounded(1);
        let id = {
            let mut n = self.next.lock().unwrap();
            *n += 1;
            *n
        };
        self.pending.lock().unwrap().insert(id, tx);
        let req = json!({"id": id, "jsonrpc": "2.0", "method": method, "params": params});
        if let Err(e) = self.client.lock().unwrap().json_rpc_request(req.to_string(), self.id) {
            self.pending.lock().unwrap().remove(&id);
            return Err(format!("{e:?}"));
        }
        let answer = smol::future::or(async { rx.recv().await.ok() }, async {
            smol::Timer::after(Duration::from_secs(30)).await;
            None
        })
        .await;
        self.pending.lock().unwrap().remove(&id);
        let v = answer.ok_or_else(|| format!("{method} timed out"))?;
        if !v["error"].is_null() {
            return Err(v["error"]["message"].as_str().unwrap_or("error").to_string());
        }
        Ok(v["result"].clone())
    }
}

pub struct ChainState(pub Mutex<Option<Arc<Chain>>>, pub Mutex<Option<String>>);

#[tauri::command]
pub fn chain_status(state: tauri::State<'_, ChainState>) -> Status {
    match state.0.lock().unwrap().as_ref() {
        Some(c) => c.status(),
        None => Status {
            error: state.1.lock().unwrap().clone().or(Some("the light client is starting".into())),
            ..Default::default()
        },
    }
}

#[tauri::command]
pub async fn chain_rpc(
    state: tauri::State<'_, ChainState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let chain = state.0.lock().unwrap().clone().ok_or("the light client is not running")?;
    chain.call(&method, params.unwrap_or(json!([]))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reaches the live chain over the internet, so it is ignored by default:
    // cargo test --lib chain -- --ignored --nocapture
    #[test]
    #[ignore]
    fn follows_the_live_chain() {
        let dir = std::env::temp_dir().join(format!("murmur-chain-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let chain = Chain::start(Some(dir.clone())).unwrap();
        let t0 = std::time::Instant::now();
        while chain.status().finalized.is_none() {
            assert!(t0.elapsed() < Duration::from_secs(120), "no finalised block: {:?}", chain.status().error);
            std::thread::sleep(Duration::from_millis(200));
        }
        let first = chain.status().finalized.unwrap();
        println!("finalised #{first} after {:.1}s", t0.elapsed().as_secs_f32());
        let v = smol::block_on(chain.call("state_getRuntimeVersion", json!([]))).unwrap();
        println!("runtime {} {}", v["specName"], v["specVersion"]);
        assert!(v["specVersion"].as_u64().is_some());
        assert!(smol::block_on(chain.call("chain_subscribeNewHeads", json!([]))).is_err());
        while chain.status().finalized.unwrap() == first || chain.status().peers.is_none() {
            assert!(t0.elapsed() < Duration::from_secs(120), "finality did not advance");
            std::thread::sleep(Duration::from_millis(200));
        }
        let s = chain.status();
        println!("then #{} best #{:?} peers {:?} genesis {:?} hash {:?}", s.finalized.unwrap(), s.best, s.peers, s.genesis, s.finalized_hash);
        assert_eq!(s.genesis.as_deref(), Some("0x590faee06c5152afe2841247408bc2cff08a738482bc21581d9cd622a4080260"));
        assert!(s.best.unwrap() >= s.finalized.unwrap());
        let db = smol::block_on(chain.call("chainHead_unstable_finalizedDatabase", json!([1048576]))).unwrap();
        println!("database {} bytes", db.as_str().unwrap().len());
        std::fs::remove_dir_all(dir).ok();
    }
}
