// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Windows: set NO_PROXY for localhost to avoid VPN interference
    #[cfg(target_os = "windows")]
    {
        std::env::set_var("NO_PROXY", "localhost,127.0.0.1");
        std::env::set_var("no_proxy", "localhost,127.0.0.1");
    }

    elefant_desktop_lib::run()
}
