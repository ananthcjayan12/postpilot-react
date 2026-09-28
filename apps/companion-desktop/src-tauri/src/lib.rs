pub mod engine;
pub mod process;
pub mod providers;
use engine::{Config, Engine, Status};
use providers::Paths;
use std::sync::{atomic::Ordering, Arc};
use tauri::{Manager, State};

#[tauri::command]
fn status(state: State<'_, Arc<Engine>>) -> Status {
    state.status.lock().unwrap().clone()
}
#[tauri::command]
fn pause(state: State<'_, Arc<Engine>>) {
    state.pause();
}
#[tauri::command]
fn start(state: State<'_, Arc<Engine>>) -> Result<(), String> {
    state.start()
}
#[tauri::command]
async fn pair(
    origin: String,
    code: String,
    name: String,
    state: State<'_, Arc<Engine>>,
) -> Result<(), String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = engine.operation.lock().unwrap();
        if !engine.cancel.load(Ordering::SeqCst) || engine.worker_busy.load(Ordering::SeqCst) {
            return Err("Pause and wait for active work to stop before pairing.".into());
        }
        if engine.config.lock().unwrap().is_some() {
            return Err("Forget the current pairing before connecting another workspace.".into());
        }
        let origin = engine::validate_origin(&origin)?;
        if !(40..=100).contains(&code.len())
            || name.trim().is_empty()
            || name.encode_utf16().count() > 80
        {
            return Err("Enter a valid pairing code and computer name.".into());
        }
        // Ensure keychain access before consuming the one-time code.
        let _ = engine::load()?;
        let mut c = Config {
            origin,
            token: String::new(),
            id: String::new(),
            paths: Paths::default(),
        };
        let result = engine
            .request(
                &c,
                "/pair",
                serde_json::json!({"code":code.trim(),"name":name.trim()}),
            )
            .map_err(|e| e.message)?;
        c.token = result["token"]
            .as_str()
            .filter(|s| s.len() <= 200 && !s.is_empty())
            .ok_or("Missing device token")?
            .into();
        c.id = result["id"].as_str().ok_or("Missing device ID")?.into();
        engine::save(&c).map_err(|e| {
            format!("{e}. Remove the unused device in website Settings, then pair again.")
        })?;
        {
            let mut s = engine.status.lock().unwrap();
            s.paired = true;
            s.origin = c.origin.clone();
            s.paths = c.paths.clone();
            s.message = "Paired securely. Click Start to connect.".into();
        }
        *engine.config.lock().unwrap() = Some(c);
        Ok(())
    })
    .await
    .map_err(|_| "Pairing task failed".to_string())?
}
#[tauri::command]
async fn save_paths(paths: Paths, state: State<'_, Arc<Engine>>) -> Result<(), String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = engine.operation.lock().unwrap();
        if !engine.cancel.load(Ordering::SeqCst) || engine.worker_busy.load(Ordering::SeqCst) {
            return Err("Pause before changing executable paths.".into());
        }
        for (name, p) in [("codex", &paths.codex), ("agy", &paths.antigravity)] {
            if !p.is_empty() {
                crate::process::resolve(name, p)?;
            }
        }
        let mut lock = engine.config.lock().unwrap();
        let mut c = lock.clone().ok_or("Pair first")?;
        c.paths = paths.clone();
        engine::save(&c)?;
        *lock = Some(c);
        engine.status.lock().unwrap().paths = paths;
        engine.refresh.store(true, Ordering::SeqCst);
        Ok(())
    })
    .await
    .map_err(|_| "Cannot save paths".to_string())?
}
#[tauri::command]
async fn forget(state: State<'_, Arc<Engine>>) -> Result<(), String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = engine.operation.lock().unwrap();
        if !engine.cancel.load(Ordering::SeqCst) || engine.worker_busy.load(Ordering::SeqCst) {
            return Err("Pause and wait for active work to stop first.".into());
        }
        let entry = keyring::Entry::new("com.postpilot.companion", "device")
            .map_err(|_| "Cannot access credential store")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Cannot remove saved pairing".into()),
        };
        *engine.config.lock().unwrap() = None;
        *engine.status.lock().unwrap() = Status::default();
        engine.message("Pairing removed locally. Revoke this computer in website Settings too.");
        Ok(())
    })
    .await
    .map_err(|_| "Cannot remove pairing".to_string())?
}
pub fn run() {
    let engine = Engine::new();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(engine.clone())
        .invoke_handler(tauri::generate_handler![
            status, pair, start, pause, save_paths, forget
        ])
        .setup(move |app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            let show =
                MenuItem::with_id(app, "show", "Open PostPilot Companion", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("PostPilot Companion")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "show" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    if event.id.as_ref() == "quit" {
                        let e = app.state::<Arc<Engine>>().inner().clone();
                        e.pause();
                        e.shutdown.store(true, Ordering::SeqCst);
                        let app = app.clone();
                        std::thread::spawn(move || {
                            while e.worker_busy.load(Ordering::SeqCst) {
                                std::thread::sleep(std::time::Duration::from_millis(100));
                            }
                            app.exit(0);
                        });
                    }
                })
                .build(app)?;
            std::thread::spawn(move || {
                let operation = engine.operation.lock().unwrap();
                let mut resume = false;
                match engine::load() {
                    Ok(Some(c)) => {
                        {
                            let mut s = engine.status.lock().unwrap();
                            s.paired = true;
                            s.origin = c.origin.clone();
                            s.paths = c.paths.clone();
                        }
                        *engine.config.lock().unwrap() = Some(c);
                        resume = true;
                    }
                    Ok(None) => {}
                    Err(e) => engine.message(&e),
                }
                drop(operation);
                if resume {
                    let _ = engine.start();
                }
                engine.worker();
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Cannot launch PostPilot Companion")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                let e = app.state::<Arc<Engine>>();
                if code.is_none() {
                    api.prevent_exit();
                    let app = app.clone();
                    let e = e.inner().clone();
                    e.pause();
                    e.shutdown.store(true, Ordering::SeqCst);
                    std::thread::spawn(move || {
                        while e.worker_busy.load(Ordering::SeqCst) {
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                        app.exit(0);
                    });
                }
            }
        });
}
