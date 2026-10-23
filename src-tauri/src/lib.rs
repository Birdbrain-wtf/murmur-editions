// Secrets sit in the system's secure store under one service name per edition's
// bundle id, so the Decent and FTTF editions never see each other's keys.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod secrets {
    fn entry(app: &tauri::AppHandle, name: &str) -> Result<keyring::Entry, String> {
        if name.is_empty() || name.len() > 120 {
            return Err("a secret needs a name of up to 120 characters".into());
        }
        let service = app.config().identifier.clone();
        keyring::Entry::new(&service, name).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn secret_set(app: tauri::AppHandle, name: String, value: String) -> Result<(), String> {
        entry(&app, &name)?.set_password(&value).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn secret_get(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
        match entry(&app, &name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    #[tauri::command]
    pub fn secret_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
        match entry(&app, &name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// The light client (ADR 0068). Desktop only for now: nothing here has been tried on a phone.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod chain;
// Keep a copy: the optional full node, run as a child process (ADR 0068, step 2).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod node;
// The exchange engine: Decred's DEX client, fetched, checked and run as a child process.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod exchange;
// Private messages: the SimpleX chat core, fetched, checked and run as a child process.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod simplex;
// Asset Hub through a second light client, for Swap (KSM, or Paseo test money).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod hub;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod netguard;
// Answer with your own Claude: the member's own Claude Code, run as a child process.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod claude;

// Calls: the window may use the microphone and camera.
mod media;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        secrets::secret_set,
        secrets::secret_get,
        secrets::secret_delete,
        chain::chain_status,
        chain::chain_rpc,
        node::node_status,
        node::node_set_enabled,
        node::node_remove,
        exchange::exchange_status,
        exchange::exchange_set_enabled,
        exchange::exchange_api,
        exchange::exchange_book,
        simplex::simplex_status,
        simplex::simplex_set_enabled,
        simplex::simplex_remove,
        simplex::simplex_ws,
        simplex::simplex_invite_post,
        hub::hub_start,
        hub::hub_send,
        claude::claude_status,
        claude::claude_ask,
        claude::claude_stop
    ]);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .manage(chain::ChainState(Default::default(), Default::default()))
        .manage(node::NodeState(Default::default()))
        .manage(exchange::ExchangeState(Default::default()))
        .manage(simplex::SimplexState(Default::default()))
        .manage(hub::HubState::default())
        .manage(claude::ClaudeState::default());
    builder
        .setup(|_app| {
            media::allow_calls(_app);
            // Self-update is desktop-only; mobile updates via the app store.
            #[cfg(desktop)]
            _app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            // Start the light client off the main thread; the window opens without waiting.
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use tauri::Manager;
                let handle = _app.handle().clone();
                std::thread::spawn(move || {
                    let dir = handle.path().app_data_dir().ok();
                    if let Some(d) = &dir {
                        let _ = std::fs::create_dir_all(d);
                        *handle.state::<node::NodeState>().0.lock().unwrap() = Some(node::Node::start(d.clone()));
                        *handle.state::<exchange::ExchangeState>().0.lock().unwrap() =
                            Some(exchange::Engine::start(d.clone(), handle.config().identifier.clone()));
                        *handle.state::<simplex::SimplexState>().0.lock().unwrap() = simplex::Core::start(d.clone(), &handle.config().identifier);
                    }
                    let state = handle.state::<chain::ChainState>();
                    match chain::Chain::start(dir) {
                        Ok(c) => *state.0.lock().unwrap() = Some(c),
                        Err(e) => *state.1.lock().unwrap() = Some(e),
                    };
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|_handle, _event| {
            // The full node is a child process: close its database cleanly on the way out.
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::RunEvent::Exit = _event {
                use tauri::Manager;
                if let Some(n) = _handle.state::<node::NodeState>().0.lock().unwrap().as_ref() {
                    n.stop();
                }
                if let Some(e) = _handle.state::<exchange::ExchangeState>().0.lock().unwrap().as_ref() {
                    e.stop();
                }
                if let Some(c) = _handle.state::<simplex::SimplexState>().0.lock().unwrap().as_ref() {
                    c.stop();
                }
            }
        });
}
