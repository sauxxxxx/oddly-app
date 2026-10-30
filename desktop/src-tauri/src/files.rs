//! Saving generated files (exports, PDFs) through the native Save dialog. The web layer
//! never chooses a path itself: the user picks it in the OS dialog.

use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    default_name: String,
    contents: Vec<u8>,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &exts)
        .blocking_save_file();

    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| format!("Couldn't save the file: {e}"))?;
    Ok(Some(path.display().to_string()))
}
