mod fscmd;
mod gitcmd;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      fscmd::list_files,
      fscmd::read_file_tree,
      fscmd::read_file,
      fscmd::read_file_range,
      fscmd::write_file,
      fscmd::create_dir,
      fscmd::rename_file,
      fscmd::delete_file,
      fscmd::copy_entry,
      gitcmd::git_status,
      gitcmd::git_branch_info,
      gitcmd::git_diff_summary,
      gitcmd::git_diff_file,
      gitcmd::git_stage,
      gitcmd::git_unstage,
      gitcmd::git_commit,
      gitcmd::git_log,
      gitcmd::git_show,
      gitcmd::git_diff_commits,
      gitcmd::git_diff_commit_file,
    ])
    .setup(|app| {
      // Build native macOS menu bar with File > New Window (⌘N)
      let new_window = MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+N"))?;
      let file_menu = Submenu::with_items(app, "File", true, &[&new_window])?;
      let menu = Menu::with_items(app, &[&file_menu])?;
      app.set_menu(menu)?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_menu_event(|app, event| {
      if event.id() == "new_window" {
        let count = app.webview_windows().len();
        let label = format!("window-{}", count + 1);
        if app.get_webview_window(&label).is_some() {
          return;
        }
        WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::default())
          .title("Zense")
          .inner_size(1440.0, 900.0)
          .min_inner_size(960.0, 600.0)
          .resizable(true)
          .fullscreen(false)
          .hidden_title(true)
          .title_bar_style(tauri::TitleBarStyle::Overlay)
          .build()
          .ok();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
