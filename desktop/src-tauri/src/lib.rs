//! ODDLY desktop shell. The UI is the React app in `../src`; this crate only adds the
//! native pieces the browser sandbox can't do safely — secure session storage and
//! saving files through the OS Save dialog — plus signed auto-updates.

mod files;
mod secure_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Updates are only installed when the user clicks "Install"; the signature is checked
        // against the public key in tauri.conf.json before anything runs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            secure_store::secure_get,
            secure_store::secure_set,
            secure_store::secure_delete,
            files::save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ODDLY");
}
