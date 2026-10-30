//! ODDLY desktop shell. The UI is the React app in `../src`; this crate only adds the
//! native pieces the browser sandbox can't do safely — currently secure session storage.

mod secure_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secure_store::secure_get,
            secure_store::secure_set,
            secure_store::secure_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ODDLY");
}
