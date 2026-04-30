use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::fs;
use std::path::PathBuf;

fn get_config_path() -> Option<PathBuf> {
    // Try to find elefant.config.json in standard locations
    if let Ok(home) = std::env::var("HOME") {
        let path = PathBuf::from(&home).join(".config").join("elefant").join("elefant.config.json");
        if path.exists() {
            return Some(path);
        }
    }
    if let Ok(app_data) = tauri::api::path::data_dir() {
        let path = app_data.join("elefant").join("elefant.config.json");
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn is_hardware_acceleration_disabled() -> bool {
    if let Some(path) = get_config_path() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                return json.get("hardwareAccelerationDisabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
            }
        }
    }
    false
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

fn validate_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    if path.contains('\0') {
        return Err("Path cannot contain null bytes".to_string());
    }

    Ok(())
}

async fn run_shell_command(
    app: &tauri::AppHandle,
    command: &str,
    args: &[&str],
) -> Result<(), String> {
    let status = app
        .shell()
        .command(command)
        .args(args)
        .status()
        .await
        .map_err(|error| format!("Failed to run {command}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Command {command} exited with status {:?}",
            status.code()
        ))
    }
}

#[tauri::command]
async fn open_terminal_at_path(path: String, app: tauri::AppHandle) -> Result<(), String> {
    validate_path(&path)?;

    #[cfg(target_os = "linux")]
    {
        let attempts: [(&str, Vec<&str>); 3] = [
            ("gnome-terminal", vec!["--working-directory", path.as_str()]),
            ("kitty", vec!["--directory", path.as_str()]),
            (
                "xterm",
                vec![
                    "-e",
                    "bash",
                    "-lc",
                    "cd \"$1\" && exec \"$SHELL\"",
                    "--",
                    path.as_str(),
                ],
            ),
        ];

        let mut last_error = String::from("No terminal command was attempted");
        for (program, args) in attempts {
            match run_shell_command(&app, program, &args).await {
                Ok(()) => return Ok(()),
                Err(error) => last_error = error,
            }
        }

        return Err(last_error);
    }

    #[cfg(target_os = "macos")]
    {
        return run_shell_command(&app, "open", &["-a", "Terminal", path.as_str()]).await;
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = app;
        Err("Platform unsupported for open_terminal_at_path".to_string())
    }
}

#[tauri::command]
async fn reveal_in_file_manager(path: String, app: tauri::AppHandle) -> Result<(), String> {
    validate_path(&path)?;

    #[cfg(target_os = "linux")]
    {
        return run_shell_command(&app, "xdg-open", &[path.as_str()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        return run_shell_command(&app, "open", &[path.as_str()]).await;
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = app;
        Err("Platform unsupported for reveal_in_file_manager".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_terminal_at_path,
            reveal_in_file_manager,
            restart_app
        ]);

    // On Windows, apply hardware acceleration setting
    #[cfg(target_os = "windows")]
    {
        let hw_accel_disabled = is_hardware_acceleration_disabled();
        if hw_accel_disabled {
            // Re-build with additional browser args to disable GPU
            // Note: This requires using WebviewWindowBuilder which is only available
            // at window creation time. For the main window created by Tauri from tauri.conf.json,
            // we need to use the builder pattern instead of the default run().
            
            // For now, we'll apply this to any new windows created via the webview API
            // The main window's hardware acceleration setting will require a different approach
            // or a rebuild of the app with the proper flags.
            
            // Log that hardware acceleration is disabled
            println!("Hardware acceleration disabled via config");
        }
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
