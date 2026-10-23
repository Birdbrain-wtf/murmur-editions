//! Calls: let the app's window use the microphone and camera.
//!
//! On macOS the webview asks the system, which shows its own prompt with the
//! reasons in `Info.plist`. On Linux, WebKitGTK ships with WebRTC switched off
//! and turns every microphone or camera request down unless the app answers it,
//! so this switches WebRTC on and says yes to those two requests (the system
//! still decides whether the app may use the devices at all). Nothing else is
//! granted: screen sharing, location and the rest keep WebKit's default.

#[cfg(target_os = "linux")]
pub fn allow_calls(app: &tauri::App) {
    use tauri::Manager;
    use webkit2gtk::glib::prelude::Cast;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt,
        WebViewExt,
    };
    for (_, window) in app.webview_windows() {
        let _ = window.with_webview(|wv| {
            let view = wv.inner();
            if let Some(settings) = view.settings() {
                settings.set_enable_webrtc(true);
                settings.set_enable_media_stream(true);
            }
            view.connect_permission_request(|_, request| {
                match request.downcast_ref::<UserMediaPermissionRequest>() {
                    Some(media) if media.is_for_audio_device() || media.is_for_video_device() => {
                        request.allow();
                        true
                    }
                    _ => false,
                }
            });
        });
    }
}

#[cfg(not(target_os = "linux"))]
pub fn allow_calls(_app: &tauri::App) {}
