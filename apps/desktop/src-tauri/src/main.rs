#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::sync::{Arc, Mutex};
use sourcefold_desktop::{commands, db::Database, native_host, native_installer, server};

fn main() {
    let args: Vec<String> = env::args().collect();

    // Check if launched as Chrome Native Messaging Host
    // Chrome launches with: <path_to_host> <chrome-extension://[extension-id]/>
    // Or our explicit flag --native-messaging
    let is_native_messaging = args.iter().any(|arg| {
        arg == "--native-messaging"
            || arg.starts_with("chrome-extension://")
            || arg.ends_with(".json")
    });

    if is_native_messaging {
        let db = match Database::new() {
            Ok(db) => db,
            Err(e) => {
                eprintln!("Failed to init DB for native host: {}", e);
                std::process::exit(1);
            }
        };

        let db_arc = Arc::new(Mutex::new(db));
        if let Err(e) = native_host::run_native_messaging_host(db_arc) {
            eprintln!("Native host exited with error: {}", e);
            std::process::exit(1);
        }
        return;
    }

    if args.iter().any(|arg| arg == "--install-native") {
        let ids: Vec<String> = std::env::var("SOURCEFOLD_EXTENSION_IDS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        match native_installer::install_native_host(&ids) {
            Ok(msg) => println!("{}", msg),
            Err(e) => eprintln!("Failed to install native host: {}", e),
        }
        return;
    }

    // Initialize Database
    let db = match Database::new() {
        Ok(db) => db,
        Err(e) => {
            eprintln!("Failed to initialize database: {}", e);
            std::process::exit(1);
        }
    };

    // Auto-install / refresh native host manifest on startup when concrete extension IDs
    // are provided (e.g. via SOURCEFOLD_EXTENSION_IDS). We never register a wildcard
    // origin, because Chrome rejects it.
    let startup_ids: Vec<String> = std::env::var("SOURCEFOLD_EXTENSION_IDS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    if !startup_ids.is_empty() {
        let _ = native_installer::install_native_host(&startup_ids);
    }

    // Spawn background HTTP server for local extension fallback (127.0.0.1:23456)
    let server_db = Arc::new(Mutex::new(db.clone()));

    let auth_flow_state = Arc::new(commands::auth::AuthFlowState::default());

    // Build and run Tauri application
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db)
        .manage(auth_flow_state)
        .setup(move |_app| {
            let handle = _app.handle().clone();
            server::start_local_server(server_db, server::DEFAULT_PORT, Some(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_folders,
            commands::get_projects,
            commands::create_folder,
            commands::rename_folder,
            commands::move_folder,
            commands::delete_folder,
            commands::archive_project,
            commands::get_items,
            commands::get_item,
            commands::check_url,
            commands::save_grokipedia,
            commands::capture,
            commands::add_x_post,
            commands::rename_item,
            commands::move_item,
            commands::delete_item,
            commands::update_item_note,
            commands::create_note,
            commands::add_image,
            commands::open_item_file,
            commands::update_note,
            commands::search_items,
            commands::get_settings,
            commands::update_settings,
            commands::install_native_host,
            commands::get_native_host_status,
            commands::get_session,
            commands::sign_out,
            commands::set_offline_mode,
            commands::start_sign_in,
            commands::cancel_sign_in,
            commands::substack_fetch,
            commands::get_substack_cookie,
            commands::set_substack_cookie,
            commands::clear_substack_cookie,
            commands::web_fetch,
            commands::sync_local_copy,
            commands::get_local_copy_enabled,
            commands::set_local_copy_enabled,
            commands::open_storage_folder,
            commands::list_highlights,
            commands::put_highlight,
            commands::update_highlight_note,
            commands::delete_highlight,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sourcefold desktop application");
}
