mod chatcmd;
mod fscmd;
mod gitcmd;
mod llm;
mod ptycmd;
mod system_prompt;
mod tools;
mod watcher;

use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{App, Emitter, Manager, WebviewWindowBuilder};

/// Label of the most recently focused webview window. With multiple
/// project windows open, menu actions (⌘S, ⌘B, …) must reach only the
/// focused window — not every window — so we track focus here and route
/// scoped emits through it. Defaults to the config window ("main").
struct FocusedWindow(Mutex<String>);

/// Build the full native application menu (macOS menu bar; in-window menu on
/// Windows/Linux), mirroring what users expect from standard desktop apps.
fn build_menu(app: &App) -> tauri::Result<Menu<tauri::Wry>> {
  // ── File ────────────────────────────────────────────────────────────────
  let new_file = MenuItem::with_id(app, "new_file", "New File", true, Some("CmdOrCtrl+N"))?;
  let new_window = MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+Shift+N"))?;
  let open_folder = MenuItem::with_id(app, "open_folder", "Open Folder…", true, Some("CmdOrCtrl+O"))?;
  let save_file = MenuItem::with_id(app, "save_file", "Save", true, Some("CmdOrCtrl+S"))?;
  let settings = MenuItem::with_id(app, "open_settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
  let file_menu = Submenu::new(app, "File", true)?;
  file_menu.append_items(&[
    &new_file,
    &new_window,
    &open_folder,
    &PredefinedMenuItem::separator(app)?,
    &save_file,
  ])?;
  #[cfg(not(target_os = "macos"))]
  {
    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    file_menu.append(&settings)?;
  }
  file_menu.append(&PredefinedMenuItem::separator(app)?)?;
  file_menu.append(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)?;

  // ── Edit (standard editing commands handled natively by the webview) ────
  let edit_menu = Submenu::with_items(
    app,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::undo(app, None)?,
      &PredefinedMenuItem::redo(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::cut(app, None)?,
      &PredefinedMenuItem::copy(app, None)?,
      &PredefinedMenuItem::paste(app, None)?,
      &PredefinedMenuItem::select_all(app, None)?,
    ],
  )?;

  // ── View ────────────────────────────────────────────────────────────────
  let toggle_sidebar =
    MenuItem::with_id(app, "toggle_sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+B"))?;
  let toggle_chat = MenuItem::with_id(
    app,
    "toggle_chat",
    "Toggle AI Chat",
    true,
    Some("CmdOrCtrl+Shift+C"),
  )?;
  let toggle_diff_mode =
    MenuItem::with_id(app, "toggle_diff_mode", "Toggle Diff Mode", true, Option::<&str>::None)?;
  let find_in_files = MenuItem::with_id(
    app,
    "find_in_files",
    "Find in Files",
    true,
    Some("CmdOrCtrl+Shift+F"),
  )?;
  let fullscreen = PredefinedMenuItem::fullscreen(app, Some("Toggle Full Screen"))?;
  let view_menu = Submenu::with_items(
    app,
    "View",
    true,
    &[
      &toggle_sidebar,
      &toggle_chat,
      &toggle_diff_mode,
      &PredefinedMenuItem::separator(app)?,
      &find_in_files,
      &PredefinedMenuItem::separator(app)?,
      &fullscreen,
    ],
  )?;

  // ── Window ──────────────────────────────────────────────────────────────
  let window_menu = Submenu::with_items(
    app,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
      &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
    ],
  )?;

  #[cfg(target_os = "macos")]
  let menu = {
    let about = PredefinedMenuItem::about(
      app,
      Some("About Zense"),
      Some(AboutMetadata {
        name: app.config().product_name.clone(),
        version: app.config().version.clone(),
        ..Default::default()
      }),
    )?;
    let app_menu = Submenu::with_items(
      app,
      "Zense",
      true,
      &[
        &about,
        &PredefinedMenuItem::separator(app)?,
        &settings,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, Some("Hide Zense"))?,
        &PredefinedMenuItem::hide_others(app, Some("Hide Others"))?,
        &PredefinedMenuItem::show_all(app, Some("Show All"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::quit(app, Some("Quit Zense"))?,
      ],
    )?;
    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])?
  };

  #[cfg(not(target_os = "macos"))]
  let menu = {
    let about = PredefinedMenuItem::about(app, Some("About Zense"), None)?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&about])?;
    Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])?
  };

  Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // reqwest is unified with the `rustls-no-provider` feature (pulled in by
  // tauri-plugin-updater), which panics on Client build unless a crypto
  // provider is installed first. Without this, every rig LLM request dies
  // silently and the UI reports "The AI returned an empty message".
  let _ = rustls::crypto::ring::default_provider().install_default();

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      fscmd::list_files,
      fscmd::read_file_tree,
      fscmd::read_file,
      fscmd::read_file_binary,
      fscmd::read_file_range,
      fscmd::write_file,
      fscmd::append_file,
      fscmd::write_file_atomic,
      fscmd::search_files,
      fscmd::replace_in_files,
      fscmd::create_dir,
      fscmd::rename_file,
      fscmd::delete_file,
      fscmd::copy_entry,
      fscmd::import_entries,
      fscmd::move_entries,
      gitcmd::git_status,
      gitcmd::git_branch_info,
      gitcmd::git_diff_summary,
      gitcmd::git_diff_file,
      gitcmd::git_stage,
      gitcmd::git_unstage,
      gitcmd::git_discard_file,
      gitcmd::git_discard_lines,
      gitcmd::git_commit,
      gitcmd::git_log,
      gitcmd::git_show,
      gitcmd::git_diff_commits,
      gitcmd::git_diff_commit_file,
      gitcmd::git_list_branches,
      gitcmd::git_checkout_branch,
      gitcmd::git_checkout_remote_branch,
      gitcmd::git_create_branch,
      gitcmd::git_fetch,
      gitcmd::git_pull,
      gitcmd::git_push,
      gitcmd::git_staged_diff,
      gitcmd::git_unstaged_diff,
      gitcmd::git_merge_in_progress,
      gitcmd::git_conflicts,
      gitcmd::git_read_conflict_file,
      gitcmd::git_resolve_file,
      gitcmd::git_merge_continue,
      gitcmd::git_merge_abort,
      chatcmd::chat_send,
      chatcmd::llm_test_connection,
      ptycmd::pty_spawn,
      ptycmd::pty_write,
      ptycmd::pty_resize,
      ptycmd::pty_kill,
      ptycmd::pty_kill_all,
      watcher::watch_workspace,
      watcher::stop_watch,
    ])
    .manage(ptycmd::PtyManager::default())
    .manage(watcher::WatchManager::default())
    .manage(FocusedWindow(Mutex::new("main".to_string())))
    .setup(|app| {
      let menu = build_menu(app)?;
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
    // Unsaved-changes guard: never let the OS close a window directly;
    // the frontend decides (prompt → save/discard → window.destroy()).
    .on_window_event(|window, event| {
      match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
          api.prevent_close();
          window.emit("app://close-requested", ()).ok();
        }
        // Keep the menu-action router pointed at the window the user is
        // actually working in (multi-project windows).
        tauri::WindowEvent::Focused(true) => {
          *window.state::<FocusedWindow>().0.lock().unwrap() =
            window.label().to_string();
        }
        _ => {}
      }
    })
    .on_menu_event(|app, event| {
      match event.id().as_ref() {
        "new_window" => {
          // First unused label — counting existing windows breaks once a
          // middle window is closed (window-2 + window-3 open, close 2,
          // len is 2 → "window-3" collides and nothing happens).
          let mut n = 2;
          let label = loop {
            let candidate = format!("window-{n}");
            if app.get_webview_window(&candidate).is_none() {
              break candidate;
            }
            n += 1;
          };
          let built = WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::default())
            .title("Zense")
            .inner_size(1440.0, 900.0)
            .min_inner_size(960.0, 600.0)
            .resizable(true)
            .fullscreen(false)
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .build();
          // On Windows/Linux menus live per-window; give the new window its own copy.
          #[cfg(not(target_os = "macos"))]
          if let (Ok(win), Some(menu)) = (&built, app.menu()) {
            let _ = win.set_menu(Some(menu.clone()));
          }
          built.ok();
        }
        // Everything else is an app action the web UI owns — forward it
        // to the focused window only (app.emit would broadcast to every
        // project window, e.g. ⌘S saving files in all of them).
        other => {
          let target = app.state::<FocusedWindow>().0.lock().unwrap().clone();
          let win = app
            .get_webview_window(&target)
            .or_else(|| app.get_webview_window("main"));
          if let Some(w) = win {
            let _ = w.emit("menu-action", other);
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
